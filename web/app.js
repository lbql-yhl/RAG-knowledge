const docList = document.getElementById('doc-list');
const viewer = document.getElementById('viewer');
const messages = document.getElementById('messages');
const questionInput = document.getElementById('question');
const askBtn = document.getElementById('ask-btn');
const ingestBtn = document.getElementById('ingest-btn');
const newBtn = document.getElementById('new-btn');
const editBtn = document.getElementById('edit-btn');
const deleteBtn = document.getElementById('delete-btn');
const viewerToolbar = document.getElementById('viewer-toolbar');
const viewerTitle = document.getElementById('viewer-title');
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const docNameInput = document.getElementById('doc-name');
const docDirInput = document.getElementById('doc-dir');
const docContentInput = document.getElementById('doc-content');
const modalSave = document.getElementById('modal-save');
const modalCancel = document.getElementById('modal-cancel');
const modalClose = document.getElementById('modal-close');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const divider = document.getElementById('divider');
const chatPanel = document.getElementById('chat-panel');
const uploadBtn = document.getElementById('upload-btn');
const syncBtn = document.getElementById('sync-btn');
const fileInput = document.getElementById('file-input');
const docSearch = document.getElementById('doc-search');
const docCount = document.getElementById('doc-count');
const headingSelect = document.getElementById('heading-select');
const editorPreviewToggle = document.getElementById('editor-preview-toggle');
const editorPreview = document.getElementById('doc-preview');
const editorModeLabel = document.getElementById('editor-mode-label');
const helpButton = document.querySelector('.topbar-help');

let currentPath = null;
let currentContent = '';
let editMode = false;
let editorPreviewMode = false;

function countDocs(node) {
  return node.files.length + node.dirs.reduce((sum, dir) => sum + countDocs(dir), 0);
}

function filterDocuments(query) {
  const normalized = query.trim().toLowerCase();
  document.querySelectorAll('.doc-item').forEach(item => {
    item.style.display = !normalized || item.textContent.toLowerCase().includes(normalized) ? '' : 'none';
  });
  document.querySelectorAll('.tree-dir').forEach(dir => {
    const visibleFile = Array.from(dir.querySelectorAll('.doc-item')).some(item => item.style.display !== 'none');
    dir.style.display = !normalized || visibleFile ? '' : 'none';
    if (normalized && visibleFile) dir.classList.remove('collapsed');
  });
}

function inlinePreview(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderEditorPreview(source) {
  const lines = source.split('\n');
  const output = [];
  let inCode = false;
  let codeLanguage = '';
  let codeLines = [];
  let listType = null;

  const closeList = () => {
    if (listType) { output.push(`</${listType}>`); listType = null; }
  };
  const closeCode = () => {
    if (inCode) {
      output.push(`<pre><code class="language-${escapeHtml(codeLanguage)}">${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      inCode = false;
      codeLanguage = '';
      codeLines = [];
    }
  };

  lines.forEach(line => {
    const fence = line.match(/^```\s*([\w-]*)\s*$/);
    if (fence) {
      if (inCode) closeCode();
      else { inCode = true; codeLanguage = fence[1] || ''; }
      return;
    }
    if (inCode) { codeLines.push(line); return; }
    if (!line.trim()) { closeList(); return; }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { closeList(); const level = heading[1].length; output.push(`<h${level}>${inlinePreview(heading[2])}</h${level}>`); return; }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) { closeList(); output.push(`<blockquote>${inlinePreview(quote[1])}</blockquote>`); return; }
    const unordered = line.match(/^[-*+]\s+(.*)$/);
    if (unordered) { if (listType !== 'ul') { closeList(); output.push('<ul>'); listType = 'ul'; } output.push(`<li>${inlinePreview(unordered[1])}</li>`); return; }
    const ordered = line.match(/^\d+[.)]\s+(.*)$/);
    if (ordered) { if (listType !== 'ol') { closeList(); output.push('<ol>'); listType = 'ol'; } output.push(`<li>${inlinePreview(ordered[1])}</li>`); return; }
    closeList();
    output.push(`<p>${inlinePreview(line)}</p>`);
  });

  closeList();
  closeCode();
  return output.join('') || '<p class="preview-empty">预览会显示在这里…</p>';
}

function updateEditorPreview() {
  editorPreviewMode = Boolean(editorPreviewMode);
  editorPreview.innerHTML = renderEditorPreview(docContentInput.value);
  editorPreview.hidden = !editorPreviewMode;
  docContentInput.hidden = editorPreviewMode;
  editorPreviewToggle.textContent = editorPreviewMode ? '源码' : '预览';
  editorModeLabel.textContent = editorPreviewMode ? 'Markdown 预览' : 'Markdown 源码';
}

function replaceEditorSelection(replacement, selectStart, selectEnd) {
  const start = docContentInput.selectionStart;
  const end = docContentInput.selectionEnd;
  docContentInput.setRangeText(replacement, start, end, 'select');
  const nextStart = selectStart ?? start;
  const nextEnd = selectEnd ?? (nextStart + replacement.length);
  docContentInput.setSelectionRange(nextStart, nextEnd);
  docContentInput.focus();
  updateEditorPreview();
}

function wrapEditorSelection(prefix, suffix, placeholder) {
  const start = docContentInput.selectionStart;
  const end = docContentInput.selectionEnd;
  const selected = docContentInput.value.slice(start, end) || placeholder;
  const replacement = prefix + selected + suffix;
  docContentInput.setRangeText(replacement, start, end, 'select');
  docContentInput.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
  docContentInput.focus();
  updateEditorPreview();
}

function prefixEditorLines(prefix) {
  const value = docContentInput.value;
  const start = value.lastIndexOf('\n', docContentInput.selectionStart - 1) + 1;
  const endBreak = value.indexOf('\n', docContentInput.selectionEnd);
  const end = endBreak === -1 ? value.length : endBreak;
  const selected = value.slice(start, end);
  const replacement = selected.split('\n').map(line => line.startsWith(prefix) ? line : prefix + line).join('\n');
  docContentInput.setRangeText(replacement, start, end, 'select');
  docContentInput.setSelectionRange(start, start + replacement.length);
  docContentInput.focus();
  updateEditorPreview();
}

function applyEditorFormat(format) {
  if (format === 'bold') return wrapEditorSelection('**', '**', '粗体文字');
  if (format === 'italic') return wrapEditorSelection('*', '*', '斜体文字');
  if (format === 'strike') return wrapEditorSelection('~~', '~~', '删除线文字');
  if (format === 'inline-code') return wrapEditorSelection('`', '`', '代码');
  if (format === 'code-block') return wrapEditorSelection('```\n', '\n```', '在这里输入代码');
  if (format === 'quote') return prefixEditorLines('> ');
  if (format === 'bullet') return prefixEditorLines('- ');
  if (format === 'ordered') return prefixEditorLines('1. ');
  if (format === 'checklist') return prefixEditorLines('- [ ] ');
  if (format === 'link') return wrapEditorSelection('[', '](https://example.com)', '链接文字');
  if (format === 'table') return replaceEditorSelection('| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |');
  if (format === 'hr') return replaceEditorSelection('\n---\n');
}


function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderTree(node, container) {
  node.dirs.forEach(dir => {
    const dirEl = document.createElement('div');
    dirEl.className = 'tree-dir';

    const header = document.createElement('div');
    header.className = 'tree-dir-header';
    header.tabIndex = 0;
    header.setAttribute('role', 'button');
    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    toggle.textContent = '收起';
    const name = document.createElement('span');
    name.className = 'tree-dir-name';
    name.textContent = dir.name;
    header.appendChild(toggle);
    header.appendChild(name);
    const toggleDir = () => {
      dirEl.classList.toggle('collapsed');
      toggle.textContent = dirEl.classList.contains('collapsed') ? '展开' : '收起';
    };
    header.addEventListener('click', toggleDir);
    header.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleDir();
      }
    });

    const children = document.createElement('div');
    children.className = 'tree-dir-children';
    renderTree(dir, children);

    dirEl.appendChild(header);
    dirEl.appendChild(children);
    container.appendChild(dirEl);
  });

  node.files.forEach(f => {
    const el = document.createElement('a');
    el.className = 'doc-item';
    el.href = '#';
    el.textContent = f.name;
    el.title = f.path;
    el.addEventListener('click', event => {
      event.preventDefault();
      openDoc(f.path, el);
    });
    container.appendChild(el);
  });
}

function addMessage(role, content) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (role === 'ai') {
    bubble.innerHTML = content;
  } else {
    bubble.textContent = content;
  }
  wrap.appendChild(bubble);
  messages.appendChild(wrap);
  messages.scrollTop = messages.scrollHeight;
  return bubble;
}

function clearEmptyHint() {
  const hint = messages.querySelector('.empty-hint');
  if (hint) hint.remove();
}

async function ask() {
  const q = questionInput.value.trim();
  if (!q) return;
  clearEmptyHint();
  addMessage('user', q);
  questionInput.value = '';
  askBtn.disabled = true;

  const bubble = addMessage('ai', '<span class="loading"></span>');
  try {
    const resp = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q })
    });
    const data = await resp.json();
    if (!resp.ok) {
      bubble.innerHTML = `<div class="markdown">出错了：${escapeHtml(data.detail || '未知错误')}</div>`;
      return;
    }
    let html = `<div class="markdown">${data.answer_html}</div>`;
    if (data.sources && data.sources.length) {
      html += '<div class="sources">参考来源：';
      const seen = new Set();
      data.sources.forEach(s => {
        const label = s.source + (s.heading ? ` > ${s.heading}` : '');
        if (seen.has(label)) return;
        seen.add(label);
        html += `<a class="source-chip" data-path="${escapeHtml(s.source)}" data-anchor="${escapeHtml(s.anchor || '')}">${escapeHtml(label)}</a>`;
      });
      html += '</div>';
    }
    bubble.innerHTML = html;
    bubble.querySelectorAll('.source-chip').forEach(chip => {
      chip.addEventListener('click', () => openDoc(chip.dataset.path, null, chip.dataset.anchor));
    });
  } catch (e) {
    bubble.innerHTML = `<div class="markdown">请求失败：${escapeHtml(e.message)}</div>`;
  } finally {
    askBtn.disabled = false;
  }
}

async function loadDocs() {
  const resp = await fetch('/api/docs');
  const data = await resp.json();
  docList.innerHTML = '';
  renderTree(data.tree, docList);
  docCount.textContent = `${countDocs(data.tree)} 篇文档`;
  filterDocuments(docSearch.value);
}

async function openDoc(path, el, anchor) {
  document.querySelectorAll('.doc-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  const resp = await fetch('/api/doc/' + encodeURIComponent(path));
  const data = await resp.json();
  currentPath = path;
  currentContent = data.content;
  viewerTitle.textContent = path;
  viewerToolbar.style.display = 'flex';
  viewer.innerHTML = `<div class="markdown">${data.html}</div>`;
  if (anchor) {
    let target = null;
    try { target = viewer.querySelector(`[id="${CSS.escape(anchor)}"]`); } catch (e) { target = null; }
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function openModal(mode) {
  editMode = mode === 'edit';
  modalTitle.textContent = editMode ? '编辑文档' : '新建文档';
  if (editMode) {
    const parts = currentPath.split('/');
    docNameInput.value = parts[parts.length - 1].replace(/\.md$/i, '');
    docDirInput.value = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    docContentInput.value = currentContent;
    docNameInput.disabled = true;
    docDirInput.disabled = true;
  } else {
    docNameInput.value = '';
    docDirInput.value = '';
    docContentInput.value = '';
    docNameInput.disabled = false;
    docDirInput.disabled = false;
  }
  editorPreviewMode = false;
  updateEditorPreview();
  modalOverlay.style.display = 'flex';
  docContentInput.focus();
}

function closeModal() {
  modalOverlay.style.display = 'none';
}

async function saveDoc() {
  const name = docNameInput.value.trim();
  const dir = docDirInput.value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const content = docContentInput.value;
  if (!name) { alert('请输入标题'); return; }

  const url = editMode ? '/api/doc/' + encodeURIComponent(currentPath) : '/api/doc';
  const method = editMode ? 'PUT' : 'POST';
  const body = editMode ? { content } : { path: (dir ? dir + '/' : '') + name, content };

  modalSave.disabled = true;
  try {
    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (!resp.ok) { alert('保存失败：' + (data.detail || '未知错误')); return; }
    closeModal();
    await loadDocs();
    await openDoc(editMode ? currentPath : data.path);
  } catch (e) {
    alert('保存失败：' + e.message);
  } finally {
    modalSave.disabled = false;
  }
}

async function deleteDoc() {
  if (!currentPath) return;
  if (!confirm('确定删除文档「' + currentPath + '」？')) return;
  const resp = await fetch('/api/doc/' + encodeURIComponent(currentPath), { method: 'DELETE' });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    alert('删除失败：' + (data.detail || '未知错误'));
    return;
  }
  currentPath = null;
  viewerToolbar.style.display = 'none';
  viewer.innerHTML = '<div class="viewer-empty"><div class="viewer-empty-label">文档预览</div><strong>选择一篇文档开始阅读</strong><span>从左侧选择文档，或直接提问。</span></div>';
  await loadDocs();
}

askBtn.addEventListener('click', ask);
questionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
});

ingestBtn.addEventListener('click', async () => {
  ingestBtn.textContent = '索引中...';
  ingestBtn.disabled = true;
  try {
    const resp = await fetch('/api/ingest', { method: 'POST' });
    const data = await resp.json();
    alert(`索引完成：${data.files} 篇文档，${data.chunks} 个片段`);
    loadDocs();
  } catch (e) {
    alert('索引失败：' + e.message);
  } finally {
    ingestBtn.textContent = '重建索引';
    ingestBtn.disabled = false;
  }
});

newBtn.addEventListener('click', () => openModal('create'));
editBtn.addEventListener('click', () => {
  if (currentPath) openModal('edit');
});
deleteBtn.addEventListener('click', deleteDoc);
modalSave.addEventListener('click', saveDoc);
modalCancel.addEventListener('click', closeModal);
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

sidebarToggle.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  const collapsed = sidebar.classList.contains('collapsed');
  sidebarToggle.textContent = collapsed ? '展开' : '收起';
  sidebarToggle.title = collapsed ? '展开侧栏' : '收起侧栏';
  sidebarToggle.setAttribute('aria-label', sidebarToggle.title);
});

let dragging = false;
divider.addEventListener('mousedown', (e) => {
  e.preventDefault();
  dragging = true;
  divider.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});
document.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const rect = document.querySelector('.content').getBoundingClientRect();
  let w = e.clientX - rect.left;
  w = Math.max(320, Math.min(rect.width * 0.8, w));
  chatPanel.style.flex = `0 0 ${w}px`;
});
document.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  divider.classList.remove('dragging');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && modalOverlay.style.display === 'flex') {
    closeModal();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && modalOverlay.style.display === 'flex') {
    event.preventDefault();
    saveDoc();
  }
});

uploadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const files = fileInput.files;
  if (!files.length) return;
  const dir = (prompt('上传到哪个目录？（留空上传到根目录，如：AI知识）', '') || '').trim();
  const formData = new FormData();
  for (const f of files) formData.append('files', f);
  formData.append('dir', dir);

  uploadBtn.textContent = '上传中...';
  uploadBtn.disabled = true;
  try {
    const resp = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await resp.json();
    if (!resp.ok) { alert('上传失败：' + (data.detail || '未知错误')); return; }
    alert(`上传成功 ${data.uploaded.length} 个文档`);
    loadDocs();
  } catch (e) {
    alert('上传失败：' + e.message);
  } finally {
    uploadBtn.textContent = '上传';
    uploadBtn.disabled = false;
    fileInput.value = '';
  }
});

syncBtn.addEventListener('click', async () => {
  const src = (prompt('输入要同步的本地目录路径（该目录下的 .md 文件会被同步）', '') || '').trim();
  if (!src) return;
  syncBtn.textContent = '同步中...';
  syncBtn.disabled = true;
  try {
    const resp = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_dir: src })
    });
    const data = await resp.json();
    if (!resp.ok) { alert('同步失败：' + (data.detail || '未知错误')); return; }
    alert(`同步成功 ${data.count} 个文档`);
    loadDocs();
  } catch (e) {
    alert('同步失败：' + e.message);
  } finally {
    syncBtn.textContent = '同步';
    syncBtn.disabled = false;
  }
});

document.querySelectorAll('[data-format]').forEach(button => {
  button.addEventListener('click', () => applyEditorFormat(button.dataset.format));
});
headingSelect.addEventListener('change', () => {
  const level = Number(headingSelect.value);
  if (!level) return;
  const value = docContentInput.value;
  const start = value.lastIndexOf('\n', docContentInput.selectionStart - 1) + 1;
  const endBreak = value.indexOf('\n', docContentInput.selectionEnd);
  const end = endBreak === -1 ? value.length : endBreak;
  const line = value.slice(start, end).replace(/^#{1,6}\s*/, '');
  const replacement = `${'#'.repeat(level)} ${line}`;
  docContentInput.setRangeText(replacement, start, end, 'select');
  docContentInput.focus();
  updateEditorPreview();
  headingSelect.value = '';
});
editorPreviewToggle.addEventListener('click', () => {
  editorPreviewMode = !editorPreviewMode;
  updateEditorPreview();
});
docContentInput.addEventListener('input', updateEditorPreview);
docContentInput.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); applyEditorFormat('bold'); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i') { event.preventDefault(); applyEditorFormat('italic'); }
});
document.querySelectorAll('[data-rail-action]').forEach(button => {
  button.addEventListener('click', () => {
    const action = button.dataset.railAction;
    if (action === 'expand') sidebarToggle.click();
    else document.getElementById(`${action}-btn`)?.click();
  });
});

loadDocs();

helpButton?.addEventListener('click', () => {
  alert('使用说明：从左侧选择文档查看内容，也可以直接在下方输入问题。新建文档时可使用 Markdown 工具栏插入标题、列表、代码和表格。');
});

docSearch.addEventListener('input', () => filterDocuments(docSearch.value));
document.querySelectorAll('[data-question]').forEach(button => {
  button.addEventListener('click', () => {
    questionInput.value = button.dataset.question;
    questionInput.focus();
  });
});
