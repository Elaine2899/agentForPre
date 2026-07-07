# 新增科目 SOP

整個系統以「科目 key」貫穿三個地方，**三處的 key 必須一致**：

```
harness/config.py 的 SUBJECTS ──┐
                                ├──> 同一個 key（例如 calculus）
Supabase documents.metadata.subject ──┤
                                ├──> 同一個 key
supabase/functions/telegram-bot/prompt.ts 的 SUBJECTS ──┘
```

以下用「微積分（王老師）」示範，key 取 `calculus`。

---

## 1. 準備逐字稿

建立 `data/calculus/` 資料夾，放入 Whisper 逐字稿。

- 格式：每行 `行號<TAB>文字`（例如 `1\t各位同學大家好`），
  `chunker.py` 會自動剝離行號前綴
- 檔名建議有規律（例如 `Cal01.txt`、`Cal02.txt`），
  下一步的 `patterns` 要能對到

## 2. 註冊到 ingestion 設定

在 `harness/config.py` 的 `SUBJECTS` 加一筆：

```python
SUBJECTS = {
    "statistics": { ... },  # 既有的
    "calculus": {
        "label": "微積分（王老師）",
        "data_dir": ROOT / "data" / "calculus",
        "patterns": ["Cal*.txt"],
    },
}
```

## 3. 執行 ingestion

```bash
cd harness
python ingest.py --subject calculus
```

- 免費額度下 embedding 約 1 秒 1 筆，一講約 3–5 分鐘，中斷可重跑
  （已完成的講次會自動跳過）
- 完成後驗證筆數：

```sql
-- Supabase SQL Editor
select metadata->>'subject' as subject, count(*)
from documents group by 1;
```

或執行 `python verify.py`。

## 4. 註冊到 Bot

在 `supabase/functions/telegram-bot/prompt.ts` 的 `SUBJECTS` 加一筆
（key 必須與步驟 2 一致）：

```ts
export const SUBJECTS: Record<string, SubjectConfig> = {
  statistics: { ... },  // 既有的
  calculus: {
    label: "微積分",
    teacher: "王老師",
    aliases: ["微積分", "calc"],
  },
};
```

System Prompt、`/help`、`/subject` 清單都會自動帶入，不用改其他程式。

## 5. 重新部署

```bash
supabase functions deploy telegram-bot
```

## 6. 在 Telegram 測試

1. `/subject` → 清單應出現「微積分（王老師）」
2. `/subject calculus`（或 `/subject 微積分`）→ 切換成功
3. `/ask <該科目的問題>` → 回答應引用新科目的講次
4. `/subject statistics` 切回統計學，確認互不干擾

---

## 常見問題

| 症狀 | 原因 | 解法 |
|------|------|------|
| 切過去後一直答「找不到相關內容」 | 三處 key 不一致（最常見） | 確認 `config.py`、`prompt.ts`、DB 裡 `metadata->>'subject'` 三者相同 |
| `/subject` 清單沒有新科目 | 只改了 `prompt.ts` 沒重新部署 | `supabase functions deploy telegram-bot` |
| ingestion 很慢或一直 429 | 免費額度 embedding 限速 | 正常現象，腳本會自動退避重試，放著跑完即可 |
| 容量疑慮 | 免費方案 DB 上限 500 MB | 一個統計學規模的科目約 30–40 MB，十個科目內都安全 |

刪除某科目的所有資料：

```sql
delete from documents where metadata->>'subject' = 'calculus';
```
