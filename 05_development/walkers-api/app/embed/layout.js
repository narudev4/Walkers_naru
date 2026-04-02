export const metadata = { title: 'Walkers Embed' }

export default function EmbedLayout({ children }) {
  return (
    <html lang="ja">
      <head>
        <style dangerouslySetInnerHTML={{ __html: `
          :root {
            --bg: #0f172a;
            --bg-surface: #1e293b;
            --bg-card: #1e293b;
            --bg-card-hover: #263548;
            --bg-input: #0f172a;
            --border: #334155;
            --border-focus: #3b82f6;
            --text: #e2e8f0;
            --text-muted: #94a3b8;
            --text-heading: #f1f5f9;
            --accent: #3b82f6;
            --accent-hover: #2563eb;
            --success: #22c55e;
            --warning: #f59e0b;
            --danger: #ef4444;
            --info: #3b82f6;
          }
          *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
          body {
            font-family: -apple-system, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif;
            background: var(--bg);
            color: var(--text);
            line-height: 1.6;
            padding: 24px;
          }
          .panel-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:24px; flex-wrap:wrap; gap:12px; }
          .panel-header h2 { font-size:20px; font-weight:700; color:var(--text-heading); margin:0; }
          .btn { display:inline-flex; align-items:center; gap:6px; padding:6px 16px; font-size:13px; font-weight:500; border:1px solid var(--border); border-radius:6px; background:var(--bg-surface); color:var(--text); cursor:pointer; transition:all 0.15s; }
          .btn:hover { background:var(--bg-card-hover); }
          .btn-primary { background:var(--accent); border-color:var(--accent); color:#fff; }
          .btn-primary:hover { background:var(--accent-hover); }
          .metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:24px; }
          .metric-card { padding:20px; text-align:center; background:var(--bg-card); border:1px solid var(--border); border-radius:8px; }
          .metric-value { font-size:32px; font-weight:700; color:var(--text-heading); }
          .metric-label { font-size:12px; color:var(--text-muted); margin-top:4px; }
          .filter-bar { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; }
          .filter-btn { padding:6px 14px; border-radius:20px; border:1px solid var(--border); background:transparent; color:var(--text); cursor:pointer; font-size:13px; transition:all 0.2s; }
          .filter-btn.active { background:var(--accent); border-color:var(--accent); color:#fff; }
          .search-input { padding:8px 12px; font-size:13px; width:100%; background:var(--bg-input); color:var(--text); border:1px solid var(--border); border-radius:6px; outline:none; margin-bottom:16px; box-sizing:border-box; }
          .search-input:focus { border-color:var(--border-focus); }
          .empty-state { text-align:center; padding:60px 20px; color:var(--text-muted); }
          .empty-state-icon { font-size:48px; margin-bottom:12px; opacity:0.5; }
          .empty-state-msg { font-size:14px; }
          .gallery-table { width:100%; border-collapse:collapse; font-size:13px; }
          .gallery-table th { text-align:left; padding:10px 12px; font-size:12px; font-weight:600; color:var(--text-muted); border-bottom:1px solid var(--border); background:var(--bg-card); }
          .gallery-table td { padding:10px 12px; border-bottom:1px solid var(--border); color:var(--text); vertical-align:middle; }
          .gallery-table tr { cursor:pointer; transition:background .15s; }
          .gallery-table tbody tr:hover { background:rgba(255,255,255,.04); }
          .gallery-table .creator-cell { display:flex; align-items:center; gap:6px; }
          .gallery-table .creator-avatar { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; background:var(--accent); color:#fff; font-size:11px; font-weight:700; flex-shrink:0; }
          .type-badge { display:inline-flex; padding:2px 8px; font-size:10px; font-weight:600; border-radius:9999px; }
          .tech-tag { display:inline-flex; padding:1px 6px; font-size:10px; border-radius:4px; background:rgba(59,130,246,0.15); color:var(--accent); margin:2px; }
          .card { background:var(--bg-card); border:1px solid var(--border); border-radius:8px; }
          .toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%) translateY(20px); padding:10px 24px; border-radius:8px; font-size:13px; font-weight:500; opacity:0; transition:all 0.3s; z-index:300; pointer-events:none; }
          .toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
          .toast-success { background:var(--success); color:#fff; }
          .toast-error { background:var(--danger); color:#fff; }
          .modal { position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:200; display:none; align-items:center; justify-content:center; padding:24px; }
          .modal-content { background:var(--bg-surface); border:1px solid var(--border); border-radius:12px; padding:24px; max-width:600px; width:100%; }
          .form-group { margin-bottom:16px; }
          .form-group label { display:block; font-size:13px; font-weight:500; color:var(--text-heading); margin-bottom:6px; }
          .form-group input, .form-group select, .form-group textarea { width:100%; padding:8px 12px; background:var(--bg-input); color:var(--text); border:1px solid var(--border); border-radius:6px; font-size:13px; box-sizing:border-box; }
          .form-group textarea { min-height:80px; resize:vertical; }
          @media (max-width:768px) {
            body { padding:12px; }
            .panel-header { flex-direction:column; align-items:flex-start; }
          }
        `}} />
      </head>
      <body>{children}</body>
    </html>
  )
}
