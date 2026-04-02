#!/usr/bin/env python3
"""Walkers Dashboard — Python stdlib HTTP Server
OpenClaw-style zero-dependency local dashboard server.
"""
import http.server
import json
import os
import pathlib
import re
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import mimetypes
import ssl
from datetime import datetime

# SSL context for Google API calls
try:
    import certifi
    _ssl_ctx = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _ssl_ctx = ssl.create_default_context()
    _ssl_ctx.check_hostname = False
    _ssl_ctx.verify_mode = ssl.CERT_NONE

# === Globals ===
DASHBOARD_DIR = pathlib.Path(__file__).parent.resolve()
WALKERS_ROOT = None
CONFIG = {}
_refresh_lock = threading.Lock()
_last_refresh = 0


def load_config():
    config_path = DASHBOARD_DIR / 'config.json'
    if config_path.exists():
        return json.loads(config_path.read_text(encoding='utf-8'))
    return {}


def resolve_safe(relative_path):
    """Resolve a path within WALKERS_ROOT, preventing directory traversal."""
    root = WALKERS_ROOT.resolve()
    target = (root / relative_path).resolve()
    if not str(target).startswith(str(root)):
        return None
    return target


def run_refresh():
    """Run refresh.sh with debounce."""
    global _last_refresh
    debounce = CONFIG.get('refresh_debounce_sec', 30)
    with _refresh_lock:
        now = time.time()
        if now - _last_refresh < debounce:
            return
        _last_refresh = now
        try:
            subprocess.run(
                ['bash', str(DASHBOARD_DIR / 'refresh.sh')],
                cwd=str(WALKERS_ROOT),
                capture_output=True,
                timeout=15
            )
        except Exception as e:
            print(f'refresh error: {e}', file=sys.stderr)


# === Memory path mapping ===
MEMORY_PATHS = {
    'facts': '00_context/memories/facts.md',
    'decisions': '00_context/memories/decisions.md',
    'preferences': '00_context/memories/preferences.md',
}

def _find_auto_memory():
    """Dynamically find MEMORY.md in .claude/projects/*/memory/."""
    projects_dir = WALKERS_ROOT / '.claude' / 'projects' if WALKERS_ROOT else None
    if projects_dir and projects_dir.is_dir():
        for d in projects_dir.iterdir():
            mem = d / 'memory' / 'MEMORY.md'
            if mem.exists():
                return str(mem.relative_to(WALKERS_ROOT))
    return None


# === Google Sheets Sync ===

class SheetsSync:
    """Google Sheets をスキルレジストリの同期バックエンドとして使用。
    mcp-google の OAuth トークンを再利用し、urllib のみで API を叩く。
    """

    HEADERS = ['id', 'name', 'description', 'content', 'creator',
               'category', 'triggers', 'phases', 'lines', 'publishedAt']
    SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
    TOKEN_URL = 'https://oauth2.googleapis.com/token'

    def __init__(self, spreadsheet_id, mcp_google_dir, cache_ttl=60):
        self.spreadsheet_id = spreadsheet_id or ''
        self.token_path = os.path.join(mcp_google_dir, 'token.json')
        self.creds_path = os.path.join(mcp_google_dir, 'credentials.json')
        self._cache = None
        self._cache_time = 0
        self.cache_ttl = cache_ttl
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=_ssl_ctx)
        )

    @property
    def available(self):
        """Sheets 同期が利用可能か"""
        return bool(
            self.spreadsheet_id
            and os.path.exists(self.token_path)
            and os.path.exists(self.creds_path)
        )

    def _get_token(self):
        """token.json を読み、期限切れなら refresh して返す。"""
        with open(self.token_path, 'r', encoding='utf-8') as f:
            td = json.load(f)
        with open(self.creds_path, 'r', encoding='utf-8') as f:
            creds = json.load(f)

        created = td.get('created_at', 0)
        expires_in = td.get('expires_in', 3599)
        now_ms = int(time.time() * 1000)

        if (created + expires_in * 1000) < now_ms:
            # Token expired — refresh
            data = urllib.parse.urlencode({
                'client_id': creds['client_id'],
                'client_secret': creds['client_secret'],
                'refresh_token': td['refresh_token'],
                'grant_type': 'refresh_token',
            }).encode()
            req = urllib.request.Request(self.TOKEN_URL, data=data)
            resp = self._opener.open(req, timeout=10)
            new = json.loads(resp.read())
            td['access_token'] = new['access_token']
            td['expires_in'] = new.get('expires_in', 3599)
            td['created_at'] = int(time.time() * 1000)
            with open(self.token_path, 'w', encoding='utf-8') as f:
                json.dump(td, f, indent=2)

        return td['access_token']

    def _api(self, method, url, body=None):
        """Google API への HTTP リクエスト。JSON を返す。"""
        token = self._get_token()
        headers = {'Authorization': f'Bearer {token}'}
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode('utf-8')
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        resp = self._opener.open(req, timeout=15)
        return json.loads(resp.read())

    def read_all(self):
        """Sheets から全スキルを取得（キャッシュ付き）。"""
        now = time.time()
        if self._cache is not None and (now - self._cache_time) < self.cache_ttl:
            return self._cache

        url = f'{self.SHEETS_API}/{self.spreadsheet_id}/values/registry!A:J'
        result = self._api('GET', url)
        rows = result.get('values', [])

        skills = []
        if len(rows) > 1:
            hdrs = rows[0]
            for row in rows[1:]:
                skill = {}
                for i, h in enumerate(hdrs):
                    skill[h] = row[i] if i < len(row) else ''
                # 数値フィールドを変換
                try:
                    skill['phases'] = int(skill.get('phases', 0) or 0)
                except (ValueError, TypeError):
                    skill['phases'] = 0
                try:
                    skill['lines'] = int(skill.get('lines', 0) or 0)
                except (ValueError, TypeError):
                    skill['lines'] = 0
                skills.append(skill)

        registry = {'version': '1.0.0', 'skills': skills}
        self._cache = registry
        self._cache_time = now
        return registry

    def _find_row(self, predicate):
        """条件に合う行番号（1-indexed）を返す。見つからなければ None。"""
        registry = self.read_all()
        for i, s in enumerate(registry['skills']):
            if predicate(s):
                return i + 2  # +1 for header, +1 for 1-indexed
        return None

    def append_skill(self, entry):
        """スキルを追加。同名+同作成者があれば上書き。"""
        # 既存行を検索
        existing_row = self._find_row(
            lambda s: s.get('name') == entry['name'] and s.get('creator') == entry['creator']
        )
        row_values = [[str(entry.get(h, '')) for h in self.HEADERS]]

        if existing_row:
            # 既存行を更新
            range_str = f'registry!A{existing_row}:J{existing_row}'
            url = f'{self.SHEETS_API}/{self.spreadsheet_id}/values/{range_str}?valueInputOption=RAW'
            self._api('PUT', url, body={'values': row_values})
        else:
            # 新規行を追加
            url = (f'{self.SHEETS_API}/{self.spreadsheet_id}/values/'
                   f'registry!A:J:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS')
            self._api('POST', url, body={'values': row_values})

        self._cache = None  # キャッシュ無効化

    def remove_skill(self, skill_id):
        """スキルを行ごと削除。"""
        row_index = self._find_row(lambda s: s.get('id') == skill_id)
        if not row_index:
            return

        # batchUpdate で行削除
        url = f'{self.SHEETS_API}/{self.spreadsheet_id}:batchUpdate'
        self._api('POST', url, body={
            'requests': [{
                'deleteDimension': {
                    'range': {
                        'sheetId': 0,
                        'dimension': 'ROWS',
                        'startIndex': row_index - 1,
                        'endIndex': row_index,
                    }
                }
            }]
        })
        self._cache = None  # キャッシュ無効化


sheets_sync = None  # main() で初期化


def init_sheets_sync():
    """SheetsSync インスタンスを生成。"""
    global sheets_sync
    sheet_id = CONFIG.get('skillhub_sheet_id', '')
    mcp_dir = os.path.join(str(WALKERS_ROOT), '05_development', 'mcp-google')
    cache_ttl = CONFIG.get('skillhub_cache_ttl', 60)
    sheets_sync = SheetsSync(sheet_id, mcp_dir, cache_ttl)
    if sheets_sync.available:
        print(f'[SkillHub] Google Sheets sync enabled (sheet: {sheet_id[:16]}...)')
    else:
        print('[SkillHub] Google Sheets sync not available — using local registry')


class WalkersHandler(http.server.BaseHTTPRequestHandler):
    """HTTP request handler for Walkers Dashboard."""

    def log_message(self, format, *args):
        # Quieter logging
        if '/api/' in str(args[0]) if args else False:
            return
        super().log_message(format, *args)

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status, message):
        self.send_json({'error': message}, status)

    def read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        return self.rfile.read(length).decode('utf-8')

    # === Routing ===

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == '/' or path == '/index.html':
            self.serve_file(DASHBOARD_DIR / 'index.html', 'text/html')
        elif path == '/themes.json':
            self.serve_file(DASHBOARD_DIR / 'themes.json', 'application/json')
        elif path == '/api/data':
            self.handle_data()
        elif path.startswith('/api/skill/'):
            name = urllib.parse.unquote(path[len('/api/skill/'):])
            self.handle_skill_read(name)
        elif path.startswith('/api/memory/'):
            key = urllib.parse.unquote(path[len('/api/memory/'):])
            self.handle_memory_read(key)
        elif path == '/api/skillhub':
            self.handle_skillhub()
        elif path == '/api/pipeline':
            self.handle_pipeline()
        elif path == '/api/projects':
            self.handle_projects()
        elif path == '/api/outputs':
            self.handle_outputs()
        elif path == '/api/settings':
            self.handle_settings()
        else:
            # SPA fallback
            self.serve_file(DASHBOARD_DIR / 'index.html', 'text/html')

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path.startswith('/api/skill/'):
            name = urllib.parse.unquote(path[len('/api/skill/'):])
            self.handle_skill_write(name)
        elif path.startswith('/api/memory/'):
            key = urllib.parse.unquote(path[len('/api/memory/'):])
            self.handle_memory_write(key)
        else:
            self.send_error_json(404, 'Not found')

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == '/api/refresh':
            self.handle_refresh()
        elif path == '/api/skillhub/publish':
            self.handle_skillhub_publish()
        elif path == '/api/skillhub/unpublish':
            self.handle_skillhub_unpublish()
        elif path == '/api/skillhub/install':
            self.handle_skillhub_install()
        else:
            self.send_error_json(404, 'Not found')

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    # === Handlers ===

    def serve_file(self, filepath, content_type=None):
        if not filepath.exists():
            self.send_error_json(404, 'File not found')
            return
        data = filepath.read_bytes()
        if not content_type:
            content_type = mimetypes.guess_type(str(filepath))[0] or 'application/octet-stream'
        self.send_response(200)
        self.send_header('Content-Type', content_type + '; charset=utf-8')
        self.send_header('Content-Length', len(data))
        self.end_headers()
        self.wfile.write(data)

    def handle_data(self):
        data_path = DASHBOARD_DIR / 'data.json'
        if not data_path.exists():
            run_refresh()
        if data_path.exists():
            self.serve_file(data_path, 'application/json')
        else:
            self.send_error_json(500, 'data.json not found')

    def handle_skill_read(self, name):
        # Sanitize name
        name = re.sub(r'[^a-zA-Z0-9_\-]', '', name)
        path = resolve_safe(f'.claude/commands/{name}.md')
        if not path or not path.exists():
            self.send_error_json(404, f'Skill not found: {name}')
            return
        content = path.read_text(encoding='utf-8')
        self.send_json({'name': name, 'content': content})

    def handle_skill_write(self, name):
        if CONFIG.get('read_only'):
            self.send_error_json(403, 'Read-only mode')
            return
        name = re.sub(r'[^a-zA-Z0-9_\-]', '', name)
        path = resolve_safe(f'.claude/commands/{name}.md')
        if not path:
            self.send_error_json(400, 'Invalid path')
            return
        body = self.read_body()
        data = json.loads(body)
        content = data.get('content', '')
        # Backup
        if path.exists():
            backup = path.with_suffix('.md.bak')
            backup.write_text(path.read_text(encoding='utf-8'), encoding='utf-8')
        path.write_text(content, encoding='utf-8')
        self.send_json({'ok': True, 'name': name})

    def handle_memory_read(self, key):
        rel_path = MEMORY_PATHS.get(key) or (key == 'auto_memory' and _find_auto_memory())
        if not rel_path:
            self.send_error_json(404, f'Unknown memory key: {key}')
            return
        path = resolve_safe(rel_path)
        if not path or not path.exists():
            self.send_error_json(404, f'Memory file not found: {key}')
            return
        content = path.read_text(encoding='utf-8')
        self.send_json({'key': key, 'content': content})

    def handle_memory_write(self, key):
        if CONFIG.get('read_only'):
            self.send_error_json(403, 'Read-only mode')
            return
        rel_path = MEMORY_PATHS.get(key) or (key == 'auto_memory' and _find_auto_memory())
        if not rel_path:
            self.send_error_json(404, f'Unknown memory key: {key}')
            return
        path = resolve_safe(rel_path)
        if not path:
            self.send_error_json(400, 'Invalid path')
            return
        body = self.read_body()
        data = json.loads(body)
        content = data.get('content', '')
        # Backup
        if path.exists():
            backup = path.with_suffix('.md.bak')
            backup.write_text(path.read_text(encoding='utf-8'), encoding='utf-8')
        path.write_text(content, encoding='utf-8')
        self.send_json({'ok': True, 'key': key})

    def handle_pipeline(self):
        path = resolve_safe('04_sales/pipeline.md')
        if not path or not path.exists():
            self.send_error_json(404, 'pipeline.md not found')
            return
        content = path.read_text(encoding='utf-8')
        self.send_json({'raw': content})

    def handle_projects(self):
        proj_dir = resolve_safe('03_projects')
        if not proj_dir or not proj_dir.exists():
            self.send_json([])
            return
        projects = []
        for d in sorted(proj_dir.iterdir()):
            if d.is_dir() and d.name != 'templates':
                files = [str(f.relative_to(d)) for f in sorted(d.rglob('*')) if f.is_file()]
                projects.append({
                    'name': d.name,
                    'files': files,
                    'fileCount': len(files)
                })
        self.send_json(projects)

    def handle_outputs(self):
        gui_dir = resolve_safe('output/gui')
        if not gui_dir or not gui_dir.exists():
            self.send_json([])
            return
        outputs = []
        for f in sorted(gui_dir.glob('*.html')):
            outputs.append({
                'name': f.name,
                'size': f.stat().st_size
            })
        self.send_json(outputs)

    def handle_settings(self):
        data_path = DASHBOARD_DIR / 'data.json'
        if data_path.exists():
            data = json.loads(data_path.read_text(encoding='utf-8'))
            self.send_json(data.get('settings', {}))
        else:
            self.send_json({})

    def _get_registry_path(self):
        return os.path.join(WALKERS_ROOT, '05_development', 'walkers-marketplace', 'skill-registry.json')

    def _read_registry(self):
        path = self._get_registry_path()
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                pass
        return {'version': '1.0.0', 'skills': []}

    def _write_registry(self, data):
        path = self._get_registry_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def handle_skillhub(self):
        """Return published skills from shared registry (Sheets優先)."""
        sync_mode = 'local'
        registry = None

        if sheets_sync and sheets_sync.available:
            try:
                registry = sheets_sync.read_all()
                sync_mode = 'sheets'
                # ローカルキャッシュに書き出す
                self._write_registry(registry)
            except Exception as e:
                print(f'[SkillHub] Sheets read failed, fallback to local: {e}', file=sys.stderr)

        if registry is None:
            registry = self._read_registry()

        # インストール済みスキル一覧
        installed = []
        commands_dir = os.path.join(WALKERS_ROOT, '.claude', 'commands')
        if os.path.isdir(commands_dir):
            installed = [f.replace('.md', '') for f in os.listdir(commands_dir) if f.endswith('.md')]
        registry['installed'] = installed
        registry['sync_mode'] = sync_mode
        self.send_json(registry)

    def handle_skillhub_publish(self):
        """Publish a skill to the shared registry (Sheets優先)."""
        if CONFIG.get('read_only'):
            self.send_error_json(403, 'Read-only mode')
            return
        body = self.read_body()
        data = json.loads(body)
        name = data.get('name', '')
        content = data.get('content', '')
        creator = data.get('creator', '')
        description = data.get('description', '')
        triggers = data.get('triggers', '')
        category = data.get('category', 'system')

        if not name or not content or not creator:
            self.send_error_json(400, 'name, content, creator are required')
            return

        skill_id = f"{name}_{creator}_{int(time.time())}"
        phases = len(re.findall(r'^##\s+', content, re.MULTILINE))
        lines = len(content.split('\n'))

        entry = {
            'id': skill_id,
            'name': name,
            'description': description,
            'content': content,
            'creator': creator,
            'category': category,
            'triggers': triggers,
            'phases': phases,
            'lines': lines,
            'publishedAt': datetime.now().isoformat(timespec='seconds')
        }

        published_to_sheets = False
        if sheets_sync and sheets_sync.available:
            try:
                sheets_sync.append_skill(entry)
                published_to_sheets = True
            except Exception as e:
                print(f'[SkillHub] Sheets publish failed, fallback to local: {e}', file=sys.stderr)

        # ローカルにも書く（キャッシュ or フォールバック）
        registry = self._read_registry()
        registry['skills'] = [s for s in registry['skills']
                              if not (s.get('name') == name and s.get('creator') == creator)]
        registry['skills'].append(entry)
        self._write_registry(registry)

        self.send_json({'ok': True, 'id': skill_id, 'synced': published_to_sheets})

    def handle_skillhub_unpublish(self):
        """Remove a skill from the shared registry (Sheets優先)."""
        if CONFIG.get('read_only'):
            self.send_error_json(403, 'Read-only mode')
            return
        body = self.read_body()
        data = json.loads(body)
        skill_id = data.get('id', '')
        if not skill_id:
            self.send_error_json(400, 'id is required')
            return

        removed_from_sheets = False
        if sheets_sync and sheets_sync.available:
            try:
                sheets_sync.remove_skill(skill_id)
                removed_from_sheets = True
            except Exception as e:
                print(f'[SkillHub] Sheets unpublish failed, fallback to local: {e}', file=sys.stderr)

        # ローカルからも削除
        registry = self._read_registry()
        registry['skills'] = [s for s in registry['skills'] if s.get('id') != skill_id]
        self._write_registry(registry)

        self.send_json({'ok': True, 'synced': removed_from_sheets})

    def handle_skillhub_install(self):
        """Install a skill from registry to local .claude/commands/."""
        if CONFIG.get('read_only'):
            self.send_error_json(403, 'Read-only mode')
            return
        body = self.read_body()
        data = json.loads(body)
        name = data.get('name', '')
        content = data.get('content', '')
        if not name or not content:
            self.send_error_json(400, 'name and content are required')
            return
        # Write to .claude/commands/{name}.md
        commands_dir = os.path.join(WALKERS_ROOT, '.claude', 'commands')
        os.makedirs(commands_dir, exist_ok=True)
        filepath = os.path.join(commands_dir, f'{name}.md')
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        self.send_json({'ok': True, 'path': filepath})

    def handle_refresh(self):
        run_refresh()
        data_path = DASHBOARD_DIR / 'data.json'
        if data_path.exists():
            data = json.loads(data_path.read_text(encoding='utf-8'))
            self.send_json({'ok': True, 'refreshedAt': data.get('_meta', {}).get('refreshedAt')})
        else:
            self.send_error_json(500, 'Refresh failed')


def main():
    global WALKERS_ROOT, CONFIG
    CONFIG = load_config()
    host = os.environ.get('WALKERS_HOST', CONFIG.get('host', '127.0.0.1'))
    port = int(os.environ.get('WALKERS_PORT', CONFIG.get('port', 8080)))
    WALKERS_ROOT = (DASHBOARD_DIR / CONFIG.get('walkers_root', '../..')).resolve()

    print(f'Walkers Dashboard v1.0.0')
    print(f'Data root: {WALKERS_ROOT}')

    # Sheets sync 初期化
    init_sheets_sync()

    print(f'Starting initial data refresh...')

    # Initial refresh
    run_refresh()

    server = http.server.HTTPServer((host, port), WalkersHandler)
    print(f'Dashboard: http://{host}:{port}')
    print(f'Press Ctrl+C to stop')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nShutting down...')
        server.shutdown()


if __name__ == '__main__':
    main()
