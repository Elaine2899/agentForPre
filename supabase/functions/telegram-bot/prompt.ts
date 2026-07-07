// 科目註冊表：新增科目時只需在 SUBJECTS 加一筆（key 需與 ingestion 的
// metadata.subject 一致），其餘路由、檢索過濾、System Prompt 都會自動生效。

export interface SubjectConfig {
  label: string; // 科目顯示名稱
  teacher: string; // 老師名稱
  aliases: string[]; // /subject 切換時可輸入的別名（不分大小寫）
}

export const SUBJECTS: Record<string, SubjectConfig> = {
  statistics: {
    label: "統計學",
    teacher: "唐麗英老師",
    aliases: ["統計", "統計學", "stat", "stats"],
  },
};

export const DEFAULT_SUBJECT = "statistics";

/** 由使用者輸入解析科目 key；支援 key、顯示名稱、別名（不分大小寫）。 */
export function resolveSubject(input: string): string | null {
  const q = input.trim().toLowerCase();
  for (const [key, cfg] of Object.entries(SUBJECTS)) {
    if (
      key.toLowerCase() === q ||
      cfg.label.toLowerCase() === q ||
      cfg.aliases.some((a) => a.toLowerCase() === q)
    ) {
      return key;
    }
  }
  return null;
}

export function subjectList(current: string): string {
  return Object.entries(SUBJECTS)
    .map(([key, cfg]) =>
      `${key === current ? "▸" : "・"} ${cfg.label}（${cfg.teacher}）　切換指令：/subject ${key}`
    )
    .join("\n");
}

export function systemPrompt(subjectKey: string): string {
  const s = SUBJECTS[subjectKey] ?? SUBJECTS[DEFAULT_SUBJECT];
  return `你是${s.teacher}${s.label}課程的 AI 備考助教，使用繁體中文回答。

【回答規則】
1. 回答概念問題時，請引用「來自第X講」讓同學知道出處。
2. 若使用者輸入 /quiz，請根據搜尋到的內容生成 N 道選擇題，每題含四個選項、標明正確答案與解析。
3. 若使用者輸入 /summary，請整理成條列式重點筆記，標示一級標題、二級要點。
4. 若知識庫中找不到足夠相關的內容，請誠實告知，不要捏造。
5. 課程講義以口語為主，若講義說法不夠精確或與${s.label}標準定義有出入，請以正確的${s.label}知識為準，並可補充更嚴謹的說明（標示「補充說明」）。
6. 保持親切、鼓勵的口吻，像助教陪同學一起備考。
7. 不需要每次自我介紹，直接回答問題即可。
8. 回覆時禁止使用任何 Markdown 格式，包括：
   - 不用 **粗體**、*斜體*
   - 不用 ### 標題
   - 不用 * 或 - 開頭的清單符號
   - 不用 --- 分隔線
   - 不用 $ 數學符號包裹
   請用純文字、自然段落方式回答，條列時用「1. 2. 3.」或「・」代替。

【指令格式】
/ask 問題      → Q&A 模式
/quiz 主題 N題  → 出 N 道練習題
/summary 主題  → 生成重點整理
/subject 科目  → 切換科目
/help          → 顯示指令說明`;
}

export function helpText(currentSubject: string): string {
  const s = SUBJECTS[currentSubject] ?? SUBJECTS[DEFAULT_SUBJECT];
  return `PrepAgent 備考助教 指令說明
目前科目：${s.label}（${s.teacher}）

/ask 問題 → 概念問答
　例：/ask 什麼是中央極限定理？

/quiz 主題 N題 → 生成練習題
　例：/quiz 假設檢定 3題

/summary 主題 → 整理重點筆記
　例：/summary 信賴區間

/subject → 查看或切換科目

/help → 顯示本說明

也可以直接輸入問題（不加指令），我會當作 /ask 回答你。`;
}
