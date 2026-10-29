from __future__ import annotations

import os
from pathlib import Path

# Importing app.db initializes the configured database. Keep this test isolated
# from the repository's real database and any local knowledge-base data.
os.environ["DB_PATH"] = str(Path(os.getenv("TEMP", ".")) / "rag-agentic-retrieval-test.db")

from app import rag  # noqa: E402


def test_rewrite_is_a_bounded_retrieval_query_not_an_answer(monkeypatch):
    monkeypatch.setattr(rag.llm, "generate", lambda *_: "检索查询：员工如何申请差旅报销？\n不要回答")

    assert rag._rewrite_query("出差的费用怎么报？") == "员工如何申请差旅报销？"


def test_rewrite_rejects_empty_unchanged_or_overlong_queries(monkeypatch):
    for output in ("", "原问题", "问" * 241):
        monkeypatch.setattr(rag.llm, "generate", lambda *_args, value=output: value)
        assert rag._rewrite_query("原问题") == ""


def test_graph_rewrites_once_then_answers_from_grounded_evidence(monkeypatch):
    searches = []
    monkeypatch.setattr(rag.config, "RAG_QUERY_REWRITE_LIMIT", 1)
    monkeypatch.setattr(rag.db, "approved_permissions", lambda _user_id: ["ops"])

    def hybrid_search(query, _libraries):
        searches.append(query)
        if len(searches) == 1:
            return []
        return [{
            "chunk_id": "chunk-1", "source": "差旅制度.md", "title": "差旅制度",
            "heading": "报销流程", "text": "员工应在出差结束后提交差旅报销申请。",
            "library": "ops", "vector_score": 0.9, "bm25_score": None,
            "rrf_score": 0.03, "rerank_score": 0.9,
        }]

    def generate(system_prompt, _user_prompt):
        if "检索查询改写器" in system_prompt:
            return "员工如何申请差旅报销？"
        return "员工应在出差结束后提交差旅报销申请。[1]"

    monkeypatch.setattr(rag, "_hybrid_search", hybrid_search)
    monkeypatch.setattr(rag.llm, "generate", generate)
    monkeypatch.setattr(rag.db, "get_memory", lambda _user_id: "")
    monkeypatch.setattr(rag.db, "recent_answers", lambda *_: [])
    monkeypatch.setattr(rag.db, "create_answer", lambda *_: 77)

    result = rag._build_rag_graph().invoke({"question": "出差的费用怎么报？", "user_id": 3})["result"]

    assert searches == ["出差的费用怎么报？", "员工如何申请差旅报销？"]
    assert result["answer_id"] == 77
    assert result["grounded"] is True
    assert result["retrieval"]["query_rewrites"] == 1
    assert result["sources"][0]["source"] == "差旅制度.md"


def test_graph_refuses_after_one_unsuccessful_rewrite(monkeypatch):
    searches = []
    monkeypatch.setattr(rag.config, "RAG_QUERY_REWRITE_LIMIT", 1)
    monkeypatch.setattr(rag.db, "approved_permissions", lambda _user_id: ["ops"])
    monkeypatch.setattr(rag.db, "create_answer", lambda *_: 88)
    monkeypatch.setattr(rag, "_hybrid_search", lambda query, _libraries: searches.append(query) or [])
    monkeypatch.setattr(rag.llm, "generate", lambda *_: "员工差旅报销政策")

    result = rag._build_rag_graph().invoke({"question": "出差的费用怎么报？", "user_id": 4})["result"]

    assert searches == ["出差的费用怎么报？", "员工差旅报销政策"]
    assert result["grounded"] is False
    assert result["refusal_reason"] == "no_grounded_evidence"
    assert result["retrieval"]["query_rewrites"] == 1


def test_query_rewrite_is_disabled_by_default_to_preserve_existing_runtime(monkeypatch):
    searches = []
    monkeypatch.setattr(rag.config, "RAG_QUERY_REWRITE_LIMIT", 0)
    monkeypatch.setattr(rag.db, "approved_permissions", lambda _user_id: ["ops"])
    monkeypatch.setattr(rag.db, "create_answer", lambda *_: 99)
    monkeypatch.setattr(rag, "_hybrid_search", lambda query, _libraries: searches.append(query) or [])
    monkeypatch.setattr(
        rag.llm, "generate",
        lambda *_: (_ for _ in ()).throw(AssertionError("rewrite must remain disabled")),
    )

    result = rag._build_rag_graph().invoke({"question": "无依据的问题", "user_id": 5})["result"]

    assert searches == ["无依据的问题"]
    assert result["grounded"] is False
    assert result["retrieval"]["query_rewrites"] == 0
