// ChatHub - Microsoft Teams Content Script
(function() {
  const TOOL_ID = 'teams';
  let lastCount = 0;

  function countUnread() {
    let total = 0;

    // Teams unread badges
    const badges = document.querySelectorAll(
      '.activity-badge, [data-tid="unread-count"], [class*="unread-count"], .fui-Badge'
    );
    badges.forEach(badge => {
      const num = parseInt(badge.textContent?.trim(), 10);
      if (!isNaN(num) && num > 0) total += num;
    });

    // Teams activity indicator dots
    if (total === 0) {
      const dots = document.querySelectorAll(
        '[class*="activity-dot"], [data-tid="chat-unread-indicator"]'
      );
      total = dots.length;
    }

    // Title check
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
  }, 5000); // Teams loads slowly

  setInterval(() => report(countUnread()), 10000);
  console.log('[ChatHub] Teams observer started');
})();
