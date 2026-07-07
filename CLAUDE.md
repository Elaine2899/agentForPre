# CLAUDE.md

PrepAgent — Telegram AI 備考助教與 RAG 知識庫。與使用者以繁體中文溝通。
完整架構與部署步驟見 README.md，此檔只記錄操作知識與不可違反的約定。

## 架構速覽（2026-07 起為自建後端，n8n 已淘汰）

- **後端**：`supabase/functions/telegram-bot/`（Deno/TypeScript Edge Function）
  - `index.ts`：Telegram webhook → 指令路由 → RAG 檢索 → Gemini 生成 → 回覆
  - `prompt.ts`：科目註冊表 `SUBJECTS`、System Prompt 模板、/help 文案
- **資料庫**（Supabase 專案 `pzqewvijihsedokdwagw`，免費方案）：
  - `documents`：向量庫，`halfvec(3072)` + ivfflat，metadata 含 subject/lecture
  - `chat_memory`：對話記憶（每 chat 保留 5 輪）
  - `chat_settings`：每 chat 的科目選擇
- **Ingestion**：`harness/`（Python，用 `harness/venv/bin/python` 跑）

## 常用指令

```bash
# 部署後端（改了 index.ts / prompt.ts 之後）
supabase functions deploy telegram-bot

# 型別檢查（部署前）
cd supabase/functions/telegram-bot && deno check index.ts

# Ingestion / 檢索評估（一定要用 venv）
cd harness && ./venv/bin/python ingest.py --subject <key>
cd harness && ./venv/bin/python eval_retrieval.py   # Hit Rate@5，基準 75%

# 對雲端 DB 跑 SQL（不用開 dashboard；token 在 macOS keychain）
TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
curl -s -X POST "https://api.supabase.com/v1/projects/pzqewvijihsedokdwagw/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select 1"}'
```

## 不可違反的約定

1. **科目 key 三處必須一致**：`harness/config.py` 的 `SUBJECTS`、
   DB `documents.metadata.subject`、`prompt.ts` 的 `SUBJECTS`。
   新增科目流程見 `docs/add-subject.md`。
2. **embedding 模型入庫與查詢必須相同**：`gemini-embedding-001`（3072 維），
   入庫 taskType=`RETRIEVAL_DOCUMENT`、查詢 =`RETRIEVAL_QUERY`。
   （n8n 時期曾因查詢用 text-embedding-004 而失準。）
3. **LLM 用 `gemini-2.5-flash`**：`gemini-2.0-flash` 免費額度已被 Google
   降為 0（429 且訊息含 `limit: 0`），不要改回去。
4. **金鑰**：`.env` 只供本機 harness；Edge Function 的金鑰用
   `supabase secrets set`。push 前掃描 git 歷史（`AIza`、`sb_secret`、
   bot token 前綴）。

## 維運注意

- 免費方案閒置 7 天會暫停專案。已有 pg_cron job `keepalive-telegram-bot`
  （每日 03:00 UTC 自我 ping），若專案仍被暫停：dashboard 按 Restore，
  剛恢復的第一個 DB 查詢可能逾時 1–2 分鐘（暖機）。
- Webhook 驗證：`TELEGRAM_WEBHOOK_SECRET`（本機 `.env` 有備份），
  重設 webhook 時 `setWebhook` 的 `secret_token` 要帶同一組。
- IDE 對 `supabase/functions` 的 TS 紅字是誤報（需 Deno 擴充套件），
  以 `deno check` 為準。

## 本機限定檔案（不在 GitHub 上）

- `docs/ai-dev-playbook.md`：AI 協作開發手冊，經由 `.git/info/exclude`
  排除，**不要 commit 或 push**。
- `.env`、`n8n/`（舊系統遺留）、`project_description.txt`（履歷文案）。
