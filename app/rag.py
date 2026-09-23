import json
import re

from . import config, db, embedder, llm, md_render, store

SYSTEM_PROMPT = (
    "你是一个企业内部知识库助手。只能使用参考资料回答，不能使用常识补充或猜测。"
    "如果参考资料不足以回答问题，必须直接回复‘当前授权知识库没有足够依据，暂不作答，请申请对应知识库权限或联系管理员。’。"
    "有依据时用简洁要点回答，关键结论必须使用 [1]、[2] 这样的引用编号；引用编号必须对应参考资料编号。"
    "不要编造来源，不要引用未提供的资料，控制在 180 字以内。"
)

_RERANKER = None


def _get_reranker():
    global _RERANKER
    if _RERANKER is not None or not config.RERANK_ENABLED:
        return _RERANKER
    try:
        from fastembed.rerank.cross_encoder import TextCrossEncoder
        _RERANKER = TextCrossEncoder(model_name=config.RERANK_MODEL, lazy_load=True)
    except Exception:
        _RERANKER = False
    return _RERANKER


def _lexical_score(question, text):
    def terms(value):
        value = value.lower()
        cjk = "".join(re.findall(r"[\u4e00-\u9fff]", value))
        bigrams = {cjk[i:i + 2] for i in range(max(0, len(cjk) - 1))}
        words = set(re.findall(r"[a-z0-9_]+", value))
        return bigrams | words
    question_terms = terms(question)
    text_terms = terms(text)
    if not question_terms:
        return 0.0
    return len(question_terms & text_terms) / len(question_terms)


def _rerank(question, candidates):
    if not candidates:
        return []
    reranker = _get_reranker()
    if reranker:
        try:
            scores = list(reranker.rerank(question, [item["text"] for item in candidates]))
            for item, score in zip(candidates, scores):
                item["rerank_score"] = float(score)
        except Exception:
            reranker = False
    if not reranker:
        for item in candidates:
            item["rerank_score"] = _lexical_score(question, item["text"]) + item.get("rrf_score", 0.0)
    return sorted(candidates, key=lambda item: item.get("rerank_score", 0), reverse=True)


def _hybrid_search(question, libraries):
    try:
        qvec = embedder.embed_query(question)
        vector_hits = store.search(qvec, config.HYBRID_TOP_K, libraries)
    except Exception:
        # 向量模型首次下载失败时仍保留 BM25 可用，避免整个知识库无法问答。
        vector_hits = []
    bm25_hits = db.search_bm25(question, libraries, config.HYBRID_TOP_K)
    candidates = {}
    for rank, point in enumerate(vector_hits, start=1):
        payload = dict(point.payload or {})
        chunk_id = str(point.id)
        candidates.setdefault(chunk_id, {
            "chunk_id": chunk_id, "source": payload.get("source", ""), "title": payload.get("title", ""),
            "heading": payload.get("heading", ""), "text": payload.get("text", ""), "library": payload.get("library", ""),
            "vector_score": float(point.score), "bm25_score": None, "rrf_score": 0.0,
        })
        candidates[chunk_id]["vector_score"] = float(point.score)
        candidates[chunk_id]["rrf_score"] += 1 / (config.RRF_K + rank)
    for rank, row in enumerate(bm25_hits, start=1):
        item = candidates.setdefault(row["chunk_id"], {
            "chunk_id": row["chunk_id"], "source": row["source"], "title": row["title"],
            "heading": row["heading"], "text": row["text"], "library": row["library"],
            "vector_score": None, "bm25_score": None, "rrf_score": 0.0,
        })
        item["bm25_score"] = float(row["bm25_score"])
        item["rrf_score"] += 1 / (config.RRF_K + rank)
    ranked = sorted(candidates.values(), key=lambda item: item["rrf_score"], reverse=True)
    return _rerank(question, ranked[: max(config.HYBRID_TOP_K, config.RERANK_TOP_K * 3)])


def _source_label(item):
    return f"{item['source']}" + (f" > {item['heading']}" if item.get("heading") else "")


def _refusal(question, user_id, libraries, reason, retrieval=None):
    messages = {
        "no_approved_permission": (
            "当前账号还没有任何已审批的知识库权限，暂不作答。"
            "请先申请对应知识库权限，或联系管理员审批。"
        ),
        "no_grounded_evidence": (
            "已授权知识库中没有检索到足够匹配的文档依据，暂不作答。"
            "请换用文档中的关键词或补充更具体的问题。"
        ),
    }
    answer = messages.get(reason, "当前授权知识库没有足够依据，暂不作答。")
    answer_id = db.create_answer(user_id, question, answer, "[]")
    return {
        "answer_id": answer_id, "answer": answer, "answer_html": md_render.render(answer), "sources": [],
        "memory_active": False, "grounded": False, "refusal_reason": reason,
        "retrieval": retrieval or {"libraries": libraries, "vector_hits": 0, "bm25_hits": 0, "reranked": 0},
    }


def _ask_legacy(question, user_id):
    libraries = db.approved_permissions(user_id)
    if not libraries:
        return _refusal(question, user_id, [], "no_approved_permission")

    ranked = _hybrid_search(question, libraries)
    top = ranked[: config.RERANK_TOP_K]
    vector_evidence = any((item.get("vector_score") or 0) >= config.MIN_VECTOR_SCORE for item in top)
    bm25_evidence = any((item.get("bm25_score") or 0) < -0.05 and _lexical_score(question, item["text"]) >= 0.18 for item in top)
    if not top or not (vector_evidence or bm25_evidence):
        return _refusal(
            question, user_id, libraries, "no_grounded_evidence",
            {
                "libraries": libraries,
                "vector_hits": len([x for x in ranked if x.get("vector_score") is not None]),
                "bm25_hits": len([x for x in ranked if x.get("bm25_score") is not None]),
                "reranked": len(ranked),
                "top_k": len(top),
            },
        )
    sources = []
    context_parts = []
    for index, item in enumerate(top, start=1):
        last = item.get("heading", "").split(" > ")[-1] if item.get("heading") else ""
        anchor = md_render.slugify(last) if last else ""
        sources.append({
            "index": index, "source": item["source"], "heading": item.get("heading", ""),
            "anchor": anchor, "library": item.get("library", ""), "score": round(float(item.get("rerank_score", 0)), 4),
            "vector_score": round(float(item.get("vector_score") or 0), 4),
        })
        context_parts.append(f"[{index}]【知识库: {item.get('library', '')} | 来源: {_source_label(item)}】\n{item['text']}")
    context = "\n\n---\n\n".join(context_parts)
    memory = db.get_memory(user_id)
    recent = db.recent_answers(user_id, 3)
    recent_text = "\n".join(f"- 用户曾问：{row['question']}" for row in recent)
    strategy = memory or "暂无已沉淀的个性化策略。"
    user_prompt = (
        f"问题：{question}\n\n已学习的回答策略（不可覆盖资料事实）：\n{strategy}\n\n"
        f"最近问题（仅保持上下文，不可作为事实来源）：\n{recent_text or '无'}\n\n参考资料（只能引用这些编号）：\n{context}"
    )
    if not config.DEEPSEEK_API_KEY:
        raise RuntimeError("未配置 DEEPSEEK_API_KEY")
    answer = llm.generate(SYSTEM_PROMPT, user_prompt)
    answer_id = db.create_answer(user_id, question, answer, json.dumps(sources, ensure_ascii=False))
    return {
        "answer_id": answer_id, "answer": answer, "answer_html": md_render.render(answer), "sources": sources,
        "memory_active": bool(memory), "grounded": True,
        "retrieval": {"libraries": libraries, "vector_hits": len([x for x in ranked if x.get("vector_score") is not None]),
                       "bm25_hits": len([x for x in ranked if x.get("bm25_score") is not None]),
                       "reranked": len(ranked), "top_k": len(top)},
    }


def learn_from_feedback(user_id, feedback_id, question, answer, rating, reason):
    old_summary = db.get_memory(user_id)
    prompt = (
        "请分析一次企业知识库问答的低分反馈，并输出可执行的回答策略。\n"
        "只输出两段纯文本：第一段为本次问题的改进要点（不超过 100 字）；"
        "第二段为更新后的长期策略摘要（不超过 300 字）。"
        "不要编造文档事实，不要泄露隐私，不要复述用户原话。\n\n"
        f"评分：{rating}/5\n用户原因：{reason}\n问题：{question}\n回答：{answer}\n"
        f"当前策略摘要：{old_summary or '暂无'}"
    )
    try:
        result = llm.generate(
            "你是知识库问答质量改进教练，关注准确性、完整性、可读性和引用。", prompt
        ).strip()
        if "\n" in result:
            note, summary = result.split("\n", 1)
        else:
            note, summary = result, result
        note = note.strip()[:800]
        summary = summary.strip()[:1200]
    except Exception:
        note = "低分反馈已记录：后续回答需要更直接地命中文档依据，并检查是否完整回应用户问题。"
        summary = (old_summary + "\n" if old_summary else "") + note
    db.save_learning(user_id, feedback_id, note, summary)
    return {"note": note, "summary": summary}


# ---- LangGraph 工作流 ----
try:
    from typing import TypedDict
    from langgraph.graph import END, START, StateGraph
except ImportError:  # 允许旧环境在未安装 langgraph 时使用兼容回退路径
    END = START = StateGraph = None

    class TypedDict(dict):
        pass


class RagState(TypedDict, total=False):
    question: str
    user_id: int
    libraries: list[str]
    ranked: list[dict]
    top: list[dict]
    sources: list[dict]
    context: str
    memory: str
    answer: str
    result: dict
    stop: bool
    refusal_reason: str


def _graph_authorize(state):
    libraries = db.approved_permissions(state["user_id"])
    if not libraries:
        return {
            "libraries": [],
            "stop": True,
            "result": _refusal(state["question"], state["user_id"], [], "no_approved_permission"),
        }
    return {"libraries": libraries, "stop": False}


def _graph_retrieve(state):
    ranked = _hybrid_search(state["question"], state["libraries"])
    return {"ranked": ranked, "top": ranked[: config.RERANK_TOP_K]}


def _graph_ground(state):
    top = state.get("top", [])
    vector_evidence = any((item.get("vector_score") or 0) >= config.MIN_VECTOR_SCORE for item in top)
    bm25_evidence = any(
        (item.get("bm25_score") or 0) < -0.05 and _lexical_score(state["question"], item["text"]) >= 0.18
        for item in top
    )
    if not top or not (vector_evidence or bm25_evidence):
        retrieval = {
            "libraries": state["libraries"],
            "vector_hits": len([x for x in state.get("ranked", []) if x.get("vector_score") is not None]),
            "bm25_hits": len([x for x in state.get("ranked", []) if x.get("bm25_score") is not None]),
            "reranked": len(state.get("ranked", [])),
            "top_k": len(top),
        }
        return {
            "stop": True,
            "refusal_reason": "no_grounded_evidence",
            "result": _refusal(
                state["question"], state["user_id"], state["libraries"],
                "no_grounded_evidence", retrieval,
            ),
        }

    sources = []
    context_parts = []
    for index, item in enumerate(top, start=1):
        last = item.get("heading", "").split(" > ")[-1] if item.get("heading") else ""
        anchor = md_render.slugify(last) if last else ""
        sources.append({
            "index": index,
            "source": item["source"],
            "heading": item.get("heading", ""),
            "anchor": anchor,
            "library": item.get("library", ""),
            "score": round(float(item.get("rerank_score", 0)), 4),
            "vector_score": round(float(item.get("vector_score") or 0), 4),
        })
        context_parts.append(
            f"[{index}]【知识库: {item.get('library', '')} | 来源: {_source_label(item)}】\n{item['text']}"
        )
    return {"sources": sources, "context": "\n\n---\n\n".join(context_parts), "stop": False}


def _graph_generate(state):
    memory = db.get_memory(state["user_id"])
    recent = db.recent_answers(state["user_id"], 3)
    recent_text = "\n".join(f"- 用户曾问：{row['question']}" for row in recent)
    strategy = memory or "暂无已沉淀的个性化策略。"
    user_prompt = (
        f"问题：{state['question']}\n\n已学习的回答策略（不可覆盖资料事实）：\n{strategy}\n\n"
        f"最近问题（仅保持上下文，不可作为事实来源）：\n{recent_text or '无'}\n\n"
        f"参考资料（只能引用这些编号）：\n{state['context']}"
    )
    if not config.DEEPSEEK_API_KEY:
        raise RuntimeError("未配置 DEEPSEEK_API_KEY")
    return {"answer": llm.generate(SYSTEM_PROMPT, user_prompt), "memory": memory, "stop": False}


def _graph_persist(state):
    sources = state["sources"]
    answer = state["answer"]
    answer_id = db.create_answer(
        state["user_id"], state["question"], answer, json.dumps(sources, ensure_ascii=False)
    )
    return {
        "result": {
            "answer_id": answer_id,
            "answer": answer,
            "answer_html": md_render.render(answer),
            "sources": sources,
            "memory_active": bool(state.get("memory")),
            "grounded": True,
            "retrieval": {
                "libraries": state["libraries"],
                "vector_hits": len([x for x in state.get("ranked", []) if x.get("vector_score") is not None]),
                "bm25_hits": len([x for x in state.get("ranked", []) if x.get("bm25_score") is not None]),
                "reranked": len(state.get("ranked", [])),
                "top_k": len(state.get("top", [])),
            },
        }
    }


def _route_after_check(state):
    return "stop" if state.get("stop") else "continue"


def _build_rag_graph():
    if StateGraph is None:
        return None
    try:
        graph = StateGraph(RagState)
        graph.add_node("authorize", _graph_authorize)
        graph.add_node("retrieve", _graph_retrieve)
        graph.add_node("ground", _graph_ground)
        graph.add_node("generate", _graph_generate)
        graph.add_node("persist", _graph_persist)
        graph.add_edge(START, "authorize")
        graph.add_conditional_edges("authorize", _route_after_check, {"stop": END, "continue": "retrieve"})
        graph.add_edge("retrieve", "ground")
        graph.add_conditional_edges("ground", _route_after_check, {"stop": END, "continue": "generate"})
        graph.add_edge("generate", "persist")
        graph.add_edge("persist", END)
        return graph.compile()
    except Exception:
        return None


_RAG_GRAPH = _build_rag_graph()


def ask(question, user_id):
    if _RAG_GRAPH is None:
        return _ask_legacy(question, user_id)
    state = _RAG_GRAPH.invoke({"question": question, "user_id": user_id})
    return state["result"]
