from . import config, embedder, llm, md_render, store

SYSTEM_PROMPT = (
    "你是一个企业内部知识库助手。请仅根据提供的文档片段回答问题。"
    "如果文档中没有相关信息，请明确说明无法从知识库中找到答案，不要编造。"
    "回答要求：用要点简要总结，不要复述整篇文档，控制在 150 字以内。"
    "在关键结论后标注来源，格式为 [来源: 文件名 > 章节]。"
)


def ask(question):
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

    context = "\n\n---\n\n".join(context_parts)
    user_prompt = f"问题：{question}\n\n参考资料：\n{context}"

    answer = llm.generate(SYSTEM_PROMPT, user_prompt)
    return {"answer": answer, "answer_html": md_render.render(answer), "sources": sources}
