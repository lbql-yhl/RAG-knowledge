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
const authGate = document.getElementById('auth-gate');
const authForm = document.getElementById('auth-form');
const authUsername = document.getElementById('auth-username');
const authPassword = document.getElementById('auth-password');
const authSubmit = document.getElementById('auth-submit');
const authSwitch = document.getElementById('auth-switch');
const authTitle = document.getElementById('auth-title');
const authKicker = document.getElementById('auth-kicker');
const authError = document.getElementById('auth-error');
const userInitial = document.getElementById('user-initial');
const userName = document.getElementById('user-name');
const quotaBadge = document.getElementById('quota-badge');
const quotaReminder = document.getElementById('quota-reminder');
const adminButton = document.getElementById('admin-btn');
const adminOverlay = document.getElementById('admin-overlay');
const adminClose = document.getElementById('admin-close');
const adminCancel = document.getElementById('admin-cancel');
const adminRefresh = document.getElementById('admin-refresh');
const adminUsersState = document.getElementById('admin-users-state');
const adminUsersList = document.getElementById('admin-users-list');

let currentUser = null;
let authMode = 'login';

let currentPath = null;
let currentContent = '';
let editMode = false;
let editorPreviewMode = false;

function setActionLabel(button, label) {
  const text = button?.querySelector('span');
  if (text) text.textContent = label;
  else if (button) button.textContent = label;
}

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

function resizeQuestionInput() {
  if (!questionInput) return;
  questionInput.style.height = 'auto';
  const maxHeight = parseFloat(getComputedStyle(questionInput).maxHeight) || 144;
  const nextHeight = Math.min(Math.max(questionInput.scrollHeight, 48), maxHeight);
  questionInput.style.height = `${nextHeight}px`;
  questionInput.style.overflowY = questionInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function addMessage(role, content) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (role === 'ai') bubble.innerHTML = content;
  else bubble.textContent = content;
  wrap.appendChild(bubble);
  messages.appendChild(wrap);
  messages.scrollTop = messages.scrollHeight;
  return bubble;
}

function updateQuota(quota) {
  if (!quota) return;
  const unlimited = Boolean(quota.unlimited);
  const remaining = Number(quota.remaining) || 0;
  const used = Number(quota.used) || 0;
  const limit = Number(quota.limit) || 10;

  if (quotaBadge) {
    quotaBadge.innerHTML = unlimited
      ? 'AI 咨询 <strong>无限制</strong>'
      : `今日剩余 <strong>${remaining}</strong> 次`;
    quotaBadge.title = unlimited
      ? '管理员不受每日 AI 咨询次数限制'
      : `今日已使用 ${used} / ${limit} 次`;
    quotaBadge.hidden = false;
  }

  if (quotaReminder) {
    quotaReminder.innerHTML = unlimited
      ? '<span class="quota-reminder-label">AI 咨询额度</span><strong>无限制</strong>'
      : `<span class="quota-reminder-label">今日 AI 咨询</span><strong>剩余 ${remaining} 次</strong>`;
    quotaReminder.title = unlimited
      ? '管理员不受每日 AI 咨询次数限制'
      : `今日已使用 ${used} / ${limit} 次`;
    quotaReminder.hidden = false;
    quotaReminder.classList.toggle('is-depleted', !unlimited && remaining <= 0);
  }
}

function setAdminState(message, isError = false) {
  if (!adminUsersState) return;
  adminUsersState.textContent = message || '';
  adminUsersState.hidden = !message;
  adminUsersState.classList.toggle('error', isError);
}

function renderAdminUsers(users) {
  if (!adminUsersList) return;
  if (!users.length) {
    adminUsersList.innerHTML = '<div class="admin-empty">还没有注册用户。</div>';
    return;
  }
  adminUsersList.innerHTML = users.map(user => {
    const isAdmin = user.role === 'admin';
    const quota = user.quota || {};
    const quotaLabel = isAdmin || quota.unlimited ? '无限制' : `剩余 ${Number(quota.remaining) || 0} / ${quota.limit || 10} 次`;
    const action = isAdmin
      ? '<span class="admin-role">管理员</span>'
      : `<button class="admin-reset-btn" type="button" data-user-id="${user.id}" data-username="${escapeHtml(user.username)}">重置今日额度</button>`;
    return `<div class="admin-user-row"><div class="admin-user-main"><strong>${escapeHtml(user.username)}</strong><span>${quotaLabel}</span></div><div class="admin-user-action">${action}</div></div>`;
  }).join('');
  adminUsersList.querySelectorAll('.admin-reset-btn').forEach(button => {
    button.addEventListener('click', () => resetUserQuota(button));
  });
}

async function loadAdminUsers() {
  setAdminState('正在加载用户…');
  if (adminUsersList) adminUsersList.innerHTML = '';
  try {
    const resp = await fetch('/api/admin/users');
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || '加载用户失败');
    setAdminState('');
    renderAdminUsers(data.users || []);
  } catch (error) {
    setAdminState(error.message, true);
  }
}

async function resetUserQuota(button) {
  const userId = button.dataset.userId;
  const username = button.dataset.username || '该用户';
  if (!confirm(`确定重置 ${username} 今天的 AI 咨询额度吗？`)) return;
  button.disabled = true;
  try {
    const resp = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/reset-quota`, { method: 'POST' });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || '重置失败');
    await loadAdminUsers();
  } catch (error) {
    setAdminState(error.message, true);
    button.disabled = false;
  }
}

function openAdminPanel() {
  if (!adminOverlay || !currentUser || currentUser.role !== 'admin') return;
  adminOverlay.style.display = 'flex';
  loadAdminUsers();
}

function closeAdminPanel() {
  if (adminOverlay) adminOverlay.style.display = 'none';
}

function attachFeedback(bubble, answerId) {
  const box = document.createElement('div');
  box.className = 'feedback';
  box.innerHTML = '<span>这次回答有帮助吗？</span>';
  const buttons = [];
  let selected = 0;
  for (let rating = 1; rating <= 5; rating += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '★';
    button.title = `${rating} 星`;
    button.setAttribute('aria-label', `${rating} 星`);
    button.addEventListener('click', () => {
      selected = rating;
      buttons.forEach((item, index) => item.classList.toggle('selected', index < rating));
      if (rating < 5) showReason();
      else submitFeedback();
    });
    buttons.push(button);
    box.appendChild(button);
  }
  const reasonWrap = document.createElement('div');
  reasonWrap.className = 'feedback-reason';
  reasonWrap.hidden = true;
  reasonWrap.innerHTML = '<textarea placeholder="请说明哪里不满意（至少 10 个字符）"></textarea><small></small><button type="button">提交反馈</button>';
  box.appendChild(reasonWrap);
  const textarea = reasonWrap.querySelector('textarea');
  const hint = reasonWrap.querySelector('small');
  const submitButton = reasonWrap.querySelector('button');
  function showReason() { reasonWrap.hidden = false; textarea.focus(); }
  async function submitFeedback() {
    const reason = textarea.value.trim();
    if (selected < 5 && reason.length < 10) {
      reasonWrap.hidden = false;
      hint.textContent = '原因至少需要 10 个字符';
      textarea.focus();
      return;
    }
    buttons.forEach(button => { button.disabled = true; });
    submitButton.disabled = true;
    try {
      const resp = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer_id: answerId, rating: selected, reason }) });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || '反馈提交失败');
      box.classList.add('done');
      box.innerHTML = selected < 5 ? '已收到反馈，后续回答会持续调整。' : '感谢评分，回答策略已记录。';
    } catch (error) {
      buttons.forEach(button => { button.disabled = false; });
      submitButton.disabled = false;
      hint.textContent = error.message;
    }
  }
  submitButton.addEventListener('click', submitFeedback);
  bubble.appendChild(box);
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
  resizeQuestionInput();
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
    attachFeedback(bubble, data.answer_id);
    updateQuota(data.quota);
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
    const savedPath = editMode ? currentPath : data.path;
    closeModal();
    await loadDocs();
    await openDoc(savedPath);
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
questionInput.addEventListener('input', resizeQuestionInput);
questionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
});
resizeQuestionInput();

ingestBtn.addEventListener('click', async () => {
  if (!confirm('确认重建索引？这会重新扫描并重建全部文档索引，可能需要一点时间。')) return;
  setActionLabel(ingestBtn, '索引中...');
  ingestBtn.disabled = true;
  try {
    const resp = await fetch('/api/ingest', { method: 'POST' });
    const data = await resp.json();
    if (!resp.ok) { alert('索引失败：' + (data.detail || '未知错误')); return; }
    alert(`索引完成：${data.files} 篇文档，${data.chunks} 个片段`);
    loadDocs();
  } catch (e) {
    alert('索引失败：' + e.message);
  } finally {
    setActionLabel(ingestBtn, '索引');
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
  const toggleLabel = sidebarToggle.querySelector('span');
  if (toggleLabel) toggleLabel.textContent = collapsed ? '展开' : '收起';
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

  setActionLabel(uploadBtn, '上传中...');
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
    setActionLabel(uploadBtn, '上传');
    uploadBtn.disabled = false;
    fileInput.value = '';
  }
});

syncBtn.addEventListener('click', async () => {
  const src = (prompt('输入要同步的本地目录路径（该目录下的 .md 文件会被同步）', '') || '').trim();
  if (!src) return;
  if (!confirm(`确认同步目录「${src}」？该目录下的 Markdown 文件会写入本地知识库。`)) return;
  setActionLabel(syncBtn, '同步中...');
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
    setActionLabel(syncBtn, '同步');
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

function showAuthError(message) {
  authError.textContent = message || '';
  authError.hidden = !message;
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === 'register';
  authKicker.textContent = registering ? 'CREATE YOUR SPACE' : 'WELCOME BACK';
  authTitle.textContent = registering ? '注册知识库账号' : '登录 x公司知识库';
  authSubmit.textContent = registering ? '注册并进入' : '登录并进入';
  authSwitch.textContent = registering ? '已有账号？返回登录' : '还没有账号？注册一个';
  authPassword.autocomplete = registering ? 'new-password' : 'current-password';
  showAuthError('');
}

function updateRoleControls() {
  const isAdmin = currentUser?.role === 'admin';
  document.querySelectorAll('[data-admin-only]').forEach(control => {
    control.hidden = !isAdmin;
  });
}

function enterWorkspace(payload) {
  currentUser = payload.user;
  updateRoleControls();
  userName.textContent = currentUser.username;
  userInitial.textContent = currentUser.username.slice(0, 2).toUpperCase();
  if (adminButton) adminButton.hidden = currentUser.role !== 'admin';
  updateQuota(payload.quota);
  authGate.style.display = 'none';
  document.body.classList.remove('auth-locked');
  loadDocs();
}

async function initAuth() {
  try {
    const resp = await fetch('/api/auth/me');
    if (resp.ok) {
      enterWorkspace(await resp.json());
      return;
    }
  } catch (error) { /* show the login screen below */ }
  authGate.style.display = 'flex';
  document.body.classList.add('auth-locked');
  authUsername.focus();
}

document.querySelector('.workspace-user')?.addEventListener('click', async () => {
  if (!currentUser || !confirm('退出当前账号？')) return;
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.reload();
});

adminButton?.addEventListener('click', openAdminPanel);
adminClose?.addEventListener('click', closeAdminPanel);
adminCancel?.addEventListener('click', closeAdminPanel);
adminRefresh?.addEventListener('click', loadAdminUsers);
adminOverlay?.addEventListener('click', event => {
  if (event.target === adminOverlay) closeAdminPanel();
});

authSwitch.addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));
authForm.addEventListener('submit', async event => {
  event.preventDefault();
  showAuthError('');
  authSubmit.disabled = true;
  try {
    const resp = await fetch(`/api/auth/${authMode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: authUsername.value.trim(), password: authPassword.value }) });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || '操作失败');
    authPassword.value = '';
    enterWorkspace(data);
  } catch (error) {
    showAuthError(error.message);
  } finally {
    authSubmit.disabled = false;
  }
});

initAuth();

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
