"""Quick verification: checks Supabase row count and runs a test RAG query."""

import os
from pathlib import Path
import requests
from dotenv import load_dotenv
from supabase import create_client
from config import EMBEDDING_MODEL

load_dotenv(Path(__file__).parent.parent / ".env")

api_key = os.environ["GOOGLE_API_KEY"]
supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

EMBED_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{EMBEDDING_MODEL}:embedContent"

# 1. Row count
count = supabase.table("documents").select("id", count="exact").execute().count
print(f"Supabase documents: {count} rows")

# 2. Test RAG query
query = "什麼是標準差"
resp = requests.post(
    EMBED_URL,
    params={"key": api_key},
    json={
        "model": f"models/{EMBEDDING_MODEL}",
        "content": {"parts": [{"text": query}]},
        "taskType": "RETRIEVAL_QUERY",
    },
    timeout=30,
)
resp.raise_for_status()
emb = resp.json()["embedding"]["values"]

results = supabase.rpc(
    "match_documents",
    {"query_embedding": emb, "match_count": 3, "filter": {"subject": "statistics"}},
).execute()

print(f"\nTop 3 results for「{query}」:")
for r in results.data:
    meta = r["metadata"]
    print(f"  [{meta['lecture']}] similarity={r['similarity']:.3f}")
    print(f"    {r['content'][:80]}...")
