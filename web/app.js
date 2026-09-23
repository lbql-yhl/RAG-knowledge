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
const newDirBtn = document.getElementById('new-dir-btn');
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
const userMenuBtn = document.getElementById('user-menu-btn');
const userPanel = document.getElementById('user-panel');
const userAvatarBox = document.getElementById('user-avatar');
const panelAvatar = document.getElementById('panel-avatar');
const panelName = document.getElementById('panel-name');
const panelUsername = document.getElementById('panel-username');
const profileOverlay = document.getElementById('profile-overlay');
const profileClose = document.getElementById('profile-close');
const profileCancel = document.getElementById('profile-cancel');
const profileSave = document.getElementById('profile-save');
const profileNameInput = document.getElementById('profile-name');
const profileError = document.getElementById('profile-error');
const profileQuota = document.getElementById('profile-quota');
const profileAvatarBtn = document.getElementById('profile-avatar-btn');
const profileAvatarPreview = document.getElementById('profile-avatar-preview');
const avatarInput = document.getElementById('avatar-input');
const quotaReminder = document.getElementById('quota-reminder');
const adminButton = document.getElementById('admin-btn');
const adminOverlay = document.getElementById('admin-overlay');
const adminClose = document.getElementById('admin-close');
const adminCancel = document.getElementById('admin-cancel');
const adminRefresh = document.getElementById('admin-refresh');
const adminUsersState = document.getElementById('admin-users-state');
const adminUsersList = document.getElementById('admin-users-list');
const adminRequestsState = document.getElementById('admin-requests-state');
const adminRequestsList = document.getElementById('admin-requests-list');
const permissionButton = document.getElementById('permission-btn');
const permissionOverlay = document.getElementById('permission-overlay');
const permissionClose = document.getElementById('permission-close');
const permissionDone = document.getElementById('permission-done');
const permissionState = document.getElementById('permission-state');
const permissionList = document.getElementById('permission-list');

/* ---------------------------------------------------------------- 交互层适配
   把原生 alert / confirm / prompt 换成界面内组件（index.html 中的 kbToast / kbAsk）。
   原生版本是阻塞式的，无法控制样式，也与整体气质不符。
   - notify()    非阻塞浮层，用于通知类信息
   - confirmAsk()非阻塞对话框，回调式，替代 confirm
   - promptAsk() 非阻塞输入框，回调式，替代 prompt
   注意：这几个名字刻意与业务函数 ask()（RAG 问答）区分，避免覆盖。
   若增强层未加载（例如直接打开 html 文件），自动回退到原生实现。 */
function notify(message, kind) {
  if (typeof window.kbToast === 'function') {
    window.kbToast(message, { kind: kind || (String(message).includes('失败') ? 'error' : 'info') });
    return;
  }
  window.alert(message);
}

function confirmAsk(options, onOk) {
  if (typeof window.kbAsk !== 'function') {
    if (window.confirm(options.message)) onOk();
    return;
  }
  window.kbAsk({
    mode: 'confirm',
    eyebrow: options.eyebrow || 'CONFIRM',
    title: options.title || '请确认',
    message: options.message,
    okLabel: options.okLabel || '确定',
    cancelLabel: options.cancelLabel || '取消'
  }, (ok) => { if (ok) onOk(); });
}

function promptAsk(options, onOk) {
  if (typeof window.kbAsk !== 'function') {
    const value = window.prompt(options.message, options.value || '');
    if (value !== null) onOk((value || '').trim());
    return;
  }
  window.kbAsk({
    mode: 'prompt',
    eyebrow: options.eyebrow || 'INPUT',
    title: options.title || '填写信息',
    message: options.message,
    inputLabel: options.inputLabel || '内容',
    placeholder: options.placeholder || '',
    value: options.value || '',
    okLabel: options.okLabel || '确定',
    cancelLabel: options.cancelLabel || '取消'
  }, (ok, value) => { if (ok) onOk(value || ''); });
}

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

function setPermissionState(message, isError = false) {
  if (!permissionState) return;
  permissionState.textContent = message || '';
  permissionState.hidden = !message;
  permissionState.classList.toggle('error', isError);
}

function renderPermissions(items) {
  if (!permissionList) return;
  permissionList.innerHTML = (items || []).map(item => {
    const status = item.status || 'none';
    const labels = { approved: '已通过', pending: '待审批', rejected: '已拒绝', none: '未申请' };
    const action = status === 'approved'
      ? '<span class="permission-status approved">已授权</span>'
      : status === 'pending'
        ? '<span class="permission-status pending">等待审批</span>'
        : `<button class="permission-request-btn" type="button" data-permission-key="${escapeHtml(item.permission_key || item.key)}">申请权限</button>`;
    return `<div class="permission-row"><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.description || '')}</span></div><div>${action}<small class="permission-label">${labels[status]}</small></div></div>`;
  }).join('') || '<div class="admin-empty">暂无可申请的知识库。</div>';
  permissionList.querySelectorAll('.permission-request-btn').forEach(button => {
    button.addEventListener('click', () => requestPermission(button));
  });
}

async function loadPermissions() {
  setPermissionState('正在加载权限…');
  try {
    const resp = await fetch('/api/permissions');
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || '加载权限失败');
    setPermissionState(data.is_admin ? '管理员拥有全部知识库权限。' : '申请后由管理员审批，通过后即可查看对应库文档。');
    renderPermissions(data.permissions || []);
  } catch (error) {
    setPermissionState(error.message, true);
  }
}

async function requestPermission(button) {
  const key = button.dataset.permissionKey;
  button.disabled = true;
  try {
    const resp = await fetch(`/api/permissions/${encodeURIComponent(key)}/request`, { method: 'POST' });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || '申请失败');
    renderPermissions(data.permissions || []);
    await loadDocs();
  } catch (error) {
    setPermissionState(error.message, true);
    button.disabled = false;
  }
}

function openPermissionPanel() {
  if (!permissionOverlay) return;
  permissionOverlay.style.display = 'flex';
  loadPermissions();
}

function closePermissionPanel() {
  if (permissionOverlay) permissionOverlay.style.display = 'none';
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
      : `<div class="admin-user-actions"><button class="admin-reset-btn" type="button" data-user-id="${user.id}" data-username="${escapeHtml(user.username)}">重置今日额度</button><button class="admin-delete-btn" type="button" data-user-id="${user.id}" data-username="${escapeHtml(user.username)}">删除用户</button></div>`;
    return `<div class="admin-user-row"><div class="admin-user-main"><strong>${escapeHtml(user.username)}</strong><span>${quotaLabel}</span></div><div class="admin-user-action">${action}</div></div>`;
  }).join('');
  adminUsersList.querySelectorAll('.admin-reset-btn').forEach(button => {
    button.addEventListener('click', () => resetUserQuota(button));
  });
  adminUsersList.querySelectorAll('.admin-delete-btn').forEach(button => {
    button.addEventListener('click', () => deleteUser(button));
  });
}

function setAdminRequestsState(message, isError = false) {
  if (!adminRequestsState) return;
  adminRequestsState.textContent = message || '';
  adminRequestsState.hidden = !message;
  adminRequestsState.classList.toggle('error', isError);
}

function renderAdminRequests(requests) {
  if (!adminRequestsList) return;
  const pending = (requests || []).filter(item => item.status === 'pending');
  adminRequestsList.innerHTML = pending.length ? pending.map(item => `<div class="admin-user-row permission-admin-row"><div class="admin-user-main"><strong>${escapeHtml(item.username)}</strong><span>申请「${escapeHtml(item.name)}」</span></div><div class="admin-user-action"><button class="admin-approve-btn" type="button" data-request-id="${item.id}" data-request-status="approved">通过</button><button class="admin-reject-btn" type="button" data-request-id="${item.id}" data-request-status="rejected">拒绝</button></div></div>`).join('') : '<div class="admin-empty">暂无待审批申请。</div>';
  adminRequestsList.querySelectorAll('[data-request-id]').forEach(button => button.addEventListener('click', () => reviewPermission(button)));
}

async function loadAdminRequests() {
  setAdminRequestsState('正在加载申请…');
  try {
    const resp = await fetch('/api/admin/permission-requests');
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || '加载申请失败');
    setAdminRequestsState('');
    renderAdminRequests(data.requests || []);
  } catch (error) {
    setAdminRequestsState(error.message, true);
  }
}

async function reviewPermission(button) {
  button.disabled = true;
  try {
    const resp = await fetch(`/api/admin/permission-requests/${encodeURIComponent(button.dataset.requestId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: button.dataset.requestStatus }) });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || '审批失败');
    await loadAdminRequests();
  } catch (error) {
    setAdminRequestsState(error.message, true);
    button.disabled = false;
  }
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
  confirmAsk({
    eyebrow: 'RESET QUOTA',
    title: '重置今日额度',
    message: `将把「${username}」今天的 AI 咨询次数清零，重置后可以重新使用 10 次。`,
    okLabel: '重置额度'
  }, async () => {
    button.disabled = true;
    try {
      const resp = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/reset-quota`, { method: 'POST' });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || '重置失败');
      notify(`已重置「${username}」的今日额度`, 'success');
      await loadAdminUsers();
    } catch (error) {
      setAdminState(error.message, true);
      button.disabled = false;
    }
  });
}

async function deleteUser(button) {
  const userId = button.dataset.userId;
  const username = button.dataset.username || '该用户';
  confirmAsk({
    eyebrow: 'DELETE USER',
    title: '删除这个用户',
    message: `将永久删除「${username}」，它的会话、问答记录和权限申请会一并清除。此操作无法撤销。`,
    okLabel: '删除用户'
  }, async () => {
    button.disabled = true;
    try {
      const resp = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || '删除用户失败');
      notify(`已删除用户「${username}」`, 'success');
      await loadAdminUsers();
    } catch (error) {
      setAdminState(error.message, true);
      button.disabled = false;
    }
  });
}

function openAdminPanel() {
  if (!adminOverlay || !currentUser || currentUser.role !== 'admin') return;
  adminOverlay.style.display = 'flex';
  loadAdminUsers();
  loadAdminRequests();
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
  populateDirSelect(data.tree);
  filterDocuments(docSearch.value);
}

function collectDirs(node, prefix, out) {
  node.dirs.forEach(dir => {
    const path = prefix ? prefix + '/' + dir.name : dir.name;
    out.push(path);
    collectDirs(dir, path, out);
  });
}

function populateDirSelect(tree) {
  const dirs = [];
  collectDirs(tree, '', dirs);
  const current = docDirInput.value;
  docDirInput.innerHTML = dirs.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  docDirInput.value = current || (dirs[0] || '');
}

newDirBtn?.addEventListener('click', () => {
  promptAsk({
    eyebrow: 'NEW DIRECTORY',
    title: '新建目录',
    message: '输入新目录名称，可含多级（如「运营/周报」）。保存文档时会一并创建。',
    inputLabel: '目录名',
    placeholder: '如：运营资料',
    okLabel: '创建'
  }, (value) => {
    const name = (value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!name) { notify('目录名不能为空', 'error'); return; }
    const exists = Array.from(docDirInput.options).some(o => o.value === name);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      docDirInput.appendChild(opt);
    }
    docDirInput.value = name;
  });
});

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
    if (newDirBtn) newDirBtn.disabled = true;
  } else {
    docNameInput.value = '';
    docContentInput.value = '';
    docNameInput.disabled = false;
    docDirInput.disabled = false;
    if (newDirBtn) newDirBtn.disabled = false;
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
  if (!name) {
    notify('请先填写文档标题', 'warn');
    docNameInput.focus();
    return;
  }

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
    if (!resp.ok) {
      const detail = data.detail || '未知错误';
      // 目录已存在但无权限 → 弹窗提示，并引导去申请权限
      if (resp.status === 403 && detail.includes('请先申请权限')) {
        confirmAsk({
          eyebrow: 'NO PERMISSION',
          title: '该目录已存在',
          message: detail,
          okLabel: '去申请权限'
        }, () => {
          closeModal();
          openPermissionPanel();
        });
        return;
      }
      notify('保存失败：' + detail, 'error');
      return;
    }
    const savedPath = editMode ? currentPath : data.path;
    closeModal();
    notify(`已保存「${savedPath}」`, 'success');
    await loadDocs();
    await openDoc(savedPath);
  } catch (e) {
    notify('保存失败：' + e.message, 'error');
  } finally {
    modalSave.disabled = false;
  }
}

async function deleteDoc() {
  if (!currentPath) return;
  const target = currentPath;
  confirmAsk({
    eyebrow: 'DELETE DOCUMENT',
    title: '删除这篇文档',
    message: `将永久删除「${target}」。删除后需要重新上传才能恢复。`,
    okLabel: '删除文档'
  }, async () => {
    const resp = await fetch('/api/doc/' + encodeURIComponent(target), { method: 'DELETE' });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      notify('删除失败：' + (data.detail || '未知错误'), 'error');
      return;
    }
    currentPath = null;
    viewerToolbar.style.display = 'none';
    viewer.innerHTML = '<div class="viewer-empty"><div class="document-art" aria-hidden="true"><span></span><i></i><b></b><em></em></div><div class="viewer-empty-label">DOCUMENT PREVIEW</div><strong>选择一篇文档开始阅读</strong><span>从左侧打开一份资料，或先创建一篇 Markdown 文档。</span><div class="viewer-empty-tip"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 7.5h.01"/></svg> 回答里的引用可以直接跳到对应段落</div></div>';
    notify(`已删除「${target}」`, 'success');
    await loadDocs();
  });
}

askBtn.addEventListener('click', ask);
questionInput.addEventListener('input', resizeQuestionInput);
questionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
});
resizeQuestionInput();

ingestBtn.addEventListener('click', () => {
  confirmAsk({
    eyebrow: 'REINDEX',
    title: '重建全部索引',
    message: '将重新扫描文档目录并重建向量与关键词索引。文档较多时需要一两分钟，期间可以继续浏览已有内容。',
    okLabel: '开始重建'
  }, async () => {
    setActionLabel(ingestBtn, '索引中...');
    ingestBtn.disabled = true;
    try {
      const resp = await fetch('/api/ingest', { method: 'POST' });
      const data = await resp.json();
      if (!resp.ok) { notify('索引失败：' + (data.detail || '未知错误'), 'error'); return; }
      notify(`索引完成：${data.files} 篇文档，${data.chunks} 个片段`, 'success');
      loadDocs();
    } catch (e) {
      notify('索引失败：' + e.message, 'error');
    } finally {
      setActionLabel(ingestBtn, '索引');
      ingestBtn.disabled = false;
    }
  });
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
  document.body.classList.remove('drawer-open');
  const drawerBtn = document.getElementById('drawer-toggle');
  if (drawerBtn) {
    drawerBtn.setAttribute('aria-expanded', 'false');
    drawerBtn.setAttribute('aria-label', '打开侧边栏');
  }
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
  const fileCount = files.length;

  promptAsk({
    eyebrow: 'UPLOAD',
    title: '上传到哪个目录',
    message: `已选择 ${fileCount} 个 Markdown 文件。填写目标目录名，留空则放在文档库根目录。`,
    inputLabel: '目录（可选）',
    placeholder: '如：AI知识',
    okLabel: '开始上传'
  }, async (dir) => {
    const formData = new FormData();
    for (const f of files) formData.append('files', f);
    formData.append('dir', dir);

    setActionLabel(uploadBtn, '上传中...');
    uploadBtn.disabled = true;
    try {
      const resp = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await resp.json();
      if (!resp.ok) { notify('上传失败：' + (data.detail || '未知错误'), 'error'); return; }
      notify(`已上传 ${data.uploaded.length} 个文档`, 'success');
      loadDocs();
    } catch (e) {
      notify('上传失败：' + e.message, 'error');
    } finally {
      setActionLabel(uploadBtn, '上传');
      uploadBtn.disabled = false;
      fileInput.value = '';
    }
  });
});

syncBtn.addEventListener('click', () => {
  promptAsk({
    eyebrow: 'SYNC DIRECTORY',
    title: '同步本地目录',
    message: '填写本机上存放 Markdown 的目录绝对路径。该目录下的 .md 文件会被复制进知识库，原目录不受影响。',
    inputLabel: '目录路径',
    placeholder: '如：D:\\公司文档\\制度',
    okLabel: '下一步'
  }, (src) => {
    if (!src) { notify('没有填写目录路径，已取消同步', 'warn'); return; }
    confirmAsk({
      eyebrow: 'CONFIRM SYNC',
      title: '确认同步',
      message: `将把「${src}」下的所有 Markdown 文件写入本地知识库。同名文件会被覆盖。`,
      okLabel: '确认同步'
    }, async () => {
      setActionLabel(syncBtn, '同步中...');
      syncBtn.disabled = true;
      try {
        const resp = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_dir: src })
        });
        const data = await resp.json();
        if (!resp.ok) { notify('同步失败：' + (data.detail || '未知错误'), 'error'); return; }
        notify(`已同步 ${data.count} 个文档`, 'success');
        loadDocs();
      } catch (e) {
        notify('同步失败：' + e.message, 'error');
      } finally {
        setActionLabel(syncBtn, '同步');
        syncBtn.disabled = false;
      }
    });
  });
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
  renderAvatar(userAvatarBox, null, currentUser.username);
  renderAvatar(panelAvatar, null, currentUser.username);
  if (adminButton) adminButton.hidden = currentUser.role !== 'admin';
  updateQuota(payload.quota);
  authGate.style.display = 'none';
  document.body.classList.remove('auth-locked');
  loadDocs();
  loadProfile().then(applyUserProfile).catch(() => {});
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

/* ---------------- 用户菜单（头像面板） + 编辑资料 ---------------- */

let currentProfile = null;
let profileOriginal = null;
let profileDraftAvatar = null;

function renderAvatar(box, profile, fallbackName) {
  if (!box) return;
  if (profile && profile.avatar) {
    box.innerHTML = `<img src="${profile.avatar}" alt="">`;
    return;
  }
  box.innerHTML = '';
  const initial = document.createElement('span');
  initial.id = box.id === 'user-avatar' ? 'user-initial' : '';
  initial.textContent = (fallbackName || 'KB').slice(0, 2).toUpperCase();
  box.appendChild(initial);
}

function applyUserProfile(profile) {
  if (!profile) return;
  currentProfile = profile;
  const display = profile.display_name || (currentUser && currentUser.username) || '';
  userName.textContent = display;
  renderAvatar(userAvatarBox, profile, display);
  renderAvatar(panelAvatar, profile, display);
  if (panelName) panelName.textContent = display;
  if (panelUsername) panelUsername.textContent = '@' + profile.username;
}

async function loadProfile() {
  const resp = await fetch('/api/profile');
  if (!resp.ok) throw new Error('load profile failed');
  return resp.json();
}

function setUserPanel(open) {
  if (!userPanel || !userMenuBtn) return;
  userPanel.hidden = !open;
  userMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

userMenuBtn?.addEventListener('click', event => {
  event.stopPropagation();
  if (!currentUser) return;
  setUserPanel(userPanel.hidden);
});

document.addEventListener('click', event => {
  if (!userPanel || userPanel.hidden) return;
  if (event.target.closest && event.target.closest('.user-menu-wrap')) return;
  setUserPanel(false);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && userPanel && !userPanel.hidden) setUserPanel(false);
});

userPanel?.querySelector('[data-user-action="switch"]')?.addEventListener('click', async () => {
  setUserPanel(false);
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) { /* 忽略网络错误，仍回到登录页 */ }
  window.location.reload();
});

userPanel?.querySelector('[data-user-action="logout"]')?.addEventListener('click', () => {
  setUserPanel(false);
  const name = (currentProfile && currentProfile.display_name) || (currentUser && currentUser.username) || '';
  confirmAsk({
    eyebrow: 'SIGN OUT',
    title: '退出当前账号',
    message: `将以「${name}」的身份退出。你的文档和问答记录都保存在本地，下次登录还在。`,
    okLabel: '退出登录'
  }, async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.reload();
  });
});

userPanel?.querySelector('[data-user-action="profile"]')?.addEventListener('click', () => {
  setUserPanel(false);
  openProfileModal();
});

function showProfileError(message) {
  if (!profileError) return;
  if (!message) { profileError.hidden = true; profileError.textContent = ''; return; }
  profileError.textContent = message;
  profileError.hidden = false;
}

function updateProfileQuota(profile) {
  if (profileQuota) {
    profileQuota.innerHTML = `本月剩余修改次数：<b>${profile.edits_left} / ${profile.edits_limit}</b>`;
  }
}

async function openProfileModal() {
  showProfileError('');
  profileDraftAvatar = null;
  profileAvatarPreview.innerHTML = '';
  try {
    profileOriginal = await loadProfile();
  } catch (error) {
    notify('加载资料失败，请稍后再试', 'error');
    return;
  }
  const display = profileOriginal.display_name || profileOriginal.username || '';
  profileNameInput.value = display;
  if (profileOriginal.avatar) {
    profileAvatarPreview.innerHTML = `<img src="${profileOriginal.avatar}" alt="">`;
  } else {
    profileAvatarPreview.textContent = display.slice(0, 1).toUpperCase() || 'K';
  }
  updateProfileQuota(profileOriginal);
  profileOverlay.style.display = 'flex';
  profileNameInput.focus();
}

function closeProfileModal() {
  if (!profileOverlay) return;
  profileOverlay.style.display = 'none';
  profileDraftAvatar = null;
  showProfileError('');
}

profileClose?.addEventListener('click', closeProfileModal);
profileCancel?.addEventListener('click', closeProfileModal);
profileOverlay?.addEventListener('click', event => { if (event.target === profileOverlay) closeProfileModal(); });

profileAvatarBtn?.addEventListener('click', () => avatarInput.click());

/* 头像压缩：居中裁方 → canvas 缩放到 256px → JPEG dataURL（约 20-40KB） */
function compressAvatar(file, size) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { reject(new Error('type')); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

avatarInput?.addEventListener('change', () => {
  const file = avatarInput.files && avatarInput.files[0];
  avatarInput.value = '';
  if (!file) return;
  compressAvatar(file, 256)
    .then(dataUrl => {
      profileDraftAvatar = dataUrl;
      profileAvatarPreview.innerHTML = `<img src="${dataUrl}" alt="">`;
    })
    .catch(() => notify('图片读取失败，请换一张 JPG / PNG / WebP 试试', 'error'));
});

profileSave?.addEventListener('click', async () => {
  showProfileError('');
  const nextName = profileNameInput.value.trim();
  const prevName = (profileOriginal && profileOriginal.display_name) || '';
  const body = {};
  if (nextName !== prevName) body.display_name = nextName;
  if (profileDraftAvatar && profileDraftAvatar !== ((profileOriginal && profileOriginal.avatar) || null)) {
    body.avatar = profileDraftAvatar;
  }
  if (!body.display_name && !body.avatar) {
    closeProfileModal();
    return;
  }
  if (body.display_name && !/^[\u4e00-\u9fffA-Za-z]{1,20}$/.test(body.display_name)) {
    showProfileError('名称只能包含中文和英文字符（1–20 个）');
    return;
  }
  profileSave.disabled = true;
  try {
    const resp = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || '保存失败');
    applyUserProfile(data.profile);
    updateProfileQuota(data.profile);
    notify('资料已更新', 'success');
    closeProfileModal();
  } catch (error) {
    showProfileError(error.message || '保存失败，请稍后再试');
  } finally {
    profileSave.disabled = false;
  }
});

adminButton?.addEventListener('click', openAdminPanel);
adminClose?.addEventListener('click', closeAdminPanel);
adminCancel?.addEventListener('click', closeAdminPanel);
adminRefresh?.addEventListener('click', () => { loadAdminUsers(); loadAdminRequests(); });
permissionButton?.addEventListener('click', openPermissionPanel);
permissionClose?.addEventListener('click', closePermissionPanel);
permissionDone?.addEventListener('click', closePermissionPanel);
permissionOverlay?.addEventListener('click', event => { if (event.target === permissionOverlay) closePermissionPanel(); });
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
  if (typeof window.kbAsk === 'function') {
    window.kbAsk({
      eyebrow: 'HOW TO USE',
      title: '使用说明',
      message: '左侧是文档库，点开目录里的文件即可阅读；文档里的标题会成为回答的引用锚点。中间输入框可以直接提问，按回车发送、Shift + 回车换行，回答下方会列出出处，点一下就能跳到原文位置。'
        + '新建文档时可以使用上方工具栏插入标题、列表、代码和表格，Ctrl + S 保存。'
        + '如果某类资料看不到，说明你还没有那类知识库的权限，点右上角「我的权限」申请，管理员审批后即可使用。',
      okLabel: '知道了'
    }, () => {});
    return;
  }
  window.alert('使用说明：从左侧选择文档查看内容，也可以直接在下方输入问题。新建文档时可使用 Markdown 工具栏插入标题、列表、代码和表格。');
});

docSearch.addEventListener('input', () => filterDocuments(docSearch.value));
document.querySelectorAll('[data-question]').forEach(button => {
  button.addEventListener('click', () => {
    questionInput.value = button.dataset.question;
    questionInput.focus();
  });
});
