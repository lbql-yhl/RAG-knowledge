import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.ingest import run_ingest

if __name__ == "__main__":
    result = run_ingest()
    print(f"入库完成: 文件 {result['files']} 篇, 切分 {result['chunks']} 个片段")
