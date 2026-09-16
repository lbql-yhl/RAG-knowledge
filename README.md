# AI Knowledge Base

一个基于 FastAPI、原生 HTML/CSS/JavaScript 和 RAG 的 Markdown AI 知识库示例项目。

## 特性

- 自然语言问答：从 Markdown 文档中检索并生成回答
- Markdown 文档管理：目录树、预览、上传和同步
- 编辑工具栏：标题、粗体、斜体、引用、列表、代码块、链接、表格
- 本地向量检索：使用 Qdrant 本地模式和 fastembed
- 简洁的响应式界面：适合桌面端和窄屏使用

## 技术栈

- 后端：FastAPI + Uvicorn
- 向量数据库：Qdrant（本地模式）
- 向量模型：fastembed（BGE-small-zh-v1.5）
- 大语言模型：兼容 OpenAI API 的模型服务（默认示例为 DeepSeek）
- 前端：原生 HTML、CSS、JavaScript

## 快速开始

### 1. 安装依赖

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2. 配置环境变量

复制配置模板：

```powershell
Copy-Item .env.example .env
```

然后在 `.env` 中填写模型服务的 API Key 和相关配置。

### 3. 准备文档并建立索引

仓库中的 `docs/` 仅包含可公开发布的示例文档。将自己的 Markdown 文件放入本地 `docs/` 后运行：

```powershell
python -m scripts.ingest
```

或者启动网站后点击“重建索引”。

### 4. 启动服务

```powershell
uvicorn app.main:app --reload
```

浏览器访问 <http://127.0.0.1:8000>。

## 隐私与安全

本仓库是公开仓库，请不要提交以下内容：

- 公司内部制度、HR、招聘或网络安全文档
- API Key、密码、Cookie、令牌或个人信息
- `data/` 下生成的本地向量数据库
- 本地浏览器配置和调试截图

项目已通过 `.gitignore` 默认忽略内部文档内容；公开发布前仍请检查 `git status` 和提交文件列表。

## 项目结构

```text
app/                 FastAPI 后端和 RAG 逻辑
scripts/             文档索引脚本
docs/                可公开发布的示例 Markdown 文档
web/                 前端页面
.env.example         环境变量模板
```
## 界面预览

![AI Knowledge Base dashboard](assets/screenshots/knowledge-base-dashboard.png)

