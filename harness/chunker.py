from pathlib import Path
from config import CHUNK_LINES, OVERLAP_LINES


def _parse_lines(path: Path) -> list[str]:
    """Strip line-number prefix from whisper transcript (format: `N\ttext`)."""
    lines = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        if "\t" in raw:
            lines.append(raw.split("\t", 1)[1].strip())
        else:
            stripped = raw.strip()
            if stripped:
                lines.append(stripped)
    return lines


def _lecture_label(filename: str) -> tuple[str, str]:
    """Return (lecture_id, type) from filename, e.g. 'Lec03' → ('Lec03', 'lec')."""
    stem = Path(filename).stem
    if stem.lower().startswith("prolec"):
        return stem, "prolec"
    return stem, "lec"


def chunk_file(path: Path, subject: str) -> list[dict]:
    """Split a transcript file into overlapping chunks with metadata."""
    lines = _parse_lines(path)
    lecture_id, lecture_type = _lecture_label(path.name)

    chunks = []
    step = CHUNK_LINES - OVERLAP_LINES
    for i in range(0, len(lines), step):
        window = lines[i : i + CHUNK_LINES]
        content = "".join(window).strip()
        if not content:
            continue
        chunks.append({
            "content": content,
            "metadata": {
                "subject": subject,
                "lecture": lecture_id,
                "type": lecture_type,
                "chunk_id": len(chunks),
                "start_line": i,
            },
        })
    return chunks
