-- Bot 狀態資料表：對話記憶（取代 n8n Window Buffer Memory）+ 各 chat 的科目設定
-- 在 Supabase SQL Editor 執行一次即可；不會動到 documents 資料表。

create table if not exists chat_memory (
  id bigserial primary key,
  chat_id bigint not null,
  role text not null check (role in ('user', 'model')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_memory_chat_idx
  on chat_memory (chat_id, id desc);

-- 各 chat 目前選擇的科目（/subject 指令）
create table if not exists chat_settings (
  chat_id bigint primary key,
  subject text not null default 'statistics',
  updated_at timestamptz not null default now()
);
