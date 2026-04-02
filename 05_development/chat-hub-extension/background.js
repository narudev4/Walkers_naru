// ChatHub Background Service Worker
importScripts('config.js');

// ===========================================
// State Management
// ===========================================
let chatTabs = {};        // { toolId: tabId }
let chatGroupId = null;   // Tab Group ID
let unreadCounts = {};    // { toolId: count }
let hubWindowId = null;   // Dedicated window ID

// ===========================================
// Extension Install / Startup
// ===========================================
chrome.runtime.onInstalled.addListener(async () => {
  // Context menu for AI reply
  chrome.contextMenus.create({
    id: 'chathub-ai-reply',
    title: 'ChatHub: AI返信案を生成',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'chathub-ai-summarize',
    title: 'ChatHub: 要約する',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'chathub-ai-translate',
    title: 'ChatHub: 英語に翻訳',
    contexts: ['selection']
  });

  // Set side panel behavior
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  console.log('[ChatHub] Extension installed');
});

// ===========================================
// Tab Management
// ===========================================

// Open all chat tools in a tab group
async function openAllChats() {
  // Create a dedicated window or use current
  const currentWindow = await chrome.windows.getCurrent();
  hubWindowId = currentWindow.id;

  const openPromises = CHAT_TOOLS.filter(t => t.webAvailable).map(async (tool) => {
    // Check if tab already exists
    if (chatTabs[tool.id]) {
      try {
        await chrome.tabs.get(chatTabs[tool.id]);
        return; // Tab still exists
      } catch {
        delete chatTabs[tool.id]; // Tab was closed
      }
    }

    const tab = await chrome.tabs.create({
      url: tool.url,
      active: false,
      pinned: true
    });
    chatTabs[tool.id] = tab.id;
  });

  await Promise.all(openPromises);

  // Group all tabs
  const tabIds = Object.values(chatTabs).filter(id => id);
  if (tabIds.length > 0) {
    try {
      chatGroupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(chatGroupId, {
        title: 'ChatHub',
        color: 'blue',
        collapsed: false
      });
    } catch (e) {
      console.log('[ChatHub] Tab grouping failed:', e);
    }
  }

  // Save state
  await chrome.storage.local.set({ chatTabs, chatGroupId });
  console.log('[ChatHub] All chats opened:', Object.keys(chatTabs));
}

// Switch to a specific chat tool tab
async function switchToChat(toolId) {
  const tabId = chatTabs[toolId];
  if (!tabId) {
    // Tab doesn't exist, open it
    const tool = CHAT_TOOLS.find(t => t.id === toolId);
    if (!tool) return;

    const tab = await chrome.tabs.create({
      url: tool.url,
      active: true,
      pinned: true
    });
    chatTabs[toolId] = tab.id;
    await chrome.storage.local.set({ chatTabs });
    return;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });

    // Clear unread for this tool
    unreadCounts[toolId] = 0;
    broadcastUnreadCounts();
  } catch {
    // Tab was closed, reopen
    delete chatTabs[toolId];
    await switchToChat(toolId);
  }
}

// Close all chat tabs
async function closeAllChats() {
  const tabIds = Object.values(chatTabs).filter(id => id);
  for (const tabId of tabIds) {
    try {
      await chrome.tabs.remove(tabId);
    } catch {}
  }
  chatTabs = {};
  chatGroupId = null;
  await chrome.storage.local.set({ chatTabs, chatGroupId });
}

// ===========================================
// Unread Count Management
// ===========================================
function broadcastUnreadCounts() {
  chrome.runtime.sendMessage({
    type: 'UNREAD_UPDATE',
    counts: unreadCounts,
    total: Object.values(unreadCounts).reduce((a, b) => a + b, 0)
  }).catch(() => {}); // Side panel might not be open

  // Update badge
  const total = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
  chrome.action.setBadgeText({ text: total > 0 ? String(total) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#E53E3E' });
}

// ===========================================
// AI Assistant
// ===========================================
async function callAI(prompt, context) {
  const { chathub_ai_api_key: apiKey, chathub_ai_provider: provider } =
    await chrome.storage.local.get(['chathub_ai_api_key', 'chathub_ai_provider']);

  if (!apiKey) {
    return { error: 'APIキーが設定されていません。設定画面からAPIキーを入力してください。' };
  }

  const useProvider = provider || AI_CONFIG.provider;

  try {
    if (useProvider === 'anthropic') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: AI_CONFIG.model,
          max_tokens: 1024,
          system: AI_CONFIG.systemPrompt,
          messages: [{ role: 'user', content: `${context ? `[${context}]\n` : ''}${prompt}` }]
        })
      });
      const data = await response.json();
      if (data.content && data.content[0]) {
        return { text: data.content[0].text };
      }
      return { error: data.error?.message || 'AI応答エラー' };
    } else {
      // OpenAI
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: AI_CONFIG.systemPrompt },
            { role: 'user', content: `${context ? `[${context}]\n` : ''}${prompt}` }
          ]
        })
      });
      const data = await response.json();
      if (data.choices && data.choices[0]) {
        return { text: data.choices[0].message.content };
      }
      return { error: data.error?.message || 'AI応答エラー' };
    }
  } catch (e) {
    return { error: `通信エラー: ${e.message}` };
  }
}

// ===========================================
// Message Handling
// ===========================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'OPEN_ALL_CHATS':
      openAllChats().then(() => sendResponse({ ok: true }));
      return true;

    case 'SWITCH_CHAT':
      switchToChat(msg.toolId).then(() => sendResponse({ ok: true }));
      return true;

    case 'CLOSE_ALL_CHATS':
      closeAllChats().then(() => sendResponse({ ok: true }));
      return true;

    case 'GET_STATE':
      sendResponse({ chatTabs, unreadCounts, chatGroupId });
      return false;

    case 'UNREAD_COUNT':
      unreadCounts[msg.toolId] = msg.count || 0;
      broadcastUnreadCounts();
      sendResponse({ ok: true });
      return false;

    case 'AI_REQUEST':
      callAI(msg.prompt, msg.context).then(sendResponse);
      return true;

    case 'AI_REPLY':
      callAI(
        `以下のメッセージに対する返信案を3パターン生成してください:\n\n「${msg.text}」`,
        msg.toolName
      ).then(sendResponse);
      return true;

    case 'AI_SUMMARIZE':
      callAI(
        `以下のメッセージを簡潔に要約してください:\n\n「${msg.text}」`,
        msg.toolName
      ).then(sendResponse);
      return true;

    case 'AI_TRANSLATE':
      callAI(
        `以下を英語に翻訳してください。自然なビジネス英語で:\n\n「${msg.text}」`,
        msg.toolName
      ).then(sendResponse);
      return true;
  }
});

// Context Menu handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.selectionText) return;

  const toolId = Object.entries(chatTabs).find(([, id]) => id === tab.id)?.[0];
  const toolName = CHAT_TOOLS.find(t => t.id === toolId)?.name || '';

  let result;
  switch (info.menuItemId) {
    case 'chathub-ai-reply':
      result = await callAI(
        `以下のメッセージに対する返信案を3パターン生成してください:\n\n「${info.selectionText}」`,
        toolName
      );
      break;
    case 'chathub-ai-summarize':
      result = await callAI(
        `以下を簡潔に要約:\n\n「${info.selectionText}」`,
        toolName
      );
      break;
    case 'chathub-ai-translate':
      result = await callAI(
        `以下を英語に翻訳:\n\n「${info.selectionText}」`,
        toolName
      );
      break;
  }

  if (result) {
    // Send result to side panel
    chrome.runtime.sendMessage({
      type: 'AI_RESULT',
      result: result,
      originalText: info.selectionText,
      action: info.menuItemId
    }).catch(() => {});
  }
});

// Track tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [toolId, id] of Object.entries(chatTabs)) {
    if (id === tabId) {
      delete chatTabs[toolId];
      chrome.storage.local.set({ chatTabs });
      break;
    }
  }
});

console.log('[ChatHub] Background service worker started');
