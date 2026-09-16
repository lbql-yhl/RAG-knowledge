from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config, ingest, md_render, rag

WEB_DIR = Path(__file__).resolve().parent.parent / "web"

app = FastAPI(title="企业知识库")
app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")


class AskRequest(BaseModel):
    question: str


class DocRequest(BaseModel):
    path: str
    content: str


class ContentRequest(BaseModel):
    content: str


class SyncRequest(BaseModel):
    source_dir: str


@app.get("/")
def index():
    return FileResponse(str(WEB_DIR / "index.html"))


@app.post("/api/ask")
def api_ask(req: AskRequest):
    if not config.DEEPSEEK_API_KEY:
        raise HTTPException(status_code=400, detail="未配置 DEEPSEEK_API_KEY")
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")
    return rag.ask(req.question.strip())


@app.get("/api/docs")
def api_docs():
    docs_dir = Path(config.DOCS_DIR)

    def walk(dirpath):
        dirs = []
        files = []
        for e in sorted(dirpath.iterdir()):
            if e.is_dir():
                child = walk(e)
                if child["dirs"] or child["files"]:
                    dirs.append(child)
            elif e.suffix.lower() == ".md":
                files.append({"path": e.relative_to(docs_dir).as_posix(), "name": e.stem})
        return {"name": dirpath.name, "dirs": dirs, "files": files}

    return {"tree": walk(docs_dir)}


@app.get("/api/doc/{path:path}")
def api_doc(path: str):
    docs_dir = Path(config.DOCS_DIR).resolve()
    full = (docs_dir / path).resolve()
    if not str(full).startswith(str(docs_dir)) or not full.exists() or full.suffix != ".md":
        raise HTTPException(status_code=404, detail="文档不存在")
    content = full.read_text(encoding="utf-8")
    return {"path": path, "content": content, "html": md_render.render(content)}


def _resolve_doc(path):
    docs_dir = Path(config.DOCS_DIR).resolve()
    full = (docs_dir / path).resolve()
    if not full.is_relative_to(docs_dir):
        raise HTTPException(status_code=400, detail="非法路径")
    if full.suffix.lower() != ".md":
        raise HTTPException(status_code=400, detail="仅支持 .md 文档")
    return full


@app.post("/api/doc")
def create_doc(req: DocRequest):
    path = req.path.strip().strip("/")
    if not path:
        raise HTTPException(status_code=400, detail="路径不能为空")
    if not path.lower().endswith(".md"):
        path += ".md"
    full = _resolve_doc(path)
    if full.exists():
        raise HTTPException(status_code=409, detail="文档已存在")
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(req.content, encoding="utf-8")
    chunks = ingest.ingest_one(path, req.content)
    return {"path": path, "chunks": chunks}


@app.put("/api/doc/{path:path}")
def update_doc(path: str, req: ContentRequest):
    full = _resolve_doc(path)
    if not full.exists():
        raise HTTPException(status_code=404, detail="文档不存在")
    full.write_text(req.content, encoding="utf-8")
    chunks = ingest.ingest_one(path, req.content)
    return {"path": path, "chunks": chunks}


@app.delete("/api/doc/{path:path}")
def delete_doc(path: str):
    full = _resolve_doc(path)
    if not full.exists():
        raise HTTPException(status_code=404, detail="文档不存在")
    full.unlink()
    ingest.delete_source(path)
    return {"ok": True}


@app.post("/api/upload")
async def upload_docs(files: list[UploadFile] = File(...), dir: str = Form("")):
    docs_dir = Path(config.DOCS_DIR).resolve()
    target_dir = docs_dir
    if dir.strip():
        target_dir = (docs_dir / dir.strip().strip("/")).resolve()
        if not target_dir.is_relative_to(docs_dir):
            raise HTTPException(status_code=400, detail="非法目录")
    target_dir.mkdir(parents=True, exist_ok=True)

    uploaded = []
    for f in files:
        name = Path(f.filename or "").name
        if not name or not name.lower().endswith(".md"):
            continue
        dest = target_dir / name
        content = (await f.read()).decode("utf-8")
        dest.write_text(content, encoding="utf-8")
        rel = dest.relative_to(docs_dir).as_posix()
        chunks = await run_in_threadpool(ingest.ingest_one, rel, content)
        uploaded.append({"path": rel, "chunks": chunks})
    return {"uploaded": uploaded}


@app.post("/api/sync")
def sync_dir(req: SyncRequest):
    source = Path(req.source_dir.strip()).resolve()
    if not source.exists() or not source.is_dir():
        raise HTTPException(status_code=400, detail="源目录不存在")
    docs_dir = Path(config.DOCS_DIR).resolve()
    synced = []
    for f in sorted(source.rglob("*.md")):
        rel = f.relative_to(source)
        dest = docs_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        content = f.read_text(encoding="utf-8")
        dest.write_text(content, encoding="utf-8")
        rel_path = dest.relative_to(docs_dir).as_posix()
        ingest.ingest_one(rel_path, content)
        synced.append(rel_path)
    return {"count": len(synced), "synced": synced}


@app.post("/api/ingest")
def api_ingest():
    return ingest.run_ingest()
