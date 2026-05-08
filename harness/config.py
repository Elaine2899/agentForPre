from pathlib import Path

ROOT = Path(__file__).parent.parent

SUBJECTS = {
    "statistics": {
        "label": "統計學（唐麗英老師）",
        "data_dir": ROOT / "data",
        "patterns": ["Lec*.txt", "ProLec*.txt"],
    },
}

CHUNK_LINES = 20
OVERLAP_LINES = 5
EMBED_BATCH_SIZE = 50
EMBEDDING_MODEL = "gemini-embedding-001"  # 3072 dims, v1beta REST API
