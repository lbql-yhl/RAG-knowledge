import hashlib
import hmac
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import config

_DB_PATH = Path(config.DB_PATH)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _today():
    # Keep the product's daily allowance aligned with Asia/Shanghai without a tzdata package.
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
            """
        )
        # Lightweight migration for databases created before role support was added.
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "role" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")


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
        return {"id": cur.lastrowid, "username": username, "role": role}


def authenticate(username, password):
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username.strip(),)).fetchone()
    if not row or not _verify_password(password, row["password_hash"]):
        return None
    return {"id": row["id"], "username": row["username"], "role": row["role"]}


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
        return {"id": row["id"], "username": row["username"], "role": row["role"]}


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
         "created_at": row["created_at"], "quota": quota_status(row["id"])}
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
    return {"id": user_id, "username": username, "role": "admin"}


init_db()
