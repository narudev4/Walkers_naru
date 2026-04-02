// ChatHub - Slack Content Script
(function() {
  const TOOL_ID = 'slack';
  let lastCount = 0;

  function countUnread() {
    let total = 0;

    // Method 1: Sidebar unread badges
    const badges = document.querySelectorAll(
      '.p-channel_sidebar__badge, [data-qa="channel_sidebar_badge"], .c-mention_badge'
    );
    badges.forEach(badge => {
      const num = parseInt(badge.textContent?.trim(), 10);
      if (!isNaN(num)) total += num;
    });

    // Method 2: Title bar unread indicator
    if (total === 0) {
      const title = document.title;
      const match = title.match(/^\*?\s*\((\d+)\)/);
      if (match) total = parseInt(match[1], 10);
      else if (title.startsWith('*')) total = 1;
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

  // Observe
  const observer = new MutationObserver(() => report(countUnread()));
  setTimeout(() => {
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true, attributes: true
    });
    report(countUnread());
  }, 3000);

  setInterval(() => report(countUnread()), 10000);
  console.log('[ChatHub] Slack observer started');
})();
