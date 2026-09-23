import hashlib
from pathlib import Path

from qdrant_client.models import PointStruct

from . import chunker, config, db, embedder, store

LIBRARY_DIRS = {
    "运维": "ops", "ops": "ops", "it": "ops",
    "人工智能": "ai", "ai": "ai", "AI知识": "ai",
    "开发": "dev", "dev": "dev", "游戏开发文档": "dev",
    "运营": "ops_business", "ops_business": "ops_business", "examples": "ops_business",
    "HR": "hr", "hr": "hr", "公司招聘": "hr",
    "股票知识": "ops_business",
}


def library_for_source(source):
    first = Path(source).parts[0] if Path(source).parts else ""
    return LIBRARY_DIRS.get(first, "ops_business")


def _build_points(source, content):
    library = library_for_source(source)
    chunks = chunker.split_markdown(content, source)
    points = []
    enriched = []
    if not chunks:
        return points, enriched
    texts = [c["text"] for c in chunks]
    vectors = embedder.embed_documents(texts)
    for c, vec in zip(chunks, vectors):
        cid = hashlib.md5(f"{source}::{c['heading']}::{c['text'][:200]}".encode()).hexdigest()
        c = {**c, "id": cid, "library": library}
        enriched.append(c)
        points.append(
            PointStruct(
                id=cid,
                vector=vec,
                payload={
                    "source": c["source"],
                    "title": c["title"],
                    "heading": c["heading"],
                    "text": c["text"],
                    "library": library,
                },
            )
        )
    return points, enriched


def run_ingest():
    md_files = sorted(Path(config.DOCS_DIR).rglob("*.md"))
    all_chunks = []
    all_sources = set()
    for f in md_files:
        rel = f.relative_to(config.DOCS_DIR).as_posix()
        all_sources.add(rel)
        text = f.read_text(encoding="utf-8")
        points, chunks = _build_points(rel, text)
        all_chunks.extend(chunks)
        store.replace_source(rel, points)
        db.replace_search_chunks(rel, chunks)

    with db._connect() as conn:
        stale = [row["source"] for row in conn.execute("SELECT DISTINCT source FROM search_chunks").fetchall() if row["source"] not in all_sources]
    for source in stale:
        db.delete_search_source(source)
        store.delete_source(source)
    return {"files": len(md_files), "chunks": len(all_chunks)}


def ingest_one(source, content):
    points, chunks = _build_points(source, content)
    store.replace_source(source, points)
    db.replace_search_chunks(source, chunks)
    return len(points)


def delete_source(source):
    store.delete_source(source)
    db.delete_search_source(source)
