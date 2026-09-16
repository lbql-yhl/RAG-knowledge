import hashlib
from pathlib import Path

from qdrant_client.models import PointStruct

from . import chunker, config, embedder, store


def run_ingest():
    md_files = sorted(Path(config.DOCS_DIR).rglob("*.md"))
    all_chunks = []
    for f in md_files:
        rel = f.relative_to(config.DOCS_DIR).as_posix()
        text = f.read_text(encoding="utf-8")
        for c in chunker.split_markdown(text, rel):
            cid = hashlib.md5(f"{rel}::{c['heading']}::{c['text'][:200]}".encode()).hexdigest()
            c["id"] = cid
            all_chunks.append(c)

    points = []
    if all_chunks:
        texts = [c["text"] for c in all_chunks]
        vectors = embedder.embed_documents(texts)
        for c, vec in zip(all_chunks, vectors):
            points.append(
                PointStruct(
                    id=c["id"],
                    vector=vec,
                    payload={
                        "source": c["source"],
                        "title": c["title"],
                        "heading": c["heading"],
                        "text": c["text"],
                    },
                )
            )
        store.upsert(points)

    return {"files": len(md_files), "chunks": len(points)}


def ingest_one(source, content):
    chunks = chunker.split_markdown(content, source)
    points = []
    if chunks:
        texts = [c["text"] for c in chunks]
        vectors = embedder.embed_documents(texts)
        for c, vec in zip(chunks, vectors):
            cid = hashlib.md5(f"{source}::{c['heading']}::{c['text'][:200]}".encode()).hexdigest()
            points.append(
                PointStruct(
                    id=cid,
                    vector=vec,
                    payload={
                        "source": c["source"],
                        "title": c["title"],
                        "heading": c["heading"],
                        "text": c["text"],
                    },
                )
            )
    store.replace_source(source, points)
    return len(points)


def delete_source(source):
    store.delete_source(source)
