"""
Ingestion script: reads lecture transcripts, embeds with gemini-embedding-001
via v1beta REST API, and inserts into Supabase.

Usage:
    python ingest.py                          # all subjects, skip already-ingested lectures
    python ingest.py --subject statistics     # one subject only
    python ingest.py --file Lec08            # single lecture file (stem name)
    python ingest.py --clear                  # delete ALL rows for subject, then re-ingest
    python ingest.py --file Lec08 --clear    # re-ingest one specific file
"""

import argparse
import os
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
from supabase import create_client

from chunker import chunk_file
from config import EMBED_BATCH_SIZE, EMBEDDING_MODEL, SUBJECTS

load_dotenv(Path(__file__).parent.parent / ".env")

_EMBED_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{EMBEDDING_MODEL}:embedContent"

_supabase = None
_api_key: str = ""


def get_clients():
    global _supabase, _api_key
    _api_key = os.environ["GOOGLE_API_KEY"]
    _supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_KEY"],
    )
    return _supabase


def ingested_count(supabase, subject: str, lecture: str) -> int:
    """Return how many chunks are already in Supabase for this lecture."""
    result = (
        supabase.table("documents")
        .select("id", count="exact")
        .eq("metadata->>subject", subject)
        .eq("metadata->>lecture", lecture)
        .execute()
    )
    return result.count or 0


def clear_lecture(supabase, subject: str, lecture: str) -> None:
    supabase.table("documents").delete().eq(
        "metadata->>subject", subject
    ).eq("metadata->>lecture", lecture).execute()


def embed_one(text: str) -> list[float]:
    for attempt in range(8):
        resp = requests.post(
            _EMBED_URL,
            params={"key": _api_key},
            json={
                "model": f"models/{EMBEDDING_MODEL}",
                "content": {"parts": [{"text": text}]},
                "taskType": "RETRIEVAL_DOCUMENT",
            },
            timeout=30,
        )
        if resp.status_code == 429:
            wait = min(2 ** attempt, 60)
            print(f"\n  Rate limited — waiting {wait}s (attempt {attempt + 1}/8)...")
            time.sleep(wait)
            continue
        resp.raise_for_status()
        return resp.json()["embedding"]["values"]
    raise RuntimeError("Exceeded retry limit due to rate limiting")


def embed_batch(texts: list[str]) -> list[list[float]]:
    embeddings = []
    for text in texts:
        embeddings.append(embed_one(text))
        time.sleep(1.0)  # ~60 RPM, safe for free tier
    return embeddings


def ingest_file(supabase, path: Path, subject_key: str, force: bool) -> int:
    """Embed and insert one lecture file. Returns number of rows inserted (0 if skipped)."""
    lecture_stem = path.stem
    chunks = chunk_file(path, subject_key)
    expected = len(chunks)

    existing = ingested_count(supabase, subject_key, lecture_stem)
    if not force and existing >= expected:
        print(f"  {path.name}: already ingested ({existing} chunks), skipping")
        return 0

    if existing > 0:
        print(f"  {path.name}: partial ({existing}/{expected}), clearing and re-ingesting")
        clear_lecture(supabase, subject_key, lecture_stem)
    elif force:
        clear_lecture(supabase, subject_key, lecture_stem)
    print(f"  {path.name}: {len(chunks)} chunks — embedding...")

    inserted = 0
    for i in range(0, len(chunks), EMBED_BATCH_SIZE):
        batch = chunks[i : i + EMBED_BATCH_SIZE]
        embeddings = embed_batch([c["content"] for c in batch])
        rows = [
            {"content": c["content"], "embedding": emb, "metadata": c["metadata"]}
            for c, emb in zip(batch, embeddings)
        ]
        supabase.table("documents").insert(rows).execute()
        inserted += len(rows)
        print(f"    {inserted}/{len(chunks)}", end="\r")

    print(f"    {path.name}: done ({inserted} rows)")
    return inserted


def ingest_subject(supabase, subject_key: str, file_stem: str | None, clear: bool) -> None:
    cfg = SUBJECTS[subject_key]
    print(f"\n=== {cfg['label']} ===")

    if clear and file_stem is None:
        supabase.table("documents").delete().eq(
            "metadata->>subject", subject_key
        ).execute()
        print("  Cleared all rows for subject.")

    paths: list[Path] = []
    if file_stem:
        for pattern in cfg["patterns"]:
            matches = list(cfg["data_dir"].glob(pattern))
            for p in matches:
                if p.stem == file_stem:
                    paths.append(p)
        if not paths:
            print(f"  File '{file_stem}' not found in {cfg['data_dir']}")
            return
    else:
        for pattern in cfg["patterns"]:
            paths.extend(sorted(cfg["data_dir"].glob(pattern)))

    total = 0
    for path in paths:
        total += ingest_file(supabase, path, subject_key, force=(clear and file_stem is not None) or (clear and file_stem is None))

    print(f"\n  Total inserted this run: {total} rows")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--subject", choices=list(SUBJECTS.keys()))
    parser.add_argument("--file", help="Lecture stem name, e.g. Lec08 or ProLec03")
    parser.add_argument("--clear", action="store_true", help="Delete existing rows before re-ingesting")
    args = parser.parse_args()

    supabase = get_clients()

    targets = [args.subject] if args.subject else list(SUBJECTS.keys())
    for key in targets:
        ingest_subject(supabase, key, args.file, args.clear)

    print("\nIngestion complete.")


if __name__ == "__main__":
    main()
