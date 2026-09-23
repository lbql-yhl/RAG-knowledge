import os
from pathlib import Path

from dotenv import load_dotenv

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

EMBED_MODEL = os.getenv("EMBED_MODEL", "BAAI/bge-small-zh-v1.5")
EMBED_DIM = int(os.getenv("EMBED_DIM", "512"))

QDRANT_PATH = os.getenv("QDRANT_PATH", str(BASE_DIR / "data" / "qdrant"))
DOCS_DIR = os.getenv("DOCS_DIR", str(BASE_DIR / "docs"))
DB_PATH = os.getenv("DB_PATH", str(BASE_DIR / "data" / "knowledge.db"))
DAILY_ASK_LIMIT = int(os.getenv("DAILY_ASK_LIMIT", "10"))
SESSION_COOKIE = "kb_session"

COLLECTION_NAME = "knowledge_docs"
TOP_K = int(os.getenv("TOP_K", "5"))
HYBRID_TOP_K = int(os.getenv("HYBRID_TOP_K", "12"))
RRF_K = int(os.getenv("RRF_K", "60"))
RERANK_TOP_K = int(os.getenv("RERANK_TOP_K", "3"))
RERANK_ENABLED = os.getenv("RERANK_ENABLED", "1").lower() not in {"0", "false", "no"}
RERANK_MODEL = os.getenv("RERANK_MODEL", "BAAI/bge-reranker-v2-m3")
MIN_VECTOR_SCORE = float(os.getenv("MIN_VECTOR_SCORE", "0.35"))

QDRANT_PATH = (BASE_DIR / QDRANT_PATH) if not os.path.isabs(QDRANT_PATH) else Path(QDRANT_PATH)
DOCS_DIR = (BASE_DIR / DOCS_DIR) if not os.path.isabs(DOCS_DIR) else Path(DOCS_DIR)
DB_PATH = (BASE_DIR / DB_PATH) if not os.path.isabs(DB_PATH) else Path(DB_PATH)
QDRANT_PATH = str(QDRANT_PATH)
DOCS_DIR = str(DOCS_DIR)
DB_PATH = str(DB_PATH)
