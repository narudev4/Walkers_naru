// ChatHub - Gmail Content Script
(function() {
  let lastCount = 0;

  function getToolId() {
    // Detect which Gmail account based on URL
    const url = window.location.href;
    if (url.includes('/mail/u/1/') || url.includes('/mail/u/1#')) return 'gmail-work';
    return 'gmail-personal';
  }

  function countUnread() {
    // Method 1: Inbox link unread count
    const inboxLinks = document.querySelectorAll(
      '.aim [href*="#inbox"] .bsU, a[title*="受信トレイ"] .bsU, a[title*="Inbox"] .bsU'
    );
    for (const el of inboxLinks) {
      const num = parseInt(el.textContent?.trim(), 10);
      if (!isNaN(num)) return num;
    }

    // Method 2: Title unread count
    const match = document.title.match(/\((\d+)\)/);
    if (match) return parseInt(match[1], 10);

    // Method 3: Unread indicator in inbox
    const unreadRows = document.querySelectorAll('tr.zE');
    return unreadRows.length;
  }

  function report(count) {
    const toolId = getToolId();
    if (count !== lastCount) {
      lastCount = count;
      chrome.runtime.sendMessage({
        type: 'UNREAD_COUNT',
        toolId,
        count
      }).catch(() => {});
    }
  }

  const observer = new MutationObserver(() => report(countUnread()));
  setTimeout(() => {
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true
    });
    report(countUnread());
  }, 5000); // Gmail loads slowly

  setInterval(() => report(countUnread()), 15000);
  console.log('[ChatHub] Gmail observer started');
})();
