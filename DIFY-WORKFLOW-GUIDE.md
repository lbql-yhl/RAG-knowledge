# Dify 反幻觉工作流原型搭建指南

> 目标：在 Dify 上复刻一套「检索 → 评分 → 生成 → 校验 → 修正 / 拒答」的显式校验工作流，
> 与本地 `app/rag.py` 跑同一组回归问题集做对照，验证幻觉治理效果后再回写本地管道。
>
> 依据：第三方实测与我们的结论一致 —— Dify 默认 RAG 会"带着引用编答案"，
> 引用块不约束论断，所以**必须**把校验做成工作流里的显式节点，不能依赖平台默认功能。

---

## 1. 工作流总览

在 Dify 新建 **Chatflow**（不是 Workflow，需要对话变量承载改写轮次），节点拓扑：

```
开始(start)
  └─ sys.query ──► ① 知识检索(retrieve)
                     └─► ② LLM·相关性评分(grade)
                           ├─ relevant=none  ─► ④ 直接回复·诚实拒答 → 结束
                           ├─ relevant=weak  ─► ③ LLM·查询改写(rewrite) ─► ①' 知识检索(重试, ≤1 次) ─► ⑤ generate
                           └─ relevant=ok    ─► ⑤ LLM·生成(generate, 强制引用)
                                                     └─► ⑥ 代码·引用合法性校验(citation_check)
                                                           └─► ⑦ LLM·事实裁判(fact_judge)
                                                                 ├─ verdict=pass ─► ⑧ 直接回复·输出答案(附 verification) → 结束
                                                                 ├─ verdict=fail + 未修正过 ─► ⑨ LLM·修正(revise, ≤1 次) ─► ⑥ 再校验
                                                                 └─ verdict=fail + 已修正过 ─► ④ 诚实拒答 → 结束
```

两条回环各最多走 1 次（rewrite 一次、revise 一次），用对话变量计数兜底，杜绝死循环。

**模型分工**（与本地架构一致）：
| 节点 | 模型 | 理由 |
|---|---|---|
| grade / fact_judge | Ollama 本地模型（如 qwen2.5:7b） | 高频裁判，零成本，输出结构化 JSON 即可 |
| rewrite / generate / revise | DeepSeek API（temperature 0.1–0.3） | 生成质量担当 |

---

## 2. 节点配置明细

### ① 知识检索（Knowledge Retrieval）
- 知识库：选定你的文档知识库
- 检索设置：**混合检索**（向量 + 全文），TopK = 8
- Rerank：开启（如有 bge-reranker 模型接入则用之），Rerank 后 TopK = 3
- 分数阈值：**0.35**（与本地 `MIN_VECTOR_SCORE` 对齐，低于此分的片段直接丢弃）
- 输出变量：`result`（片段数组，含 content / title / score / metadata）

> 若 Dify 版本的检索节点不支持分数阈值，把过滤放到 ② grade 的提示词里
> （明确"score<0.35 的片段视为无关"），或在检索节点后加一个代码节点过滤。

### ② LLM·相关性评分（grade）— CRAG 模式
- 模型：Ollama qwen2.5:7b，temperature 0
- 输出格式：**JSON**
- SYSTEM：

```
你是检索质量审查员。判断给定资料片段能否回答用户问题。
只输出 JSON，不要输出任何其他文字：
{"relevant":"ok"|"weak"|"none", "kept":[片段编号...], "reason":"一句话"}

判定标准：
- ok   ：至少 1 个片段直接包含回答问题所需的事实
- weak ：片段与问题主题相关，但信息不完整或只沾边
- none ：没有任何片段能支撑回答
注意：片段"提到关键词"不等于"能回答问题"。宁可判 weak，不要勉强判 ok。
```

- USER：

```
用户问题：{{#sys.query#}}

检索片段：
{% for item in result %}
[{{loop.index}}] (score={{item.score}}) {{item.title}}
{{item.content}}
{% endfor %}
```

> Dify 的 for 循环语法按所用版本微调（1.x 支持 `{% for %}`；老版本用代码节点拼接）。

### ③ LLM·查询改写（rewrite）
- 模型：DeepSeek，temperature 0.2
- 输入：原 query + grade 的 reason
- SYSTEM：

```
你是检索查询改写器。用户的原始提问检索结果不理想。
把问题改写为更适合知识库检索的形式：补全省略的主语、把口语换成制度/流程类书面词、
拆出核心实体。只输出改写后的一个问题，不要解释，不要输出多个候选。
```

- 改写后：**用对话变量 `rewritten=1` 标记已改写**，回到 ① 用新 query 重检；
  条件分支判断 `rewritten == 1` 时不再进入 ③，直接拿现有片段进 ⑤。

### ④ 直接回复·诚实拒答
固定文案（与本地 `_refusal` 文案对齐）：

```
抱歉，我在已获授权的文档里没有找到能回答这个问题的依据。
你可以：换个问法再试一次；或联系管理员补充相关文档。
```

> 拒答是**成功**不是失败：它替代了"硬编一个答案"。评估时单独统计。

### ⑤ LLM·生成（generate，强制引用）
- 模型：DeepSeek，temperature 0.2
- SYSTEM：

```
你是企业内部知识库助手。只允许依据给定资料回答，遵守：
1. 每一句事实性陈述后必须标注来源编号，格式 [1] [2]；
2. 资料里没有的信息，一律说"资料中未提及"，禁止推测、禁止补充常识；
3. 不同片段内容冲突时，并列呈现并注明各自来源，不要调和；
4. 回答用简体中文，分点不超过 5 条，总长度 300 字以内。
```

- USER：

```
问题：{{#sys.query#}}

资料（回答只能使用以下内容）：
[1] {{片段1标题}}
{{片段1内容}}
[2] ...
```

### ⑥ 代码·引用合法性校验（citation_check）— 确定性校验
Dify「代码执行」节点（Python3），输入 `answer`（⑤ 的输出）与 `source_count`（片段数）：

```python
import re

def main(answer: str, source_count: int) -> dict:
    cited = [int(n) for n in re.findall(r"\[(\d+)\]", answer)]
    invalid = [n for n in cited if n < 1 or n > source_count]
    has_citation = len(cited) > 0
    # 无引用 = 不可信；引用越界 = 编造编号
    ok = has_citation and not invalid
    return {
        "ok": ok,
        "has_citation": has_citation,
        "invalid_refs": invalid,
        "cited_count": len(set(cited)),
    }
```

这一步是**纯规则、零幻觉**：LLM 最常编的就是不存在的引用编号，正则一查一个准。

### ⑦ LLM·事实裁判（fact_judge）— Self-RAG 模式
- 模型：Ollama qwen2.5:7b，temperature 0，输出 JSON
- 触发前提：⑥ `ok == true`（编号合法才值得做语义裁判）
- SYSTEM：

```
你是事实核查员。逐条核对回答中的陈述是否被所引用的资料片段支持。
只输出 JSON：
{"verdict":"pass"|"fail", "unsupported":["不被支持的陈述原文", ...], "note":"一句话"}

标准：陈述的关键事实（数字、日期、条件、主体）必须能在其标注的片段中找到。
片段没说的、片段说反的、把两个片段拼接成新事实的，都算不支持。
```

- USER：问题 + 带编号片段 + 待核回答。

### ⑧ 直接回复·输出
输出答案正文，并附 verification 元数据（与本地管道要回传的字段对齐）：

```json
{
  "answer": "...",
  "verification": {
    "retrieval_rewritten": false,
    "citation_check": {"ok": true, "invalid_refs": []},
    "fact_judge": {"verdict": "pass", "unsupported": []},
    "revised": false
  }
}
```

前端（v5 极简白界面）后续可在引用区下方渲染一行小字：
「已通过引用校验 · 事实核查 pass」，把反幻觉能力变成用户看得见的信任信号。

### ⑨ LLM·修正（revise）
- 模型：DeepSeek，temperature 0.1
- 输入：原回答 + ⑦ 的 `unsupported` 清单 + 原始片段
- SYSTEM：

```
下面是质检未通过的回答。问题清单里的陈述不被资料支持。
请重写回答：删除或改写这些陈述，其余保留；仍然每句标注 [编号]；不许新增资料外信息。
```

- 修正后回 ⑥ 再走一遍校验；对话变量 `revised=1` 标记，第二次失败 → ④ 拒答。

---

## 3. 条件分支规则（IF/ELSE 节点）

| 分支点 | 条件 | 去向 |
|---|---|---|
| grade 后 | `relevant` = `none` | ④ 拒答 |
| | `relevant` = `weak` 且 `rewritten` = `0` | ③ 改写 |
| | 其他 | ⑤ 生成 |
| citation_check 后 | `ok` = `false` 且 `revised` = `0` | ⑨ 修正 |
| | `ok` = `false` 且 `revised` = `1` | ④ 拒答 |
| | `ok` = `true` | ⑦ 事实裁判 |
| fact_judge 后 | `verdict` = `pass` | ⑧ 输出 |
| | `verdict` = `fail` 且 `revised` = `0` | ⑨ 修正 |
| | `verdict` = `fail` 且 `revised` = `1` | ④ 拒答 |

对话变量（Chatflow 支持）：`rewritten`(number, 初始 0)、`revised`(number, 初始 0)，
用「变量赋值」节点在 ③、⑨ 之后置 1。

---

## 4. 回归测试问题集

固定 12 题，覆盖 4 类场景。**Dify 与本地管道跑同一套题**，逐题记录结果：

| # | 类型 | 示例问题 | 期望行为 |
|---|---|---|---|
| 1-3 | 正常命中 | 公司的请假流程是什么？ | 回答 + 全部引用合法 + judge pass |
| 4-6 | 部分命中 | 报销需要哪些发票材料？（库里只有流程没有清单） | 答出有的部分 + 明说缺的部分 |
| 7-9 | 库内无答案 | 公司的海外上市计划是什么？ | 诚实拒答，不硬编 |
| 10-12 | 诱导幻觉 | 根据规定，员工可以预支几个月工资？（规定里其实没写数字） | 拒答或明说"资料中未提及"，**不得编数字** |

每题记录 4 个指标：
- **幻觉**（答案含库外事实）0/1
- **拒答正确性**（该拒的拒了 / 不该拒的没拒）0/1
- **引用正确率**（合法编号数 / 总引用数）
- **judge 判定与实际人工核对是否一致** 0/1

汇总两端的：幻觉率、拒答率、引用正确率。**验收线：诱导幻觉题（10-12）全部不编答案；
正常命中题（1-3）引用正确率 100%。**

---

## 5. 对照与回写 checklist

1. Dify 原型跑完 12 题 → 填结果表
2. 本地 `app/rag.py` 现状跑同样 12 题 → 填结果表（预期：第 10-12 题会暴露无校验的幻觉）
3. 两端对照，确认工作流节点的实际贡献（哪个节点拦住了哪类幻觉）
4. 回写本地管道（按贡献排序）：
   - [ ] `verify`：引用合法性正则校验（纯 Python，先做这个，成本最低收益最大）
   - [ ] `grade` + `rewrite`：检索评分与一次改写重试（CRAG）
   - [ ] `fact_judge` + `revise`：生成后裁判与一次修正（Self-RAG）
   - [ ] `ask()` 返回体增加 `verification` 字段，`main.py` 透传，前端渲染信任标识
5. 回写后再跑一遍 12 题确认达标

---

## 6. 备注

- 本文档为**手工搭建指南**（节点 + 提示词 + 分支规则均可直接照抄）。
- 如需**可一键导入的 DSL（YAML）**，请提供你的 Dify 版本号（设置 → 关于，如 v1.x.x），
  不同版本的 schema 差异较大，按版本生成才能保证导入成功。
- Ollama 接入：Dify → 设置 → 模型供应商 → Ollama，填本机 `http://host.docker.internal:11434`
  （Dify 跑在 Docker 里时）或 `http://<本机IP>:11434`，模型名与 `ollama list` 一致。
