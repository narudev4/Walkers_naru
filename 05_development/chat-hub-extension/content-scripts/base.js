// ChatHub Content Script Base
// 各チャットツール用content scriptの共通ロジック

class ChatHubObserver {
  constructor(toolId) {
    this.toolId = toolId;
    this.lastUnreadCount = 0;
    this.observer = null;
  }

  // Override in subclass: DOM selector for unread badge
  getUnreadSelector() {
    return null;
  }

  // Override in subclass: extract count from element
  extractCount(element) {
    const text = element?.textContent?.trim();
    if (!text) return 0;
    const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
    return isNaN(num) ? (text ? 1 : 0) : num;
  }

  // Override in subclass: alternative count method
  countUnread() {
    const selector = this.getUnreadSelector();
    if (!selector) return 0;

    const elements = document.querySelectorAll(selector);
    let total = 0;
    elements.forEach(el => {
      total += this.extractCount(el);
    });
    return total;
  }

  // Report unread count to background
  reportUnread(count) {
    if (count !== this.lastUnreadCount) {
      this.lastUnreadCount = count;
      chrome.runtime.sendMessage({
        type: 'UNREAD_COUNT',
        toolId: this.toolId,
        count: count
      }).catch(() => {});
    }
  }

  // Start observing DOM changes
  startObserving() {
    // Initial count
    setTimeout(() => {
      this.reportUnread(this.countUnread());
    }, 3000);

    // Observe DOM mutations
    this.observer = new MutationObserver(() => {
      this.reportUnread(this.countUnread());
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'data-count', 'aria-label']
    });

    // Periodic check as fallback
    setInterval(() => {
      this.reportUnread(this.countUnread());
    }, 10000);

    console.log(`[ChatHub] ${this.toolId} observer started`);
  }

  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}

// Export for use in other content scripts
if (typeof window !== 'undefined') {
  window.ChatHubObserver = ChatHubObserver;
}
