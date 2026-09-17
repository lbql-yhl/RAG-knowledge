import re
import sqlite3
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config, db, ingest, md_render, rag

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
app = FastAPI(title="x公司知识库")
app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")


class AuthRequest(BaseModel):
    username: str = Field(min_length=3, max_length=40)
    password: str = Field(min_length=6, max_length=128)


class AskRequest(BaseModel):
    question: str


class FeedbackRequest(BaseModel):
    answer_id: int
    rating: int = Field(ge=1, le=5)
    reason: str = ""


class DocRequest(BaseModel):
    path: str
    content: str


class ContentRequest(BaseModel):
    content: str


class SyncRequest(BaseModel):
    source_dir: str


def _set_session(response: Response, user_id: int):
    response.set_cookie(
        config.SESSION_COOKIE,
        db.create_session(user_id),
        httponly=True,
        samesite="lax",
        max_age=14 * 24 * 60 * 60,
    )


def current_user(request: Request):
    user = db.get_user_by_session(request.cookies.get(config.SESSION_COOKIE))
    if not user:
        raise HTTPException(status_code=401, detail="请先登录")
    return user


def admin_user(user=Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


@app.get("/")
def index():
    return FileResponse(str(WEB_DIR / "index.html"))


@app.post("/api/auth/register")
def register(req: AuthRequest, response: Response):
    username = req.username.strip()
    if not re.fullmatch(r"[A-Za-z0-9_\-\u4e00-\u9fff]{3,40}", username):
        raise HTTPException(status_code=400, detail="用户名需为 3-40 个字的中文、字母、数字、下划线或连字符")
    user = db.create_user(username, req.password)
    if not user:
        raise HTTPException(status_code=409, detail="用户名已存在")
    _set_session(response, user["id"])
    return {"user": user, "quota": db.quota_status(user["id"])}


@app.post("/api/auth/login")
def login(req: AuthRequest, response: Response):
    user = db.authenticate(req.username, req.password)
    if not user:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    _set_session(response, user["id"])
    return {"user": user, "quota": db.quota_status(user["id"])}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    db.delete_session(request.cookies.get(config.SESSION_COOKIE))
    response.delete_cookie(config.SESSION_COOKIE)
    return {"ok": True}


@app.get("/api/auth/me")
def me(user=Depends(current_user)):
    return {"user": user, "quota": db.quota_status(user["id"])}


@app.get("/api/quota")
def quota(user=Depends(current_user)):
    return db.quota_status(user["id"])


@app.get("/api/admin/users")
def admin_users(_admin=Depends(admin_user)):
    return {"users": db.list_users()}


@app.post("/api/admin/users/{user_id}/reset-quota")
def admin_reset_quota(user_id: int, _admin=Depends(admin_user)):
    users = {user["id"]: user for user in db.list_users()}
    target = users.get(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target["role"] == "admin":
        raise HTTPException(status_code=400, detail="管理员没有每日额度，无需重置")
    if not db.reset_quota(user_id):
        raise HTTPException(status_code=404, detail="用户不存在")
    return {"ok": True, "user": {**target, "quota": db.quota_status(user_id)}}


@app.post("/api/ask")
def api_ask(req: AskRequest, user=Depends(current_user)):
    if not config.DEEPSEEK_API_KEY:
        raise HTTPException(status_code=400, detail="未配置 DEEPSEEK_API_KEY")
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")
    quota_info = db.consume_quota(user["id"])
    if quota_info is None:
        raise HTTPException(
            status_code=429,
            detail=f"今日咨询次数已用完（每天最多 {config.DAILY_ASK_LIMIT} 次），请明天再来。",
            headers={"Retry-After": "3600"},
        )
    result = rag.ask(question, user["id"])
    result["quota"] = quota_info
    return result


@app.post("/api/feedback")
def feedback(req: FeedbackRequest, user=Depends(current_user)):
    reason = req.reason.strip()
    if req.rating < 5 and len(reason) < 10:
        raise HTTPException(status_code=422, detail="5 星以下请填写至少 10 个字符的原因")
    answer = db.answer_for_user(req.answer_id, user["id"])
    if not answer:
        raise HTTPException(status_code=404, detail="找不到这条回答")
    try:
        feedback_id = db.save_feedback(req.answer_id, user["id"], req.rating, reason)
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="这条回答已经评价过了")
    learning = None
    if req.rating < 5:
        learning = rag.learn_from_feedback(
            user["id"], feedback_id, answer["question"], answer["answer"], req.rating, reason
        )
    return {"ok": True, "learning": learning}


@app.get("/api/docs")
def api_docs(_user=Depends(current_user)):
    docs_dir = Path(config.DOCS_DIR)
    docs_dir.mkdir(parents=True, exist_ok=True)

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
def api_doc(path: str, _user=Depends(current_user)):
    docs_dir = Path(config.DOCS_DIR).resolve()
    full = (docs_dir / path).resolve()
    if not full.is_relative_to(docs_dir) or not full.exists() or full.suffix.lower() != ".md":
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
def create_doc(req: DocRequest, _user=Depends(current_user)):
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
def update_doc(path: str, req: ContentRequest, _admin=Depends(admin_user)):
    full = _resolve_doc(path)
    if not full.exists():
        raise HTTPException(status_code=404, detail="文档不存在")
    full.write_text(req.content, encoding="utf-8")
    chunks = ingest.ingest_one(path, req.content)
    return {"path": path, "chunks": chunks}


@app.delete("/api/doc/{path:path}")
def delete_doc(path: str, _admin=Depends(admin_user)):
    full = _resolve_doc(path)
    if not full.exists():
        raise HTTPException(status_code=404, detail="文档不存在")
    full.unlink()
    ingest.delete_source(path)
    return {"ok": True}


@app.post("/api/upload")
async def upload_docs(files: list[UploadFile] = File(...), dir: str = Form(""), user=Depends(current_user)):
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
        if dest.exists() and user["role"] != "admin":
            raise HTTPException(status_code=409, detail="普通用户只能创建新文档，不能覆盖已有文档")
        content = (await f.read()).decode("utf-8")
        dest.write_text(content, encoding="utf-8")
        rel = dest.relative_to(docs_dir).as_posix()
        chunks = await run_in_threadpool(ingest.ingest_one, rel, content)
        uploaded.append({"path": rel, "chunks": chunks})
    return {"uploaded": uploaded}


@app.post("/api/sync")
def sync_dir(req: SyncRequest, _admin=Depends(admin_user)):
    source = Path(req.source_dir.strip()).resolve()
    if not source.exists() or not source.is_dir():
        raise HTTPException(status_code=400, detail="源目录不存在")
    docs_dir = Path(config.DOCS_DIR)
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
def api_ingest(_admin=Depends(admin_user)):
    return ingest.run_ingest()
