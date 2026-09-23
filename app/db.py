import hashlib
import hmac
import re
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import config

_DB_PATH = Path(config.DB_PATH)
PERMISSION_CATALOG = (
    {"key": "ops", "name": "运维", "description": "服务器、网络、安全与发布运维资料"},
    {"key": "ai", "name": "人工智能", "description": "模型、Agent、提示词与知识库资料"},
    {"key": "dev", "name": "开发", "description": "产品研发、代码规范与工程技术资料"},
    {"key": "ops_business", "name": "运营", "description": "业务流程、客户服务与运营规范资料"},
    {"key": "hr", "name": "HR", "description": "人事制度、招聘、培训与员工服务资料"},
)
PERMISSION_KEYS = {item["key"] for item in PERMISSION_CATALOG}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _today():
    return (datetime.now(timezone.utc) + timedelta(hours=8)).date().isoformat()


def _connect():
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
            CREATE TABLE IF NOT EXISTS daily_usage (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                usage_date TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, usage_date)
            );
            CREATE TABLE IF NOT EXISTS answers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                sources_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_answers_user ON answers(user_id, created_at DESC);
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                answer_id INTEGER NOT NULL UNIQUE REFERENCES answers(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
                reason TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS assistant_memory (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                summary TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS learning_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                feedback_id INTEGER NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
                note TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS permission_catalog (
                permission_key TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS permission_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                permission_key TEXT NOT NULL REFERENCES permission_catalog(permission_key) ON DELETE CASCADE,
                status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
                requested_at TEXT NOT NULL,
                reviewed_at TEXT,
                reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                UNIQUE(user_id, permission_key)
            );
            CREATE INDEX IF NOT EXISTS idx_permission_requests_status ON permission_requests(status, requested_at DESC);
            CREATE TABLE IF NOT EXISTS search_chunks (
                chunk_id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                title TEXT NOT NULL,
                heading TEXT NOT NULL DEFAULT '',
                text TEXT NOT NULL,
                library TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_search_chunks_source ON search_chunks(source);
            CREATE INDEX IF NOT EXISTS idx_search_chunks_library ON search_chunks(library);
            CREATE VIRTUAL TABLE IF NOT EXISTS search_chunks_fts USING fts5(
                chunk_id UNINDEXED,
                source,
                title,
                heading,
                text,
                library UNINDEXED,
                tokenize = 'unicode61'
            );
            """
        )
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "role" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
        if "display_name" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''")
        if "avatar" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''")
        if "profile_edit_month" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN profile_edit_month TEXT NOT NULL DEFAULT ''")
        if "profile_edit_count" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN profile_edit_count INTEGER NOT NULL DEFAULT 0")
        for item in PERMISSION_CATALOG:
            conn.execute(
                "INSERT INTO permission_catalog(permission_key, name, description) VALUES (?, ?, ?) ON CONFLICT(permission_key) DO UPDATE SET name=excluded.name, description=excluded.description",
                (item["key"], item["name"], item["description"]),
            )
        _rebuild_fts_index(conn)


def _fts_terms(value):
    """将中文拆成二元词，避免 SQLite unicode61 把整段中文当成一个词。"""
    terms = []
    for part in re.findall(r"[\u4e00-\u9fff]+|[A-Za-z0-9_]+", (value or "").lower()):
        if re.fullmatch(r"[\u4e00-\u9fff]+", part):
            if len(part) == 1:
                terms.append(part)
            else:
                terms.extend(part[i:i + 2] for i in range(len(part) - 1))
        else:
            terms.append(part)
    return list(dict.fromkeys(terms))


def _fts_index_text(value):
    return " ".join(_fts_terms(value))


def _fts_query(value):
    terms = _fts_terms(value)
    return " OR ".join(f'"{term.replace(chr(34), "")}"' for term in terms)


def _rebuild_fts_index(conn):
    """search_chunks_fts 是派生索引，启动时重建以兼容旧版本索引。"""
    conn.execute("DELETE FROM search_chunks_fts")
    rows = conn.execute("SELECT chunk_id, source, title, heading, text, library FROM search_chunks").fetchall()
    conn.executemany(
        """INSERT INTO search_chunks_fts(chunk_id, source, title, heading, text, library)
           VALUES (?, ?, ?, ?, ?, ?)""",
        [
            (row["chunk_id"], _fts_index_text(row["source"]), _fts_index_text(row["title"]),
             _fts_index_text(row["heading"]), _fts_index_text(row["text"]), row["library"])
            for row in rows
        ],
    )


def _hash_password(password):
    salt = secrets.token_bytes(16)
    iterations = 310_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def _verify_password(password, encoded):
    try:
        algorithm, iterations, salt_hex, digest_hex = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
        )
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def _user_dict(row, include_permissions=False):
    result = {"id": row["id"], "username": row["username"], "role": row["role"]}
    if include_permissions:
        result["permissions"] = approved_permissions(row["id"])
    return result


def create_user(username, password, role="user"):
    username = username.strip()
    with _connect() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO users(username, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
                (username, _hash_password(password), role, _now()),
            )
        except sqlite3.IntegrityError:
            return None
        return {"id": cur.lastrowid, "username": username, "role": role, "permissions": []}


def authenticate(username, password):
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username.strip(),)).fetchone()
    if not row or not _verify_password(password, row["password_hash"]):
        return None
    return _user_dict(row, include_permissions=True)


def create_session(user_id, days=14):
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO sessions(token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (token, user_id, expires, _now()),
        )
    return token


def get_user_by_session(token):
    if not token:
        return None
    with _connect() as conn:
        row = conn.execute(
            """SELECT u.id, u.username, u.role, s.expires_at
               FROM sessions s JOIN users u ON u.id = s.user_id
               WHERE s.token = ?""",
            (token,),
        ).fetchone()
        if not row:
            return None
        if datetime.fromisoformat(row["expires_at"]) <= datetime.now(timezone.utc):
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            return None
        return _user_dict(row, include_permissions=True)


def delete_session(token):
    if token:
        with _connect() as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))


def quota_status(user_id):
    with _connect() as conn:
        user = conn.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
    if user and user["role"] == "admin":
        return {"used": 0, "limit": None, "remaining": None, "unlimited": True}
    with _connect() as conn:
        row = conn.execute(
            "SELECT count FROM daily_usage WHERE user_id = ? AND usage_date = ?",
            (user_id, _today()),
        ).fetchone()
    used = int(row["count"]) if row else 0
    return {"used": used, "limit": config.DAILY_ASK_LIMIT, "remaining": max(0, config.DAILY_ASK_LIMIT - used)}


def consume_quota(user_id):
    with _connect() as conn:
        user = conn.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
    if user and user["role"] == "admin":
        return {"used": 0, "limit": None, "remaining": None, "unlimited": True}
    today = _today()
    with _connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT count FROM daily_usage WHERE user_id = ? AND usage_date = ?",
            (user_id, today),
        ).fetchone()
        used = int(row["count"]) if row else 0
        if used >= config.DAILY_ASK_LIMIT:
            return None
        if row:
            conn.execute(
                "UPDATE daily_usage SET count = count + 1 WHERE user_id = ? AND usage_date = ?",
                (user_id, today),
            )
        else:
            conn.execute(
                "INSERT INTO daily_usage(user_id, usage_date, count) VALUES (?, ?, 1)",
                (user_id, today),
            )
    used += 1
    return {"used": used, "limit": config.DAILY_ASK_LIMIT, "remaining": config.DAILY_ASK_LIMIT - used}


def create_answer(user_id, question, answer, sources_json):
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO answers(user_id, question, answer, sources_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, question, answer, sources_json, _now()),
        )
        return cur.lastrowid


def answer_for_user(answer_id, user_id):
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM answers WHERE id = ? AND user_id = ?", (answer_id, user_id)
        ).fetchone()


def save_feedback(answer_id, user_id, rating, reason):
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO feedback(answer_id, user_id, rating, reason, created_at) VALUES (?, ?, ?, ?, ?)",
            (answer_id, user_id, rating, reason, _now()),
        )
        return cur.lastrowid


def get_memory(user_id):
    with _connect() as conn:
        row = conn.execute("SELECT summary FROM assistant_memory WHERE user_id = ?", (user_id,)).fetchone()
        return row["summary"] if row else ""


def recent_answers(user_id, limit=5):
    with _connect() as conn:
        return conn.execute(
            "SELECT question, answer, created_at FROM answers WHERE user_id = ? ORDER BY id DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()


def save_learning(user_id, feedback_id, note, summary):
    with _connect() as conn:
        conn.execute(
            "INSERT INTO learning_notes(user_id, feedback_id, note, created_at) VALUES (?, ?, ?, ?)",
            (user_id, feedback_id, note, _now()),
        )
        conn.execute(
            """INSERT INTO assistant_memory(user_id, summary, updated_at) VALUES (?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET summary=excluded.summary, updated_at=excluded.updated_at""",
            (user_id, summary, _now()),
        )


def list_users():
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, username, role, created_at FROM users ORDER BY id"
        ).fetchall()
    return [
        {"id": row["id"], "username": row["username"], "role": row["role"],
         "created_at": row["created_at"], "quota": quota_status(row["id"]),
         "permissions": permission_statuses(row["id"])}
        for row in rows
    ]


def reset_quota(user_id):
    with _connect() as conn:
        row = conn.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            return False
        conn.execute(
            "DELETE FROM daily_usage WHERE user_id = ? AND usage_date = ?",
            (user_id, _today()),
        )
    return True


def delete_user(user_id, actor_id):
    """删除普通用户；禁止管理员删除自己或其他管理员账号。"""
    with _connect() as conn:
        target = conn.execute("SELECT id, role FROM users WHERE id = ?", (user_id,)).fetchone()
        if not target:
            return "not_found"
        if target["id"] == actor_id:
            return "self"
        if target["role"] == "admin":
            return "admin"
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    return "deleted"


# ---- 用户资料（显示名称 / 头像，每月限改 2 次） ----

PROFILE_EDIT_LIMIT = 2


def _profile_month():
    return _today()[:7]  # YYYY-MM（UTC+8 自然月）


def get_profile(user_id):
    with _connect() as conn:
        row = conn.execute(
            "SELECT username, display_name, avatar, profile_edit_month, profile_edit_count FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    if not row:
        return None
    used = row["profile_edit_count"] if row["profile_edit_month"] == _profile_month() else 0
    return {
        "username": row["username"],
        "display_name": row["display_name"] or row["username"],
        "avatar": row["avatar"] or None,
        "edits_used": used,
        "edits_limit": PROFILE_EDIT_LIMIT,
        "edits_left": max(0, PROFILE_EDIT_LIMIT - used),
    }


def update_profile(user_id, display_name=None, avatar=None):
    """修改显示名称 / 头像。参数为 None 表示该项不修改。

    返回 (ok, error)。内容没有任何实际变化时不消耗当月次数。"""
    with _connect() as conn:
        row = conn.execute(
            "SELECT username, display_name, avatar, profile_edit_month, profile_edit_count FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not row:
            return False, "用户不存在"
        current_name = row["display_name"] or row["username"]
        current_avatar = row["avatar"] or ""
        changed = (display_name is not None and display_name != current_name) or (
            avatar is not None and avatar != current_avatar
        )
        if not changed:
            return True, None
        month = _profile_month()
        used = row["profile_edit_count"] if row["profile_edit_month"] == month else 0
        if used >= PROFILE_EDIT_LIMIT:
            return False, f"本月资料修改次数已用完（每月 {PROFILE_EDIT_LIMIT} 次），下个月再试"
        new_name = display_name if display_name is not None else current_name
        new_avatar = avatar if avatar is not None else current_avatar
        conn.execute(
            "UPDATE users SET display_name = ?, avatar = ?, profile_edit_month = ?, profile_edit_count = ? WHERE id = ?",
            (new_name, new_avatar, month, used + 1, user_id),
        )
    return True, None


def set_admin(username, password):
    username = username.strip()
    with _connect() as conn:
        row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if row:
            conn.execute(
                "UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?",
                (_hash_password(password), row["id"]),
            )
            user_id = row["id"]
        else:
            cur = conn.execute(
                "INSERT INTO users(username, password_hash, role, created_at) VALUES (?, ?, 'admin', ?)",
                (username, _hash_password(password), _now()),
            )
            user_id = cur.lastrowid
    return {"id": user_id, "username": username, "role": "admin", "permissions": list(PERMISSION_KEYS)}


# ---- 权限 ----

def list_permissions():
    return [dict(item) for item in PERMISSION_CATALOG]


def approved_permissions(user_id):
    with _connect() as conn:
        row = conn.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
        if row and row["role"] == "admin":
            return sorted(PERMISSION_KEYS)
        rows = conn.execute(
            "SELECT permission_key FROM permission_requests WHERE user_id = ? AND status = 'approved'",
            (user_id,),
        ).fetchall()
    return [row["permission_key"] for row in rows]


def permission_statuses(user_id):
    with _connect() as conn:
        user = conn.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
        rows = conn.execute(
            """SELECT c.permission_key, c.name, c.description,
                      COALESCE(r.status, 'none') AS status, r.id AS request_id,
                      r.requested_at, r.reviewed_at
               FROM permission_catalog c
               LEFT JOIN permission_requests r
                 ON r.permission_key = c.permission_key AND r.user_id = ?
               ORDER BY c.rowid""",
            (user_id,),
        ).fetchall()
    result = [dict(row) for row in rows]
    if user and user["role"] == "admin":
        for item in result:
            item["status"] = "approved"
    return result


def has_permission(user_id, permission_key):
    if permission_key not in PERMISSION_KEYS:
        return False
    with _connect() as conn:
        user = conn.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
        if user and user["role"] == "admin":
            return True
        row = conn.execute(
            "SELECT 1 FROM permission_requests WHERE user_id = ? AND permission_key = ? AND status = 'approved'",
            (user_id, permission_key),
        ).fetchone()
    return bool(row)


def request_permission(user_id, permission_key):
    if permission_key not in PERMISSION_KEYS:
        return None
    with _connect() as conn:
        conn.execute(
            """INSERT INTO permission_requests(user_id, permission_key, status, requested_at)
               VALUES (?, ?, 'pending', ?)
               ON CONFLICT(user_id, permission_key) DO UPDATE SET
                 status = CASE WHEN permission_requests.status = 'approved' THEN 'approved' ELSE 'pending' END,
                 requested_at = CASE WHEN permission_requests.status = 'approved' THEN permission_requests.requested_at ELSE excluded.requested_at END,
                 reviewed_at = CASE WHEN permission_requests.status = 'approved' THEN permission_requests.reviewed_at ELSE NULL END,
                 reviewed_by = CASE WHEN permission_requests.status = 'approved' THEN permission_requests.reviewed_by ELSE NULL END""",
            (user_id, permission_key, _now()),
        )
        row = conn.execute(
            "SELECT * FROM permission_requests WHERE user_id = ? AND permission_key = ?",
            (user_id, permission_key),
        ).fetchone()
    return dict(row)


def list_permission_requests(status=None):
    with _connect() as conn:
        sql = """SELECT r.id, r.user_id, u.username, r.permission_key, c.name, c.description,
                         r.status, r.requested_at, r.reviewed_at, r.reviewed_by
                  FROM permission_requests r
                  JOIN users u ON u.id = r.user_id
                  JOIN permission_catalog c ON c.permission_key = r.permission_key"""
        params = []
        if status:
            sql += " WHERE r.status = ?"
            params.append(status)
        sql += " ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.requested_at DESC"
        return [dict(row) for row in conn.execute(sql, params).fetchall()]


def review_permission(request_id, status, reviewer_id):
    if status not in {"approved", "rejected"}:
        return None
    with _connect() as conn:
        cur = conn.execute(
            """UPDATE permission_requests SET status = ?, reviewed_at = ?, reviewed_by = ?
               WHERE id = ?""",
            (status, _now(), reviewer_id, request_id),
        )
        if cur.rowcount == 0:
            return None
        row = conn.execute(
            """SELECT r.id, r.user_id, u.username, r.permission_key, c.name, c.description,
                      r.status, r.requested_at, r.reviewed_at, r.reviewed_by
               FROM permission_requests r JOIN users u ON u.id=r.user_id
               JOIN permission_catalog c ON c.permission_key=r.permission_key WHERE r.id = ?""",
            (request_id,),
        ).fetchone()
    return dict(row)


# ---- 混合检索的 BM25 索引 ----

def replace_search_chunks(source, chunks):
    with _connect() as conn:
        conn.execute(
            "DELETE FROM search_chunks_fts WHERE chunk_id IN (SELECT chunk_id FROM search_chunks WHERE source = ?)",
            (source,),
        )
        conn.execute("DELETE FROM search_chunks WHERE source = ?", (source,))
        for chunk in chunks:
            row = {
                "chunk_id": chunk["id"], "source": chunk["source"], "title": chunk.get("title", ""),
                "heading": chunk.get("heading", ""), "text": chunk.get("text", ""),
                "library": chunk.get("library", "ops_business"),
            }
            conn.execute(
                "INSERT OR REPLACE INTO search_chunks(chunk_id, source, title, heading, text, library) VALUES (:chunk_id, :source, :title, :heading, :text, :library)",
                row,
            )
            conn.execute(
                "INSERT INTO search_chunks_fts(chunk_id, source, title, heading, text, library) VALUES (?, ?, ?, ?, ?, ?)",
                (row["chunk_id"], _fts_index_text(row["source"]), _fts_index_text(row["title"]),
                 _fts_index_text(row["heading"]), _fts_index_text(row["text"]), row["library"]),
            )


def delete_search_source(source):
    with _connect() as conn:
        conn.execute(
            "DELETE FROM search_chunks_fts WHERE chunk_id IN (SELECT chunk_id FROM search_chunks WHERE source = ?)",
            (source,),
        )
        conn.execute("DELETE FROM search_chunks WHERE source = ?", (source,))


def search_bm25(query, libraries, limit=20):
    if not libraries:
        return []
    match = _fts_query(query)
    if not match:
        return []
    placeholders = ",".join("?" for _ in libraries)
    sql = f"""SELECT f.chunk_id, c.source, c.title, c.heading, c.text, c.library,
                      bm25(search_chunks_fts) AS bm25_score
               FROM search_chunks_fts AS f
               JOIN search_chunks AS c ON c.chunk_id = f.chunk_id
               WHERE search_chunks_fts MATCH ? AND c.library IN ({placeholders})
               ORDER BY bm25_score ASC LIMIT ?"""
    with _connect() as conn:
        rows = conn.execute(sql, [match, *libraries, max(limit * 4, 40)]).fetchall()
    rows = [dict(row) for row in rows]
    # 中文 FTS 使用二元词。要求命中查询首/尾锚点，避免“完全不存在的词”
    # 仅因包含一个常见二元词而被当成有效证据。
    cjk_runs = re.findall(r"[\u4e00-\u9fff]+", query.lower())
    anchors = {run[:2] for run in cjk_runs if len(run) >= 2} | {run[-2:] for run in cjk_runs if len(run) >= 2}
    if anchors:
        rows = [row for row in rows if anchors.intersection(_fts_terms(row["text"]))]
    return rows[:limit]


init_db()
