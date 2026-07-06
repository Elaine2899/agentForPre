// PrepAgent Telegram bot — Supabase Edge Function
// 取代原本的 n8n Cloud Workflow：
//   Telegram webhook → 指令路由 → RAG 檢索（match_documents）→ Gemini 生成 → Telegram 回覆
// 對話記憶存於 chat_memory 資料表（每個 chat 保留最近 MEMORY_TURNS 輪）。

import { createClient } from "npm:@supabase/supabase-js@2";
import { HELP_TEXT, SYSTEM_PROMPT } from "./prompt.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_API_KEY")!;
// 2026-07 起 gemini-2.0-flash 免費額度歸零（limit: 0），改用 2.5 Flash
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
const EMBEDDING_MODEL = "gemini-embedding-001";

const TG_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const MATCH_COUNT = 5; // top-k 檢索
const MEMORY_TURNS = 5; // 保留 5 輪對話（10 則訊息）
const MEMORY_KEEP_ROWS = MEMORY_TURNS * 2;
const TG_MSG_LIMIT = 4000; // Telegram 上限 4096，留些餘裕

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type Mode = "ask" | "quiz" | "summary";

interface ChatTurn {
  role: "user" | "model";
  content: string;
}

Deno.serve((req) => {
  if (req.method !== "POST") {
    return new Response("ok");
  }
  // Telegram setWebhook 時設定的 secret_token，擋掉非 Telegram 的請求
  if (
    TELEGRAM_WEBHOOK_SECRET &&
    req.headers.get("x-telegram-bot-api-secret-token") !== TELEGRAM_WEBHOOK_SECRET
  ) {
    return new Response("forbidden", { status: 403 });
  }

  return req.json().then((update) => {
    // 先回 200 讓 Telegram 不重送，實際處理放到背景執行
    const work = handleUpdate(update).catch((err) =>
      console.error("handleUpdate failed:", err)
    );
    if (typeof EdgeRuntime !== "undefined") {
      EdgeRuntime.waitUntil(work);
      return new Response("ok");
    }
    return work.then(() => new Response("ok"));
  });
});

async function handleUpdate(update: Record<string, unknown>) {
  const message = update.message as
    | { chat: { id: number }; text?: string }
    | undefined;
  const chatId = message?.chat?.id;
  const text = message?.text?.trim();
  if (!chatId || !text) return; // 忽略貼圖、圖片、編輯訊息等

  if (text === "/start" || text === "/help") {
    await sendMessage(chatId, HELP_TEXT);
    return;
  }

  const { mode, query } = parseCommand(text);
  if (!query) {
    await sendMessage(chatId, `請在指令後面加上內容，例如：/${mode} 中央極限定理`);
    return;
  }

  await sendChatAction(chatId, "typing");

  try {
    const [context, history] = await Promise.all([
      retrieveContext(query),
      loadMemory(chatId),
    ]);
    const reply = await generateReply(mode, text, context, history);
    await sendMessage(chatId, reply);
    await saveMemory(chatId, text, reply);
  } catch (err) {
    console.error(`chat ${chatId} error:`, err);
    await sendMessage(chatId, "抱歉，系統暫時發生錯誤，請稍後再試一次。");
  }
}

function parseCommand(text: string): { mode: Mode; query: string } {
  const match = text.match(/^\/(ask|quiz|summary)(?:@\w+)?\s*([\s\S]*)$/);
  if (match) {
    return { mode: match[1] as Mode, query: match[2].trim() };
  }
  return { mode: "ask", query: text }; // 無指令時當作一般問答
}

// ---------- RAG 檢索 ----------

async function retrieveContext(query: string): Promise<string> {
  const embedding = await embedQuery(query);
  const { data, error } = await supabase.rpc("match_documents", {
    query_embedding: embedding,
    match_count: MATCH_COUNT,
  });
  if (error) throw new Error(`match_documents: ${error.message}`);

  const rows = (data ?? []) as {
    content: string;
    metadata: { lecture?: string };
    similarity: number;
  }[];
  if (rows.length === 0) return "（知識庫中沒有找到相關內容）";

  return rows
    .map((r, i) => `[${i + 1}]（${r.metadata?.lecture ?? "未知講次"}）\n${r.content}`)
    .join("\n\n");
}

async function embedQuery(text: string): Promise<number[]> {
  const resp = await fetch(
    `${GEMINI_BASE}/${EMBEDDING_MODEL}:embedContent?key=${GOOGLE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_QUERY",
      }),
    },
  );
  if (!resp.ok) {
    throw new Error(`embedContent ${resp.status}: ${await resp.text()}`);
  }
  const json = await resp.json();
  return json.embedding.values;
}

// ---------- LLM 生成 ----------

async function generateReply(
  mode: Mode,
  userText: string,
  context: string,
  history: ChatTurn[],
): Promise<string> {
  const contents = [
    ...history.map((t) => ({ role: t.role, parts: [{ text: t.content }] })),
    {
      role: "user",
      parts: [
        {
          text:
            `【知識庫檢索結果】\n${context}\n\n【使用者訊息（${mode} 模式）】\n${userText}`,
        },
      ],
    },
  ];

  const resp = await fetch(
    `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: {
          temperature: 0.7,
          // 2.5 Flash 預設會先「思考」再回答，聊天情境關掉以加快回覆、節省額度
          ...(GEMINI_MODEL.includes("2.5-flash")
            ? { thinkingConfig: { thinkingBudget: 0 } }
            : {}),
        },
      }),
    },
  );
  if (!resp.ok) {
    throw new Error(`generateContent ${resp.status}: ${await resp.text()}`);
  }
  const json = await resp.json();
  const reply: string | undefined =
    json.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "")
      .join("");
  if (!reply) {
    throw new Error(`empty reply: ${JSON.stringify(json).slice(0, 500)}`);
  }
  return reply.trim();
}

// ---------- 對話記憶（chat_memory 資料表） ----------

async function loadMemory(chatId: number): Promise<ChatTurn[]> {
  const { data, error } = await supabase
    .from("chat_memory")
    .select("role, content")
    .eq("chat_id", chatId)
    .order("id", { ascending: false })
    .limit(MEMORY_KEEP_ROWS);
  if (error) {
    console.error("loadMemory:", error.message);
    return [];
  }
  return (data ?? []).reverse() as ChatTurn[];
}

async function saveMemory(chatId: number, userText: string, reply: string) {
  const { error } = await supabase.from("chat_memory").insert([
    { chat_id: chatId, role: "user", content: userText },
    { chat_id: chatId, role: "model", content: reply },
  ]);
  if (error) {
    console.error("saveMemory:", error.message);
    return;
  }

  // 修剪：只保留每個 chat 最近 MEMORY_KEEP_ROWS 則
  const { data } = await supabase
    .from("chat_memory")
    .select("id")
    .eq("chat_id", chatId)
    .order("id", { ascending: false })
    .range(MEMORY_KEEP_ROWS, MEMORY_KEEP_ROWS + 100);
  const staleIds = (data ?? []).map((r) => r.id);
  if (staleIds.length > 0) {
    await supabase.from("chat_memory").delete().in("id", staleIds);
  }
}

// ---------- Telegram API ----------

async function sendMessage(chatId: number, text: string) {
  for (let i = 0; i < text.length; i += TG_MSG_LIMIT) {
    const chunk = text.slice(i, i + TG_MSG_LIMIT);
    const resp = await fetch(`${TG_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk }),
    });
    if (!resp.ok) {
      console.error(`sendMessage ${resp.status}: ${await resp.text()}`);
    }
  }
}

async function sendChatAction(chatId: number, action: string) {
  await fetch(`${TG_API}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  }).catch(() => {});
}
