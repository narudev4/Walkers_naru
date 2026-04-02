// ChatHub - Facebook Messenger Content Script
(function() {
  const TOOL_ID = 'messenger';
  let lastCount = 0;

  function countUnread() {
    let total = 0;

    // Unread message indicators in thread list
    const unreadIndicators = document.querySelectorAll(
      '[aria-label*="unread"], [data-testid*="unread"], .x1n2onr6 .x1rg5ohu'
    );
    total = unreadIndicators.length;

    // Title check (Messenger shows count in title)
    if (total === 0) {
      const match = document.title.match(/\((\d+)\)/);
      if (match) total = parseInt(match[1], 10);
    }

    return total;
  }

  function report(count) {
    if (count !== lastCount) {
      lastCount = count;
      chrome.runtime.sendMessage({
        type: 'UNREAD_COUNT',
        toolId: TOOL_ID,
        count
      }).catch(() => {});
    }
  }

  const observer = new MutationObserver(() => report(countUnread()));
  setTimeout(() => {
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true, attributes: true
    });
    report(countUnread());
  }, 3000);

  setInterval(() => report(countUnread()), 10000);
  console.log('[ChatHub] Messenger observer started');
})();
