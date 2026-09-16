import re
from pathlib import Path

MAX_CHUNK_CHARS = 1200
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")


def _split_by_len(body):
    if len(body) <= MAX_CHUNK_CHARS:
        return [body]
    parts = []
    cur = []
    cur_len = 0
    for line in body.splitlines():
        if cur_len + len(line) > MAX_CHUNK_CHARS and cur:
            parts.append("\n".join(cur))
            cur = []
            cur_len = 0
        cur.append(line)
        cur_len += len(line) + 1
    if cur:
        parts.append("\n".join(cur))
    return parts


def split_markdown(text, source):
    lines = text.splitlines()
    chunks = []
    heading_stack = []
    buffer = []

    def emit(buf):
        if not buf:
            return
        heading_path = " > ".join(h[1] for h in heading_stack)
        title = heading_stack[-1][1] if heading_stack else Path(source).stem
        body = "\n".join(buf).strip()
        if not body:
            return
        for piece in _split_by_len(body):
            chunks.append(
                {
                    "text": f"[{heading_path}]\n{piece}" if heading_path else piece,
                    "title": title,
                    "heading": heading_path,
                    "source": source,
                }
            )

    for line in lines:
        m = HEADING_RE.match(line)
        if m:
            emit(buffer)
            buffer = []
            level = len(m.group(1))
            while heading_stack and heading_stack[-1][0] >= level:
                heading_stack.pop()
            heading_stack.append((level, m.group(2).strip()))
        else:
            buffer.append(line)
    emit(buffer)
    return chunks
