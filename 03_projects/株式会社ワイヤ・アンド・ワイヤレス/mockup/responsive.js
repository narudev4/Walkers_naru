(function() {
  var sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  var header = document.querySelector('.header');
  if (!header) return;

  var btn = document.createElement('button');
  btn.className = 'mobile-menu-toggle';
  btn.setAttribute('aria-label', 'メニュー');
  btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 5h14M3 10h14M3 15h14"/></svg>';
  header.insertBefore(btn, header.firstChild);

  var overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  document.body.appendChild(overlay);

  btn.addEventListener('click', function() {
    document.body.classList.toggle('sidebar-open');
  });
  overlay.addEventListener('click', function() {
    document.body.classList.remove('sidebar-open');
  });

  sidebar.querySelectorAll('.sidebar-link').forEach(function(link) {
    link.addEventListener('click', function() {
      document.body.classList.remove('sidebar-open');
    });
  });
})();
