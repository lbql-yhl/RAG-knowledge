import json

from . import config, db, embedder, llm, md_render, store

SYSTEM_PROMPT = (
    "你是一个企业内部知识库助手。请仅根据提供的文档片段回答问题。"
    "如果文档中没有相关信息，请明确说明无法从知识库中找到答案，不要编造。"
    "回答要求：用要点简要总结，不要复述整篇文档，控制在 150 字以内。"
    "在关键结论后标注来源，格式为 [来源: 文件名 > 章节]。"
    "优先遵循用户反馈沉淀出的回答策略；如果策略与文档事实冲突，以文档事实为准。"
)


def ask(question, user_id):
    qvec = embedder.embed_query(question)
    hits = store.search(qvec, config.TOP_K)

    context_parts = []
    sources = []
    for p in hits:
        payload = p.payload
        src = payload.get("source", "")
        heading = payload.get("heading", "")
        label = f"{src}" + (f" > {heading}" if heading else "")
        context_parts.append(f"【来源: {label}】\n{payload.get('text', '')}")
        last = heading.split(" > ")[-1] if heading else ""
        anchor = md_render.slugify(last) if last else ""
        sources.append(
            {"source": src, "heading": heading, "anchor": anchor, "score": round(p.score, 4)}
        )

    context = "\n\n---\n\n".join(context_parts) or "（没有检索到相关文档片段）"
    memory = db.get_memory(user_id)
    recent = db.recent_answers(user_id, 3)
    recent_text = "\n".join(f"- 用户曾问：{row['question']}" for row in recent)
    strategy = memory or "暂无已沉淀的个性化策略。"
    user_prompt = (
        f"问题：{question}\n\n"
        f"已学习的回答策略：\n{strategy}\n\n"
        f"最近问题（仅用于保持上下文，不可作为事实来源）：\n{recent_text or '无'}\n\n"
        f"参考资料：\n{context}"
    )

    answer = llm.generate(SYSTEM_PROMPT, user_prompt)
    answer_id = db.create_answer(user_id, question, answer, json.dumps(sources, ensure_ascii=False))
    return {
        "answer_id": answer_id,
        "answer": answer,
        "answer_html": md_render.render(answer),
        "sources": sources,
        "memory_active": bool(memory),
    }


def learn_from_feedback(user_id, feedback_id, question, answer, rating, reason):
    """Turn a low score into a durable, bounded strategy note for future answers."""
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
            "你是知识库问答质量改进教练，关注准确性、完整性、可读性和引用。",
            prompt,
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
