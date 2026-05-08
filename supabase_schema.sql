-- 在 Supabase SQL Editor 中執行此檔案（完整重建）
-- gemini-embedding-001 輸出 3072 維
-- halfvec：16-bit float，省一半儲存；ivfflat 支援 halfvec 最多 4000 維（3072 < 4000 ✓）

-- 1. 啟用 pgvector 擴充
create extension if not exists vector;

-- 2. 重建資料表（先刪除舊的）
drop table if exists documents;
create table documents (
  id bigserial primary key,
  content text not null,
  embedding halfvec(3072),
  metadata jsonb default '{}'::jsonb
);

-- 3. 向量索引（halfvec_cosine_ops 對應 halfvec 型別）
create index documents_embedding_idx
  on documents using ivfflat (embedding halfvec_cosine_ops)
  with (lists = 100);

-- 4. 語意搜尋函式（供 n8n Supabase Vector Store 節點呼叫）
create or replace function match_documents(
  query_embedding halfvec(3072),
  match_count int default 5,
  filter jsonb default '{}'::jsonb
)
returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  where d.metadata @> filter
  order by d.embedding <=> query_embedding
  limit match_count;
end;
$$;
