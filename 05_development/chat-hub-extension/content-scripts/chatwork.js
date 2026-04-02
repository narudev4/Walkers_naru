// ChatHub - Chatwork Content Script
(function() {
  const TOOL_ID = 'chatwork';
  let lastCount = 0;

  function countUnread() {
    let total = 0;

    // Method 1: Badge counts in room list
    const badges = document.querySelectorAll(
      '.sc-dnqmqq, [data-testid="unread-badge"], .roomListItem__unreadBadge, ._unreadBadge'
    );
    badges.forEach(badge => {
      const num = parseInt(badge.textContent?.trim(), 10);
      if (!isNaN(num)) total += num;
    });

    // Method 2: Title unread count
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
  console.log('[ChatHub] Chatwork observer started');
})();
