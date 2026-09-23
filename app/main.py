import re
import sqlite3
import mimetypes
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from openai import APIConnectionError, APIStatusError, AuthenticationError, RateLimitError
from pydantic import BaseModel, Field

from . import config, db, ingest, md_render, rag

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
# 字体与常用前端资源的 MIME 修正，避免被识别为 octet-stream 导致浏览器拒绝加载
for _ext, _mime in ((".ttf", "font/ttf"), (".woff", "font/woff"), (".woff2", "font/woff2"), (".otf", "font/otf")):
    mimetypes.add_type(_mime, _ext)
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


class PermissionReviewRequest(BaseModel):
    status: str


class ProfileRequest(BaseModel):
    display_name: Optional[str] = None
    avatar: Optional[str] = None


def _set_session(response: Response, user_id: int):
    response.set_cookie(
        config.SESSION_COOKIE, db.create_session(user_id), httponly=True,
        samesite="lax", max_age=14 * 24 * 60 * 60,
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


def _has_library(user, library):
    return user["role"] == "admin" or db.has_permission(user["id"], library)


def _require_library(user, library):
    if not _has_library(user, library):
        raise HTTPException(status_code=403, detail=f"你没有“{library}”知识库权限，请先申请并等待管理员审批")


def _library_name(key):
    for item in db.PERMISSION_CATALOG:
        if item["key"] == key:
            return item["name"]
    return key


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


DISPLAY_NAME_RE = re.compile(r"[\u4e00-\u9fffA-Za-z]{1,20}")
AVATAR_RE = re.compile(r"data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+")


@app.get("/api/profile")
def api_profile(user=Depends(current_user)):
    profile = db.get_profile(user["id"])
    if profile is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    return profile


@app.post("/api/profile")
def api_update_profile(req: ProfileRequest, user=Depends(current_user)):
    if req.display_name is None and req.avatar is None:
        raise HTTPException(status_code=400, detail="没有要修改的内容")
    display_name = req.display_name
    if display_name is not None:
        display_name = display_name.strip()
        if not DISPLAY_NAME_RE.fullmatch(display_name):
            raise HTTPException(status_code=400, detail="名称只能包含中文和英文字符（1–20 个）")
    if req.avatar is not None and (len(req.avatar) > 400_000 or not AVATAR_RE.fullmatch(req.avatar)):
        raise HTTPException(status_code=400, detail="头像格式不支持或过大，请换一张 300KB 以内的图片")
    ok, error = db.update_profile(user["id"], display_name, req.avatar)
    if not ok:
        raise HTTPException(status_code=429, detail=error)
    return {"ok": True, "profile": db.get_profile(user["id"])}


@app.get("/api/quota")
def quota(user=Depends(current_user)):
    return db.quota_status(user["id"])


@app.get("/api/permissions")
def permissions(user=Depends(current_user)):
    statuses = db.permission_statuses(user["id"])
    return {"catalog": db.list_permissions(), "permissions": statuses, "approved": db.approved_permissions(user["id"]), "is_admin": user["role"] == "admin"}


@app.post("/api/permissions/{permission_key}/request")
def request_permission(permission_key: str, user=Depends(current_user)):
    item = db.request_permission(user["id"], permission_key)
    if item is None:
        raise HTTPException(status_code=404, detail="权限不存在")
    return {"ok": True, "request": item, "permissions": db.permission_statuses(user["id"])}


@app.get("/api/admin/users")
def admin_users(_admin=Depends(admin_user)):
    return {"users": db.list_users()}


@app.get("/api/admin/permission-requests")
def admin_permission_requests(_admin=Depends(admin_user)):
    return {"requests": db.list_permission_requests()}


@app.post("/api/admin/permission-requests/{request_id}")
def review_permission(request_id: int, req: PermissionReviewRequest, admin=Depends(admin_user)):
    result = db.review_permission(request_id, req.status, admin["id"])
    if result is None:
        raise HTTPException(status_code=404, detail="权限申请不存在，或审批状态不合法")
    return {"ok": True, "request": result}


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


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: int, admin=Depends(admin_user)):
    result = db.delete_user(user_id, admin["id"])
    messages = {
        "not_found": (404, "用户不存在"),
        "self": (400, "不能删除当前登录的管理员账号"),
        "admin": (400, "不能通过此入口删除管理员账号"),
    }
    if result in messages:
        status, detail = messages[result]
        raise HTTPException(status_code=status, detail=detail)
    return {"ok": True, "deleted_user_id": user_id}


@app.post("/api/ask")
def api_ask(req: AskRequest, user=Depends(current_user)):
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")
    # 没有任何已审批知识库时直接拒答，不消耗用户的 AI 咨询额度。
    if not db.approved_permissions(user["id"]):
        result = rag.ask(question, user["id"])
        result["quota"] = db.quota_status(user["id"])
        return result

    quota_info = db.consume_quota(user["id"])
    if quota_info is None:
        raise HTTPException(
            status_code=429,
            detail=f"今日咨询次数已用完（每天最多 {config.DAILY_ASK_LIMIT} 次），请明天再来。",
            headers={"Retry-After": "3600"},
        )
    try:
        result = rag.ask(question, user["id"])
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except AuthenticationError:
        raise HTTPException(
            status_code=502,
            detail="大模型服务认证失败：请检查 .env 中的 DEEPSEEK_API_KEY 是否有效（当前 Key 被服务端拒绝）。",
        )
    except RateLimitError:
        raise HTTPException(
            status_code=503,
            detail="大模型服务限流或余额不足，请稍后重试或检查账户额度。",
        )
    except APIConnectionError:
        raise HTTPException(
            status_code=504,
            detail="无法连接大模型服务（网络或代理问题），请检查 DEEPSEEK_BASE_URL 与网络连通性。",
        )
    except APIStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"大模型服务返回异常状态 {exc.status_code}：{str(exc)[:200]}",
        )
    except Exception as exc:  # 兜底：避免把 500 堆栈直接抛给前端
        raise HTTPException(
            status_code=500,
            detail=f"问答处理失败（{type(exc).__name__}）：{str(exc)[:200]}",
        )
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


def _doc_tree(user):
    docs_dir = Path(config.DOCS_DIR)
    docs_dir.mkdir(parents=True, exist_ok=True)

    def walk(dirpath):
        dirs, files = [], []
        for entry in sorted(dirpath.iterdir()):
            if entry.is_dir():
                child = walk(entry)
                if child["dirs"] or child["files"]:
                    dirs.append(child)
            elif entry.suffix.lower() == ".md":
                path = entry.relative_to(docs_dir).as_posix()
                library = ingest.library_for_source(path)
                if _has_library(user, library):
                    files.append({"path": path, "name": entry.stem, "library": library})
        return {"name": dirpath.name, "dirs": dirs, "files": files}

    return walk(docs_dir)


@app.get("/api/docs")
def api_docs(user=Depends(current_user)):
    return {"tree": _doc_tree(user), "libraries": db.permission_statuses(user["id"]), "approved": db.approved_permissions(user["id"])}


@app.get("/api/doc/{path:path}")
def api_doc(path: str, user=Depends(current_user)):
    docs_dir = Path(config.DOCS_DIR).resolve()
    full = (docs_dir / path).resolve()
    if not full.is_relative_to(docs_dir) or not full.exists() or full.suffix.lower() != ".md":
        raise HTTPException(status_code=404, detail="文档不存在")
    _require_library(user, ingest.library_for_source(path))
    content = full.read_text(encoding="utf-8")
    return {"path": path, "library": ingest.library_for_source(path), "content": content, "html": md_render.render(content)}


def _resolve_doc(path):
    docs_dir = Path(config.DOCS_DIR).resolve()
    full = (docs_dir / path).resolve()
    if not full.is_relative_to(docs_dir):
        raise HTTPException(status_code=400, detail="非法路径")
    if full.suffix.lower() != ".md":
        raise HTTPException(status_code=400, detail="仅支持 .md 文档")
    return full


@app.post("/api/doc")
def create_doc(req: DocRequest, user=Depends(current_user)):
    path = req.path.strip().strip("/")
    if not path:
        raise HTTPException(status_code=400, detail="路径不能为空")
    if not path.lower().endswith(".md"):
        path += ".md"
    library = ingest.library_for_source(path)
    full = _resolve_doc(path)
    # 目录（或同名文档）在文件系统里已存在，但当前用户无该库权限 → 明确提示“已存在，请申请权限”
    if (full.parent.exists() or full.exists()) and not _has_library(user, library):
        raise HTTPException(
            status_code=403,
            detail=f"该目录已存在，但你没有「{_library_name(library)}」知识库的访问权限，请先申请权限",
        )
    _require_library(user, library)
    if full.exists():
        raise HTTPException(status_code=409, detail="文档已存在")
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(req.content, encoding="utf-8")
    chunks = ingest.ingest_one(path, req.content)
    return {"path": path, "library": library, "chunks": chunks}


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
        rel = dest.relative_to(docs_dir).as_posix()
        _require_library(user, ingest.library_for_source(rel))
        if dest.exists() and user["role"] != "admin":
            raise HTTPException(status_code=409, detail="普通用户只能创建新文档，不能覆盖已有文档")
        content = (await f.read()).decode("utf-8")
        dest.write_text(content, encoding="utf-8")
        chunks = await run_in_threadpool(ingest.ingest_one, rel, content)
        uploaded.append({"path": rel, "library": ingest.library_for_source(rel), "chunks": chunks})
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
