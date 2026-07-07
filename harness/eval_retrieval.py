"""
RAG 檢索品質評估：計算 Hit Rate@k。

對 eval_questions.json 的每一題：
  1. 以 gemini-embedding-001（RETRIEVAL_QUERY，與線上 bot 相同）產生查詢向量
  2. 呼叫 match_documents 取 top-k（與線上 bot 相同的檢索路徑）
  3. 若 top-k 中任一 chunk 的 metadata.lecture 屬於該題的 expected_lectures，
     即算命中（lecture-level hit）

Usage:
    python eval_retrieval.py            # top-5（與線上設定一致）
    python eval_retrieval.py --top-k 3  # 更嚴格的 k
"""

import argparse
import json
import os
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
from supabase import create_client

from config import EMBEDDING_MODEL

load_dotenv(Path(__file__).parent.parent / ".env")

_EMBED_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{EMBEDDING_MODEL}:embedContent"


def embed_query(text: str, api_key: str) -> list[float]:
    for attempt in range(6):
        resp = requests.post(
            _EMBED_URL,
            params={"key": api_key},
            json={
                "model": f"models/{EMBEDDING_MODEL}",
                "content": {"parts": [{"text": text}]},
                "taskType": "RETRIEVAL_QUERY",
            },
            timeout=30,
        )
        if resp.status_code == 429:
            wait = min(2 ** attempt, 30)
            print(f"  rate limited, waiting {wait}s...")
            time.sleep(wait)
            continue
        resp.raise_for_status()
        return resp.json()["embedding"]["values"]
    raise RuntimeError("Exceeded retry limit due to rate limiting")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--top-k", type=int, default=5, help="檢索筆數（線上 bot 為 5）")
    args = parser.parse_args()

    api_key = os.environ["GOOGLE_API_KEY"]
    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_KEY"],
    )

    dataset = json.loads(
        (Path(__file__).parent / "eval_questions.json").read_text(encoding="utf-8")
    )
    subject = dataset["subject"]
    questions = dataset["questions"]

    hits = 0
    misses = []
    print(f"=== Hit Rate@{args.top_k} 評估（{len(questions)} 題，subject={subject}）===\n")

    for q in questions:
        embedding = embed_query(q["question"], api_key)
        result = supabase.rpc(
            "match_documents",
            {
                "query_embedding": embedding,
                "match_count": args.top_k,
                "filter": {"subject": subject},
            },
        ).execute()
        rows = result.data or []

        retrieved = [r["metadata"].get("lecture", "?") for r in rows]
        expected = set(q["expected_lectures"])
        hit_rank = next(
            (i + 1 for i, lec in enumerate(retrieved) if lec in expected), None
        )

        if hit_rank:
            hits += 1
            status = f"HIT @{hit_rank}"
        else:
            status = "MISS"
            misses.append(q)

        top_str = ", ".join(
            f"{r['metadata'].get('lecture', '?')}({r['similarity']:.2f})" for r in rows
        )
        print(f"[{status:>6}] Q{q['id']:>2} {q['topic']}")
        print(f"         top-{args.top_k}: {top_str}")
        print(f"         期望: {sorted(expected)}\n")

        time.sleep(1.0)  # embedding 免費額度限速

    rate = hits / len(questions)
    print("=" * 50)
    print(f"Hit Rate@{args.top_k}: {hits}/{len(questions)} = {rate:.1%}")
    if misses:
        print(f"未命中: {', '.join(f'Q{m['id']}({m['topic']})' for m in misses)}")


if __name__ == "__main__":
    main()
