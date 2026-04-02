// ChatHub Side Panel Logic

// ===========================================
// DOM Elements
// ===========================================
const elements = {
  chatList: document.getElementById('chat-list'),
  totalBadge: document.getElementById('total-badge'),
  btnOpenAll: document.getElementById('btn-open-all'),
  btnCloseAll: document.getElementById('btn-close-all'),
  btnSettings: document.getElementById('btn-settings'),
  aiInput: document.getElementById('ai-input'),
  aiReply: document.getElementById('ai-reply'),
  aiSummarize: document.getElementById('ai-summarize'),
  aiTranslate: document.getElementById('ai-translate'),
  aiCustom: document.getElementById('ai-custom'),
  aiLoading: document.getElementById('ai-loading'),
  aiResult: document.getElementById('ai-result'),
  aiResultText: document.getElementById('ai-result-text'),
  aiCopy: document.getElementById('ai-copy'),
  settingProvider: document.getElementById('setting-ai-provider'),
  settingApiKey: document.getElementById('setting-api-key'),
  btnSaveKey: document.getElementById('btn-save-key'),
  toolSettings: document.getElementById('tool-settings')
};

// ===========================================
// State
// ===========================================
let currentState = {
  chatTabs: {},
  unreadCounts: {},
  activeToolId: null
};

// ===========================================
// Render Chat List
// ===========================================
function renderChatList() {
  const categories = {
    chat: { label: 'チャット', tools: [] },
    email: { label: 'メール', tools: [] }
  };

  CHAT_TOOLS.forEach(tool => {
    categories[tool.category]?.tools.push(tool);
  });

  let html = '';

  for (const [catId, cat] of Object.entries(categories)) {
    if (cat.tools.length === 0) continue;

    html += `<div class="category-header">${cat.label}</div>`;

    cat.tools.forEach(tool => {
      const isOpen = !!currentState.chatTabs[tool.id];
      const unread = currentState.unreadCounts[tool.id] || 0;
      const isActive = currentState.activeToolId === tool.id;

      html += `
        <div class="chat-item ${isActive ? 'active' : ''} ${!tool.webAvailable ? 'offline' : ''}"
             data-tool-id="${tool.id}"
             title="${tool.label}">
          <div class="chat-icon" style="background:${tool.color}">${tool.icon}</div>
          <div class="chat-info">
            <div class="chat-name">${tool.name}</div>
            <div class="chat-label">${tool.label}</div>
          </div>
          <div class="chat-status">
            ${unread > 0 ? `<div class="chat-unread">${unread}</div>` : ''}
            <div class="chat-dot ${isOpen ? '' : 'offline'}"></div>
          </div>
        </div>
      `;
    });
  }

  elements.chatList.innerHTML = html;

  // Add click handlers
  elements.chatList.querySelectorAll('.chat-item').forEach(item => {
    item.addEventListener('click', () => {
      const toolId = item.dataset.toolId;
      const tool = CHAT_TOOLS.find(t => t.id === toolId);
      if (!tool?.webAvailable) {
        showToast(`${tool.name} はWeb版非対応です`, 'error');
        return;
      }
      chrome.runtime.sendMessage({ type: 'SWITCH_CHAT', toolId });
      currentState.activeToolId = toolId;
      renderChatList();
    });
  });

  // Update total badge
  const total = Object.values(currentState.unreadCounts).reduce((a, b) => a + b, 0);
  if (total > 0) {
    elements.totalBadge.textContent = total;
    elements.totalBadge.classList.remove('hidden');
  } else {
    elements.totalBadge.classList.add('hidden');
  }
}

// ===========================================
// Tab Navigation
// ===========================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    const tabId = btn.dataset.tab;
    document.getElementById(`tab-${tabId}`).classList.add('active');
  });
});

// ===========================================
// Chat Actions
// ===========================================
elements.btnOpenAll.addEventListener('click', async () => {
  elements.btnOpenAll.disabled = true;
  elements.btnOpenAll.textContent = '起動中...';

  await chrome.runtime.sendMessage({ type: 'OPEN_ALL_CHATS' });

  elements.btnOpenAll.disabled = false;
  elements.btnOpenAll.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
    全て開く
  `;
  showToast('全チャットツールを開きました');
  refreshState();
});

elements.btnCloseAll.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CLOSE_ALL_CHATS' });
  showToast('全チャットタブを閉じました');
  refreshState();
});

elements.btnSettings.addEventListener('click', () => {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('[data-tab="settings"]').classList.add('active');
  document.getElementById('tab-settings').classList.add('active');
});

// ===========================================
// AI Functions
// ===========================================
async function aiAction(action) {
  const text = elements.aiInput.value.trim();
  if (!text) {
    showToast('テキストを入力してください', 'error');
    return;
  }

  elements.aiLoading.classList.remove('hidden');
  elements.aiResult.classList.add('hidden');

  let msgType;
  switch (action) {
    case 'reply': msgType = 'AI_REPLY'; break;
    case 'summarize': msgType = 'AI_SUMMARIZE'; break;
    case 'translate': msgType = 'AI_TRANSLATE'; break;
    case 'custom':
      msgType = 'AI_REQUEST';
      break;
  }

  const response = await chrome.runtime.sendMessage({
    type: msgType,
    text: text,
    prompt: text,
    toolName: 'ChatHub'
  });

  elements.aiLoading.classList.add('hidden');

  if (response?.error) {
    showToast(response.error, 'error');
    return;
  }

  if (response?.text) {
    elements.aiResultText.textContent = response.text;
    elements.aiResult.classList.remove('hidden');
  }
}

elements.aiReply.addEventListener('click', () => aiAction('reply'));
elements.aiSummarize.addEventListener('click', () => aiAction('summarize'));
elements.aiTranslate.addEventListener('click', () => aiAction('translate'));
elements.aiCustom.addEventListener('click', () => aiAction('custom'));

elements.aiCopy.addEventListener('click', () => {
  const text = elements.aiResultText.textContent;
  navigator.clipboard.writeText(text);
  showToast('コピーしました');
});

// Listen for AI results from context menu
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'AI_RESULT') {
    // Switch to AI tab
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('[data-tab="ai"]').classList.add('active');
    document.getElementById('tab-ai').classList.add('active');

    elements.aiInput.value = msg.originalText;

    if (msg.result?.text) {
      elements.aiResultText.textContent = msg.result.text;
      elements.aiResult.classList.remove('hidden');
      elements.aiLoading.classList.add('hidden');
    } else if (msg.result?.error) {
      showToast(msg.result.error, 'error');
    }
  }

  if (msg.type === 'UNREAD_UPDATE') {
    currentState.unreadCounts = msg.counts;
    renderChatList();
  }
});

// ===========================================
// Settings
// ===========================================
async function loadSettings() {
  const data = await chrome.storage.local.get(['chathub_ai_provider', 'chathub_ai_api_key', 'chathub_disabled_tools']);

  if (data.chathub_ai_provider) {
    elements.settingProvider.value = data.chathub_ai_provider;
  }

  if (data.chathub_ai_api_key) {
    elements.settingApiKey.value = '••••••••' + data.chathub_ai_api_key.slice(-4);
  }

  // Render tool toggles
  const disabled = data.chathub_disabled_tools || [];
  elements.toolSettings.innerHTML = CHAT_TOOLS.map(tool => `
    <div class="tool-setting-row">
      <input type="checkbox" id="toggle-${tool.id}" data-tool-id="${tool.id}"
             ${!disabled.includes(tool.id) ? 'checked' : ''}>
      <label for="toggle-${tool.id}">${tool.name} - ${tool.label}</label>
    </div>
  `).join('');
}

elements.btnSaveKey.addEventListener('click', async () => {
  const key = elements.settingApiKey.value;
  const provider = elements.settingProvider.value;

  if (!key || key.startsWith('••')) {
    showToast('新しいAPIキーを入力してください', 'error');
    return;
  }

  await chrome.storage.local.set({
    chathub_ai_api_key: key,
    chathub_ai_provider: provider
  });

  elements.settingApiKey.value = '••••••••' + key.slice(-4);
  showToast('APIキーを保存しました');
});

// ===========================================
// Utilities
// ===========================================
function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

async function refreshState() {
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  if (state) {
    currentState.chatTabs = state.chatTabs || {};
    currentState.unreadCounts = state.unreadCounts || {};
    renderChatList();
  }
}

// ===========================================
// Initialize
// ===========================================
async function init() {
  renderChatList();
  loadSettings();
  refreshState();

  // Refresh every 5 seconds
  setInterval(refreshState, 5000);
}

init();
