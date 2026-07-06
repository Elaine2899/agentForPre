-- 對話記憶資料表（取代 n8n Window Buffer Memory）
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
