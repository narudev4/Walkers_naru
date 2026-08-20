#!/usr/bin/env python3
"""Claude Session Hub backend.

Indexes Claude Code JSONL sessions into a local SQLite database and exposes
helpers for quick `claude -p --resume` runs plus tmux-backed live sessions.
"""

from __future__ import annotations

import json
import os
import pathlib
import re
import shlex
import shutil
import sqlite3
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone


UUID_RE = re.compile(r'^[0-9a-fA-F-]{8,64}$')


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def iso_from_mtime(mtime: float) -> str:
    return datetime.fromtimestamp(mtime, timezone.utc).isoformat(timespec='seconds')


def clip(text: str, limit: int = 500) -> str:
    text = clean_text(text)
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + '...'


def clean_text(text: str | None) -> str:
    if not text:
        return ''
    text = str(text).replace('\r\n', '\n').replace('\r', '\n')
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def quick_run_command(session_id: str, prompt: str) -> list[str]:
    """Build the non-interactive Claude command used by Quick Run."""
    return [
        'claude',
        '--resume',
        session_id,
        '--permission-mode',
        'auto',
        '--output-format',
        'stream-json',
        '--verbose',
        '-p',
        prompt,
    ]


def diagnose_quick_run_failure(raw: str = '', output: str = '', error: str = '', returncode: int | None = None) -> dict:
    text = '\n'.join(part for part in (raw, output, error) if part)
    lower = text.lower()
    if '--output-format=stream-json requires --verbose' in text or 'requires --verbose' in lower:
        return {
            'kind': 'missing_verbose',
            'summary': 'Claude CLI の -p + stream-json 実行には --verbose が必要です。',
            'nextAction': 'Hub側のQuick Runコマンドに --verbose を付けて再実行してください。',
        }
    if 'authentication_failed' in lower or 'not logged in' in lower or 'please run /login' in lower:
        return {
            'kind': 'authentication',
            'summary': 'Claude CLI が非対話実行でログイン状態を確認できていません。',
            'nextAction': 'Live Modeを開いて /login を実行するか、非対話実行で使える認証を設定してください。',
        }
    if returncode not in (None, 0):
        return {
            'kind': 'exit_code',
            'summary': f'Claude CLI が終了コード {returncode} で停止しました。',
            'nextAction': '出力ログの末尾を確認し、必要ならLive Modeで同じセッションを開いて続行してください。',
        }
    return {
        'kind': 'none',
        'summary': '',
        'nextAction': '',
    }


def _brief_item(text: str, limit: int = 180) -> str:
    text = clean_text(re.sub(r'<[^>]+>', ' ', text or ''))
    text = re.sub(r'\s+', ' ', text)
    return clip(text, limit)


def _interesting_lines(text: str, keywords: tuple[str, ...], limit: int = 4) -> list[str]:
    items: list[str] = []
    for raw_line in clean_text(text).splitlines():
        line = _brief_item(raw_line, 220)
        if not line:
            continue
        if any(word.lower() in line.lower() for word in keywords):
            items.append(line)
        if len(items) >= limit:
            break
    return items


def build_resume_brief(session: dict, messages: list[dict], suggestions: list[str] | None = None) -> dict:
    """Create an extractive resume brief without editing Claude history."""
    suggestions = suggestions or []
    project_name = session.get('projectName') or '未分類'
    title = session.get('title') or session.get('sessionId') or ''
    first_user = next((m for m in messages if m.get('role') == 'user' and m.get('text')), None)
    last_user = next((m for m in reversed(messages) if m.get('role') == 'user' and m.get('text')), None)
    last_assistant = next((m for m in reversed(messages) if m.get('role') == 'assistant' and m.get('text')), None)

    past = _brief_item((first_user or {}).get('text') or session.get('firstPrompt') or title, 260)
    now_source = session.get('taskText') or session.get('lastAssistant') or session.get('lastUser') or ''
    now = _brief_item(now_source, 260)

    constraint_keywords = ('決定', '合意', '必ず', '禁止', '制約', '前提', 'ルール', 'CRITICAL', '注意')
    action_keywords = ('TODO', '次', '未完了', '残', '確認', '実行', '修正', '検証', '必要')
    constraints: list[str] = []
    next_actions: list[str] = []
    for message in messages:
        text = message.get('text') or ''
        constraints.extend(_interesting_lines(text, constraint_keywords, limit=2))
        next_actions.extend(_interesting_lines(text, action_keywords, limit=2))
        constraints = list(dict.fromkeys(constraints))[:8]
        next_actions = list(dict.fromkeys(next_actions))[:8]
        if len(constraints) >= 8 and len(next_actions) >= 8:
            break

    if session.get('taskText'):
        next_actions.insert(0, _brief_item(session['taskText'], 220))
    if suggestions:
        next_actions.append(_brief_item(suggestions[0], 220))
    next_actions = list(dict.fromkeys([item for item in next_actions if item]))[:8]

    timeline_source = []
    if messages:
        timeline_source.extend(messages[:2])
        timeline_source.extend(messages[-5:])
    seen = set()
    timeline = []
    for item in timeline_source:
        key = (item.get('role'), item.get('timestamp'), item.get('text'))
        if key in seen:
            continue
        seen.add(key)
        timeline.append({
            'role': item.get('role') or '',
            'timestamp': item.get('timestamp') or '',
            'text': _brief_item(item.get('text') or '', 180),
        })

    latest_user = _brief_item((last_user or {}).get('text') or session.get('lastUser') or '', 220)
    latest_assistant = _brief_item((last_assistant or {}).get('text') or session.get('lastAssistant') or '', 220)
    resume_lines = [
        'このセッションを再開します。',
        f'案件: {project_name}',
        f'テーマ: {_brief_item(title, 120)}',
        f'これまで: {past}',
        f'現在: {now}',
    ]
    if constraints:
        resume_lines.append('守ること: ' + ' / '.join(constraints[:3]))
    if next_actions:
        resume_lines.append('次にやること: ' + next_actions[0])
    if latest_user:
        resume_lines.append('直近ユーザー指示: ' + latest_user)
    if latest_assistant:
        resume_lines.append('直近Claude出力: ' + latest_assistant)
    resume_lines.append('上記を前提に、必要な確認は最小限にして次の1手を実行してください。')

    return {
        'projectName': project_name,
        'title': title,
        'past': past,
        'now': now,
        'constraints': constraints,
        'nextActions': next_actions,
        'timeline': timeline,
        'latestUser': latest_user,
        'latestAssistant': latest_assistant,
        'resumePrompt': '\n'.join(line for line in resume_lines if line.strip()),
    }


def message_text(message: dict | None, include_tool_results: bool = False) -> tuple[str, list[str]]:
    if not isinstance(message, dict):
        return '', []
    content = message.get('content')
    tools: list[str] = []
    chunks: list[str] = []

    if isinstance(content, str):
        return clean_text(content), tools

    if isinstance(content, list):
        for part in content:
            if isinstance(part, str):
                chunks.append(part)
                continue
            if not isinstance(part, dict):
                continue
            part_type = part.get('type')
            if part_type in ('text', 'input_text'):
                chunks.append(str(part.get('text') or part.get('content') or ''))
            elif part_type == 'tool_use':
                name = str(part.get('name') or '')
                if name:
                    tools.append(name)
            elif part_type == 'tool_result' and include_tool_results:
                val = part.get('content') or part.get('text') or ''
                chunks.append('[tool result] ' + clip(str(val), 800))
            elif part_type == 'document':
                title = part.get('title') or part.get('name') or ''
                if title:
                    chunks.append('[document] ' + str(title))

    return clean_text('\n'.join(chunks)), tools


class ClaudeSessionHub:
    def __init__(self, default_cwd: pathlib.Path):
        self.default_cwd = pathlib.Path(default_cwd).resolve()
        self.claude_home = pathlib.Path(os.environ.get('CLAUDE_HOME', pathlib.Path.home() / '.claude'))
        self.projects_dir = self.claude_home / 'projects'
        self.runtime_sessions_dir = self.claude_home / 'sessions'
        state_dir = pathlib.Path(os.environ.get('CLAUDE_SESSION_HUB_STATE', self.claude_home / 'session-hub'))
        state_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = pathlib.Path(os.environ.get('CLAUDE_SESSION_HUB_DB', state_dir / 'index.sqlite3'))
        self.tmux_session = os.environ.get('CLAUDE_SESSION_HUB_TMUX', 'claude-hub')
        self._index_lock = threading.Lock()
        self._index_thread: threading.Thread | None = None
        self._index_state = {
            'running': False,
            'startedAt': None,
            'finishedAt': None,
            'processed': 0,
            'changed': 0,
            'total': 0,
            'error': None,
        }
        self._runs: dict[str, dict] = {}
        self._runs_lock = threading.Lock()
        self._init_db()

    # === SQLite ===

    def _connect(self) -> sqlite3.Connection:
        con = sqlite3.connect(str(self.db_path), timeout=30)
        con.row_factory = sqlite3.Row
        return con

    def _init_db(self) -> None:
        with self._connect() as con:
            con.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS session_index (
                    session_id TEXT PRIMARY KEY,
                    path TEXT NOT NULL,
                    project_dir TEXT,
                    cwd TEXT,
                    title TEXT,
                    custom_title TEXT,
                    first_prompt TEXT,
                    last_prompt TEXT,
                    last_user TEXT,
                    last_assistant TEXT,
                    created_at TEXT,
                    updated_at TEXT,
                    git_branch TEXT,
                    is_sidechain INTEGER DEFAULT 0,
                    message_count INTEGER DEFAULT 0,
                    user_count INTEGER DEFAULT 0,
                    assistant_count INTEGER DEFAULT 0,
                    file_mtime REAL NOT NULL,
                    file_size INTEGER NOT NULL,
                    indexed_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS file_index (
                    path TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    file_mtime REAL NOT NULL,
                    file_size INTEGER NOT NULL,
                    indexed_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS session_meta (
                    session_id TEXT PRIMARY KEY,
                    status TEXT DEFAULT 'open',
                    priority TEXT DEFAULT 'normal',
                    note TEXT DEFAULT '',
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS tmux_targets (
                    session_id TEXT PRIMARY KEY,
                    target TEXT NOT NULL,
                    window_name TEXT NOT NULL,
                    cwd TEXT,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS run_history (
                    run_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    cwd TEXT,
                    prompt TEXT,
                    output TEXT DEFAULT '',
                    raw TEXT DEFAULT '',
                    error TEXT DEFAULT '',
                    diagnosis_json TEXT DEFAULT '{}',
                    returncode INTEGER,
                    mode TEXT DEFAULT 'quick',
                    command_preview TEXT DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_session_updated ON session_index(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_session_cwd ON session_index(cwd);
                CREATE INDEX IF NOT EXISTS idx_session_title ON session_index(title);
                CREATE INDEX IF NOT EXISTS idx_run_history_session ON run_history(session_id, started_at DESC);
                """
            )

    # === Indexing ===

    def refresh_index_background(self, force: bool = False) -> dict:
        if self._index_thread and self._index_thread.is_alive():
            return self.index_status()
        self._index_thread = threading.Thread(target=self.refresh_index, kwargs={'force': force}, daemon=True)
        self._index_thread.start()
        return self.index_status()

    def refresh_index(self, force: bool = False, limit_files: int | None = None) -> dict:
        with self._index_lock:
            files = sorted(self.projects_dir.glob('*/*.jsonl'), key=lambda p: p.stat().st_mtime, reverse=True)
            if limit_files:
                files = files[:limit_files]
            self._index_state.update({
                'running': True,
                'startedAt': now_iso(),
                'finishedAt': None,
                'processed': 0,
                'changed': 0,
                'total': len(files),
                'error': None,
            })
            try:
                with self._connect() as con:
                    for idx, path in enumerate(files, 1):
                        try:
                            st = path.stat()
                        except FileNotFoundError:
                            continue
                        existing = con.execute(
                            'SELECT file_mtime, file_size FROM file_index WHERE path = ?',
                            (str(path),),
                        ).fetchone()
                        if (
                            not force
                            and existing
                            and float(existing['file_mtime']) == float(st.st_mtime)
                            and int(existing['file_size']) == int(st.st_size)
                        ):
                            self._index_state['processed'] = idx
                            continue

                        parsed = self._parse_session_file(path, st)
                        if parsed:
                            self._upsert_session(con, parsed)
                            con.execute(
                                """
                                INSERT INTO file_index(path, session_id, file_mtime, file_size, indexed_at)
                                VALUES(?, ?, ?, ?, ?)
                                ON CONFLICT(path) DO UPDATE SET
                                  session_id=excluded.session_id,
                                  file_mtime=excluded.file_mtime,
                                  file_size=excluded.file_size,
                                  indexed_at=excluded.indexed_at
                                """,
                                (str(path), parsed['session_id'], st.st_mtime, st.st_size, now_iso()),
                            )
                            self._index_state['changed'] += 1
                        self._index_state['processed'] = idx
                        if idx % 100 == 0:
                            con.commit()
                    con.commit()
                self._index_state['finishedAt'] = now_iso()
            except Exception as exc:
                self._index_state['error'] = str(exc)
            finally:
                self._index_state['running'] = False
            return self.index_status()

    def _parse_session_file(self, path: pathlib.Path, st: os.stat_result) -> dict | None:
        session_id = path.stem
        project_dir = path.parent.name
        cwd = ''
        title = ''
        custom_title = ''
        first_prompt = ''
        last_prompt = ''
        last_user = ''
        last_assistant = ''
        created_at = ''
        updated_at = ''
        git_branch = ''
        is_sidechain = 0
        message_count = 0
        user_count = 0
        assistant_count = 0

        try:
            with path.open('r', encoding='utf-8', errors='replace') as fh:
                for line in fh:
                    try:
                        item = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    session_id = item.get('sessionId') or session_id
                    timestamp = item.get('timestamp') or ''
                    if timestamp:
                        created_at = created_at or timestamp
                        updated_at = timestamp
                    if item.get('cwd'):
                        cwd = item.get('cwd') or cwd
                    if item.get('gitBranch'):
                        git_branch = item.get('gitBranch') or git_branch
                    if item.get('isSidechain') is not None:
                        is_sidechain = 1 if item.get('isSidechain') else 0

                    item_type = item.get('type')
                    if item_type == 'custom-title':
                        custom_title = clean_text(item.get('customTitle') or custom_title)
                    elif item_type == 'last-prompt':
                        last_prompt = clean_text(item.get('lastPrompt') or last_prompt)
                    elif item_type == 'queue-operation' and item.get('operation') == 'enqueue':
                        prompt = clean_text(item.get('content') or '')
                        if prompt:
                            last_prompt = prompt
                            last_user = prompt
                            first_prompt = first_prompt or prompt
                    elif item_type in ('user', 'assistant'):
                        message_count += 1
                        text, _tools = message_text(item.get('message'))
                        if item_type == 'user':
                            user_count += 1
                            if text and not text.startswith('<local-command-caveat>'):
                                first_prompt = first_prompt or text
                                last_user = text
                        else:
                            assistant_count += 1
                            if text:
                                last_assistant = text
        except OSError:
            return None

        fallback_time = iso_from_mtime(st.st_mtime)
        created_at = created_at or fallback_time
        updated_at = updated_at or fallback_time
        title = custom_title or first_prompt or last_prompt or session_id

        return {
            'session_id': session_id,
            'path': str(path),
            'project_dir': project_dir,
            'cwd': cwd,
            'title': clip(title, 220),
            'custom_title': clip(custom_title, 220),
            'first_prompt': clip(first_prompt, 1200),
            'last_prompt': clip(last_prompt, 1200),
            'last_user': clip(last_user, 1200),
            'last_assistant': clip(last_assistant, 1600),
            'created_at': created_at,
            'updated_at': updated_at,
            'git_branch': git_branch,
            'is_sidechain': is_sidechain,
            'message_count': message_count,
            'user_count': user_count,
            'assistant_count': assistant_count,
            'file_mtime': st.st_mtime,
            'file_size': st.st_size,
            'indexed_at': now_iso(),
        }

    def _upsert_session(self, con: sqlite3.Connection, item: dict) -> None:
        con.execute(
            """
            INSERT INTO session_index(
              session_id, path, project_dir, cwd, title, custom_title, first_prompt,
              last_prompt, last_user, last_assistant, created_at, updated_at,
              git_branch, is_sidechain, message_count, user_count, assistant_count,
              file_mtime, file_size, indexed_at
            )
            VALUES(
              :session_id, :path, :project_dir, :cwd, :title, :custom_title,
              :first_prompt, :last_prompt, :last_user, :last_assistant,
              :created_at, :updated_at, :git_branch, :is_sidechain,
              :message_count, :user_count, :assistant_count, :file_mtime,
              :file_size, :indexed_at
            )
            ON CONFLICT(session_id) DO UPDATE SET
              path=excluded.path,
              project_dir=excluded.project_dir,
              cwd=excluded.cwd,
              title=excluded.title,
              custom_title=excluded.custom_title,
              first_prompt=excluded.first_prompt,
              last_prompt=excluded.last_prompt,
              last_user=excluded.last_user,
              last_assistant=excluded.last_assistant,
              created_at=excluded.created_at,
              updated_at=excluded.updated_at,
              git_branch=excluded.git_branch,
              is_sidechain=excluded.is_sidechain,
              message_count=excluded.message_count,
              user_count=excluded.user_count,
              assistant_count=excluded.assistant_count,
              file_mtime=excluded.file_mtime,
              file_size=excluded.file_size,
              indexed_at=excluded.indexed_at
            """,
            item,
        )

    def index_status(self) -> dict:
        with self._connect() as con:
            count = con.execute('SELECT COUNT(*) AS c FROM session_index').fetchone()['c']
            changed = con.execute('SELECT COUNT(*) AS c FROM file_index').fetchone()['c']
        data = dict(self._index_state)
        data['indexedSessions'] = count
        data['indexedFiles'] = changed
        data['dbPath'] = str(self.db_path)
        return data

    def _project_info(self, cwd: str | None, fallback: str = '') -> dict:
        cwd = cwd or ''
        projects_root = (self.default_cwd / '03_projects').resolve()
        if cwd:
            try:
                resolved = pathlib.Path(cwd).resolve()
                rel = resolved.relative_to(projects_root)
                if rel.parts:
                    name = rel.parts[0].strip() or rel.parts[0]
                    return {
                        'key': f'case:{name}',
                        'name': name,
                        'kind': 'case',
                    }
            except (ValueError, OSError):
                pass
            try:
                resolved = pathlib.Path(cwd).resolve()
                rel = resolved.relative_to(self.default_cwd)
                root_part = rel.parts[0] if rel.parts else self.default_cwd.name
                name = '開発' if root_part == '05_development' else root_part
                return {
                    'key': f'root:{root_part}',
                    'name': name,
                    'kind': 'workspace',
                }
            except (ValueError, OSError):
                pass
            return {
                'key': f'cwd:{cwd}',
                'name': pathlib.Path(cwd).name or cwd,
                'kind': 'external',
            }
        name = fallback or '未分類'
        return {'key': f'unknown:{name}', 'name': name, 'kind': 'unknown'}

    def _project_where(self, project_key: str) -> tuple[str, list]:
        if not project_key:
            return '', []
        kind, _, value = project_key.partition(':')
        if not value:
            return '(s.cwd LIKE ? OR s.project_dir LIKE ?)', [f'%{project_key}%', f'%{project_key}%']
        if kind == 'case':
            case_path = str((self.default_cwd / '03_projects' / value).resolve())
            return '(s.cwd = ? OR s.cwd LIKE ?)', [case_path, case_path + '/%']
        if kind == 'root':
            root_path = str((self.default_cwd / value).resolve())
            if value == self.default_cwd.name:
                root_path = str(self.default_cwd)
            return '(s.cwd = ? OR s.cwd LIKE ?)', [root_path, root_path + '/%']
        if kind == 'cwd':
            return '(s.cwd = ? OR s.cwd LIKE ?)', [value, value.rstrip('/') + '/%']
        return '(s.cwd LIKE ? OR s.project_dir LIKE ?)', [f'%{value}%', f'%{value}%']

    def _task_for_row(self, row: sqlite3.Row | dict) -> dict:
        get = row.get if isinstance(row, dict) else row.__getitem__
        status = get('status') or 'open'
        priority = get('priority') or 'normal'
        note = get('note') or ''
        title = get('title') or get('session_id') or ''
        last_user = get('last_user') or get('last_prompt') or get('first_prompt') or ''
        last_assistant = get('last_assistant') or ''
        project = self._project_info(get('cwd') or '', get('project_dir') or '')

        if status == 'done':
            task = '完了済み'
            urgency = 0
        elif note:
            task = note
            urgency = 4 if priority == 'high' else 3
        elif status == 'review':
            task = '確認: ' + (last_assistant or last_user or title)
            urgency = 4
        elif status == 'pending':
            task = '保留: ' + (last_user or last_assistant or title)
            urgency = 2
        elif any(word in last_assistant for word in ('確認', '必要', '未実施', '次', 'TODO', 'タスク')):
            task = last_assistant
            urgency = 3
        else:
            task = last_user or last_assistant or title
            urgency = 2 if priority == 'high' else 1

        return {
            'sessionId': get('session_id') if not isinstance(row, dict) else get('sessionId'),
            'projectKey': project['key'],
            'projectName': project['name'],
            'title': clip(title, 120),
            'task': clip(task, 220),
            'status': status,
            'priority': priority,
            'updatedAt': get('updated_at') if not isinstance(row, dict) else get('updatedAt'),
            'urgency': urgency,
        }

    def _projects_and_tasks(self, active: dict[str, dict]) -> tuple[list[dict], list[dict]]:
        with self._connect() as con:
            rows = con.execute(
                """
                SELECT s.*, COALESCE(m.status, 'open') AS status,
                       COALESCE(m.priority, 'normal') AS priority,
                       COALESCE(m.note, '') AS note
                FROM session_index s
                LEFT JOIN session_meta m ON m.session_id = s.session_id
                WHERE s.cwd IS NOT NULL AND s.cwd != ''
                ORDER BY s.updated_at DESC
                """
            ).fetchall()

        projects: dict[str, dict] = {}
        tasks: list[dict] = []
        active_ids = set(active.keys())
        for row in rows:
            project = self._project_info(row['cwd'], row['project_dir'])
            item = projects.setdefault(project['key'], {
                'key': project['key'],
                'name': project['name'],
                'kind': project['kind'],
                'count': 0,
                'activeCount': 0,
                'openCount': 0,
                'taskCount': 0,
                'latestAt': '',
            })
            item['count'] += 1
            if row['session_id'] in active_ids:
                item['activeCount'] += 1
            if row['status'] != 'done':
                item['openCount'] += 1
            task = self._task_for_row(row)
            is_actionable = (
                row['status'] in ('pending', 'review')
                or bool(row['note'])
                or row['session_id'] in active_ids
                or task['urgency'] >= 3
            )
            if is_actionable:
                if task['task'] and task['task'] != '完了済み':
                    tasks.append(task)
                    item['taskCount'] += 1
            if row['updated_at'] and row['updated_at'] > item['latestAt']:
                item['latestAt'] = row['updated_at']

        project_list = sorted(
            projects.values(),
            key=lambda p: (p['kind'] == 'case', p['activeCount'] > 0, p['taskCount'], p['latestAt']),
            reverse=True,
        )[:160]
        task_list = sorted(tasks, key=lambda t: (t['urgency'], t.get('updatedAt') or ''), reverse=True)[:40]
        return project_list, task_list

    # === Session reads ===

    def list_sessions(self, query: dict[str, list[str]]) -> dict:
        status = self._param(query, 'status', 'all')
        priority = self._param(query, 'priority', 'all')
        project = self._param(query, 'project', '')
        search = self._param(query, 'q', '')
        active_only = self._param(query, 'active', '') == '1'
        offset = max(0, self._int_param(query, 'offset', 0))
        limit = min(max(1, self._int_param(query, 'limit', 400)), 2000)

        if self.index_status()['indexedSessions'] == 0:
            self.refresh_index_background(force=False)

        active = self.runtime_sessions()
        active_ids = set(active.keys())

        where = []
        args: list = []
        if status and status != 'all':
            where.append("COALESCE(m.status, 'open') = ?")
            args.append(status)
        if priority and priority != 'all':
            where.append("COALESCE(m.priority, 'normal') = ?")
            args.append(priority)
        if project:
            project_clause, project_args = self._project_where(project)
            where.append(project_clause)
            args.extend(project_args)
        if search:
            like = f'%{search}%'
            where.append('(s.title LIKE ? OR s.cwd LIKE ? OR s.first_prompt LIKE ? OR s.last_user LIKE ? OR s.last_assistant LIKE ?)')
            args.extend([like, like, like, like, like])
        if active_only:
            if active_ids:
                where.append('s.session_id IN (%s)' % ','.join('?' for _ in active_ids))
                args.extend(sorted(active_ids))
            else:
                where.append('1 = 0')

        clause = 'WHERE ' + ' AND '.join(where) if where else ''
        sql_base = f"""
            FROM session_index s
            LEFT JOIN session_meta m ON m.session_id = s.session_id
            {clause}
        """
        with self._connect() as con:
            total = con.execute('SELECT COUNT(*) AS c ' + sql_base, args).fetchone()['c']
            rows = con.execute(
                """
                SELECT s.*, COALESCE(m.status, 'open') AS status,
                       COALESCE(m.priority, 'normal') AS priority,
                       COALESCE(m.note, '') AS note,
                       m.updated_at AS meta_updated_at
                """
                + sql_base
                + ' ORDER BY s.updated_at DESC, s.file_mtime DESC LIMIT ? OFFSET ?',
                args + [limit, offset],
            ).fetchall()

        items = [self._session_row_to_dict(row, active) for row in rows]
        if offset == 0 and (active_only or total == 0):
            indexed_ids = {item['sessionId'] for item in items}
            for runtime in active.values():
                if runtime['sessionId'] in indexed_ids:
                    continue
                row = self._get_session_row(runtime['sessionId'])
                if row:
                    items.insert(0, self._session_row_to_dict(row, active))
                else:
                    items.insert(0, self._runtime_only_session(runtime))
            if active_only or total == 0:
                total = max(total, len(items))
        projects, tasks = self._projects_and_tasks(active)

        return {
            'sessions': items,
            'total': total,
            'offset': offset,
            'limit': limit,
            'projects': projects,
            'tasks': tasks,
            'activeCount': len(active),
            'index': self.index_status(),
        }

    def session_detail(self, session_id: str) -> dict:
        row = self._get_session_row(session_id)
        if not row:
            runtime = self.runtime_sessions().get(session_id)
            if not runtime:
                raise KeyError('session not found')
            item = self._runtime_only_session(runtime)
            suggestions = self.suggest(session_id)
            brief = build_resume_brief(item, [], suggestions)
            return {'session': item, 'messages': [], 'suggestions': suggestions, 'brief': brief, 'recentRuns': self._recent_runs(session_id)}
        active = self.runtime_sessions()
        session = self._session_row_to_dict(row, active)
        messages = self.messages(session_id, limit=100)
        session['tmux'] = self.tmux_info(session_id)
        suggestions = self.suggest(session_id)
        brief = build_resume_brief(session, self.messages(session_id, limit=180), suggestions)
        return {
            'session': session,
            'messages': messages,
            'suggestions': suggestions,
            'brief': brief,
            'recentRuns': self._recent_runs(session_id),
            'task': self._task_for_row(row),
        }

    def messages(self, session_id: str, limit: int = 80) -> list[dict]:
        row = self._get_session_row(session_id)
        if not row:
            return []
        path = pathlib.Path(row['path'])
        messages = []
        try:
            with path.open('r', encoding='utf-8', errors='replace') as fh:
                for line in fh:
                    try:
                        item = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    item_type = item.get('type')
                    if item_type not in ('user', 'assistant'):
                        continue
                    text, tools = message_text(item.get('message'), include_tool_results=False)
                    if not text and not tools:
                        continue
                    messages.append({
                        'role': item_type,
                        'timestamp': item.get('timestamp') or '',
                        'text': clip(text, 6000),
                        'tools': tools,
                    })
        except OSError:
            return []
        return messages[-limit:]

    def suggest(self, session_id: str) -> list[str]:
        row = self._get_session_row(session_id)
        if not row:
            return [
                'このセッションの現状を整理して、次にやるべきことを1つ実行してください。',
                '未完了タスクを洗い出して、優先順位を付けてください。',
                'ここから再開するための最短の次アクションを提案してください。',
            ]
        last_user = row['last_user'] or row['last_prompt'] or ''
        last_assistant = row['last_assistant'] or ''
        suggestions = [
            'このセッションの現状と未完了タスクを整理して、次に進めるべき1手を実行してください。',
            '直近の出力を前提に、必要な確認事項だけを短く整理してください。',
            'ここまでの作業を引き継ぎメモとしてまとめ、次の具体作業に進んでください。',
        ]
        if any(word in last_assistant for word in ('テスト', '確認', '検証', '動作確認')):
            suggestions[0] = '未実施の確認項目を実行し、結果と残タスクだけ報告してください。'
        if any(word in last_user for word in ('実装', '修正', '作って', '作成')):
            suggestions[1] = '実装状況を確認し、未完了ならそのまま続きから実装してください。'
        if any(word in last_assistant for word in ('質問', '確認したい', '教えて')):
            suggestions[2] = '前回の確認事項に対して、判断に必要な選択肢とおすすめを出してください。'
        return suggestions

    def save_state(self, session_id: str, payload: dict) -> dict:
        status = payload.get('status') or 'open'
        priority = payload.get('priority') or 'normal'
        note = payload.get('note') or ''
        if status not in ('open', 'pending', 'review', 'done'):
            status = 'open'
        if priority not in ('low', 'normal', 'high'):
            priority = 'normal'
        with self._connect() as con:
            con.execute(
                """
                INSERT INTO session_meta(session_id, status, priority, note, updated_at)
                VALUES(?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                  status=excluded.status,
                  priority=excluded.priority,
                  note=excluded.note,
                  updated_at=excluded.updated_at
                """,
                (session_id, status, priority, note, now_iso()),
            )
        return {'ok': True, 'sessionId': session_id, 'status': status, 'priority': priority, 'note': note}

    def _get_session_row(self, session_id: str) -> sqlite3.Row | None:
        with self._connect() as con:
            return con.execute(
                """
                SELECT s.*, COALESCE(m.status, 'open') AS status,
                       COALESCE(m.priority, 'normal') AS priority,
                       COALESCE(m.note, '') AS note,
                       m.updated_at AS meta_updated_at
                FROM session_index s
                LEFT JOIN session_meta m ON m.session_id = s.session_id
                WHERE s.session_id = ?
                """,
                (session_id,),
            ).fetchone()

    def _session_row_to_dict(self, row: sqlite3.Row, active: dict[str, dict]) -> dict:
        session_id = row['session_id']
        runtime = active.get(session_id)
        cwd = row['cwd'] or (runtime or {}).get('cwd') or ''
        project = self._project_info(cwd, row['project_dir'])
        task = self._task_for_row(row)
        return {
            'sessionId': session_id,
            'title': row['title'] or session_id,
            'cwd': cwd,
            'projectKey': project['key'],
            'projectName': project['name'],
            'projectKind': project['kind'],
            'taskText': task['task'],
            'taskUrgency': task['urgency'],
            'path': row['path'],
            'firstPrompt': row['first_prompt'] or '',
            'lastPrompt': row['last_prompt'] or '',
            'lastUser': row['last_user'] or '',
            'lastAssistant': row['last_assistant'] or '',
            'createdAt': row['created_at'] or '',
            'updatedAt': row['updated_at'] or '',
            'gitBranch': row['git_branch'] or '',
            'messageCount': row['message_count'],
            'userCount': row['user_count'],
            'assistantCount': row['assistant_count'],
            'size': row['file_size'],
            'status': row['status'] or 'open',
            'priority': row['priority'] or 'normal',
            'note': row['note'] or '',
            'active': bool(runtime),
            'pid': runtime.get('pid') if runtime else None,
            'runtimeName': runtime.get('name') if runtime else '',
            'tmux': self.tmux_info(session_id),
        }

    def _runtime_only_session(self, runtime: dict) -> dict:
        cwd = runtime.get('cwd') or ''
        project = self._project_info(cwd)
        return {
            'sessionId': runtime['sessionId'],
            'title': runtime.get('name') or runtime['sessionId'],
            'cwd': cwd,
            'projectKey': project['key'],
            'projectName': project['name'],
            'projectKind': project['kind'],
            'taskText': '稼働中セッションを確認',
            'taskUrgency': 3,
            'path': '',
            'firstPrompt': '',
            'lastPrompt': '',
            'lastUser': '',
            'lastAssistant': '',
            'createdAt': runtime.get('startedAtIso') or '',
            'updatedAt': runtime.get('startedAtIso') or '',
            'gitBranch': '',
            'messageCount': 0,
            'userCount': 0,
            'assistantCount': 0,
            'size': 0,
            'status': 'open',
            'priority': 'normal',
            'note': '',
            'active': True,
            'pid': runtime.get('pid'),
            'runtimeName': runtime.get('name') or '',
            'tmux': self.tmux_info(runtime['sessionId']),
        }

    def runtime_sessions(self) -> dict[str, dict]:
        sessions: dict[str, dict] = {}
        if not self.runtime_sessions_dir.exists():
            return sessions
        for path in self.runtime_sessions_dir.glob('*.json'):
            try:
                data = json.loads(path.read_text(encoding='utf-8'))
            except Exception:
                continue
            session_id = data.get('sessionId')
            pid = data.get('pid')
            if not session_id:
                continue
            if pid and not self._pid_alive(pid):
                continue
            started = data.get('startedAt')
            started_iso = ''
            if isinstance(started, (int, float)):
                started_iso = datetime.fromtimestamp(started / 1000, timezone.utc).isoformat(timespec='seconds')
            sessions[session_id] = {
                'sessionId': session_id,
                'pid': pid,
                'cwd': data.get('cwd') or '',
                'name': data.get('name') or '',
                'startedAt': started,
                'startedAtIso': started_iso,
                'entrypoint': data.get('entrypoint') or '',
            }
        return sessions

    def _pid_alive(self, pid: int) -> bool:
        try:
            os.kill(int(pid), 0)
            return True
        except OSError:
            return False

    # === Quick runs ===

    def quick_run(self, session_id: str, prompt: str) -> dict:
        prompt = clean_text(prompt)
        if not prompt:
            raise ValueError('prompt is required')
        row = self._get_session_row(session_id)
        cwd = self._session_cwd(row, session_id)
        run_id = uuid.uuid4().hex[:12]
        run = {
            'runId': run_id,
            'sessionId': session_id,
            'status': 'running',
            'startedAt': now_iso(),
            'finishedAt': None,
            'cwd': cwd,
            'prompt': prompt,
            'output': '',
            'raw': '',
            'error': '',
            'diagnosis': {},
            'returncode': None,
            'mode': 'quick',
            'commandPreview': shlex.join(quick_run_command(session_id, '<prompt>')),
        }
        with self._runs_lock:
            self._runs[run_id] = run
        self._persist_run(run)
        thread = threading.Thread(target=self._quick_run_worker, args=(run_id,), daemon=True)
        thread.start()
        return run

    def _quick_run_worker(self, run_id: str) -> None:
        with self._runs_lock:
            run = self._runs[run_id]
        cmd = quick_run_command(run['sessionId'], run['prompt'])
        try:
            proc = subprocess.Popen(
                cmd,
                cwd=run['cwd'],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            assert proc.stdout is not None
            for line in proc.stdout:
                self._append_run_line(run_id, line)
            returncode = proc.wait()
            with self._runs_lock:
                run = self._runs[run_id]
                diagnosis = diagnose_quick_run_failure(
                    raw=run.get('raw', ''),
                    output=run.get('output', ''),
                    error=run.get('error', ''),
                    returncode=returncode,
                )
            with self._runs_lock:
                self._runs[run_id]['returncode'] = returncode
                self._runs[run_id]['status'] = 'done' if returncode == 0 else 'failed'
                self._runs[run_id]['diagnosis'] = diagnosis
                self._runs[run_id]['finishedAt'] = now_iso()
                finished_run = dict(self._runs[run_id])
            self._persist_run(finished_run)
            self.refresh_index_background(force=False)
        except Exception as exc:
            with self._runs_lock:
                self._runs[run_id]['status'] = 'failed'
                self._runs[run_id]['error'] = str(exc)
                self._runs[run_id]['diagnosis'] = diagnose_quick_run_failure(error=str(exc), returncode=1)
                self._runs[run_id]['finishedAt'] = now_iso()
                failed_run = dict(self._runs[run_id])
            self._persist_run(failed_run)

    def _append_run_line(self, run_id: str, line: str) -> None:
        text = ''
        raw = line.rstrip('\n')
        try:
            data = json.loads(raw)
            dtype = data.get('type')
            if dtype == 'assistant':
                text, _tools = message_text(data.get('message'))
                if data.get('error'):
                    text = (text + '\n' + str(data.get('error'))).strip()
            elif dtype == 'result':
                text = clean_text(data.get('result') or data.get('output') or '')
                if data.get('is_error') and data.get('result'):
                    text = clean_text(data.get('result') or '')
            elif dtype == 'error':
                text = clean_text(data.get('error') or data.get('message') or '')
        except json.JSONDecodeError:
            text = raw

        with self._runs_lock:
            run = self._runs.get(run_id)
            if not run:
                return
            if raw:
                run['raw'] = (run['raw'] + raw + '\n')[-120000:]
            if text:
                run['output'] = (run['output'] + text + '\n')[-80000:]
        with self._runs_lock:
            current = dict(self._runs.get(run_id) or {})
        if current:
            self._persist_run(current)

    def get_run(self, run_id: str) -> dict:
        with self._runs_lock:
            run = self._runs.get(run_id)
            if not run:
                loaded = self._load_run(run_id)
                if not loaded:
                    raise KeyError('run not found')
                return loaded
            return dict(run)

    def _persist_run(self, run: dict) -> None:
        with self._connect() as con:
            con.execute(
                """
                INSERT INTO run_history(
                  run_id, session_id, status, started_at, finished_at, cwd, prompt,
                  output, raw, error, diagnosis_json, returncode, mode, command_preview
                )
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                  status=excluded.status,
                  finished_at=excluded.finished_at,
                  cwd=excluded.cwd,
                  prompt=excluded.prompt,
                  output=excluded.output,
                  raw=excluded.raw,
                  error=excluded.error,
                  diagnosis_json=excluded.diagnosis_json,
                  returncode=excluded.returncode,
                  mode=excluded.mode,
                  command_preview=excluded.command_preview
                """,
                (
                    run.get('runId'),
                    run.get('sessionId'),
                    run.get('status') or 'running',
                    run.get('startedAt') or now_iso(),
                    run.get('finishedAt'),
                    run.get('cwd') or '',
                    run.get('prompt') or '',
                    run.get('output') or '',
                    run.get('raw') or '',
                    run.get('error') or '',
                    json.dumps(run.get('diagnosis') or {}, ensure_ascii=False),
                    run.get('returncode'),
                    run.get('mode') or 'quick',
                    run.get('commandPreview') or '',
                ),
            )

    def _run_row_to_dict(self, row: sqlite3.Row) -> dict:
        diagnosis = {}
        try:
            diagnosis = json.loads(row['diagnosis_json'] or '{}')
        except json.JSONDecodeError:
            diagnosis = {}
        return {
            'runId': row['run_id'],
            'sessionId': row['session_id'],
            'status': row['status'],
            'startedAt': row['started_at'],
            'finishedAt': row['finished_at'],
            'cwd': row['cwd'] or '',
            'prompt': row['prompt'] or '',
            'output': row['output'] or '',
            'raw': row['raw'] or '',
            'error': row['error'] or '',
            'diagnosis': diagnosis,
            'returncode': row['returncode'],
            'mode': row['mode'] or 'quick',
            'commandPreview': row['command_preview'] or '',
        }

    def _load_run(self, run_id: str) -> dict | None:
        with self._connect() as con:
            row = con.execute('SELECT * FROM run_history WHERE run_id = ?', (run_id,)).fetchone()
        return self._run_row_to_dict(row) if row else None

    def _recent_runs(self, session_id: str, limit: int = 5) -> list[dict]:
        with self._connect() as con:
            rows = con.execute(
                'SELECT * FROM run_history WHERE session_id = ? ORDER BY started_at DESC LIMIT ?',
                (session_id, limit),
            ).fetchall()
        return [self._run_row_to_dict(row) for row in rows]

    # === tmux live mode ===

    def open_tmux(self, session_id: str) -> dict:
        if not shutil.which('tmux'):
            raise RuntimeError('tmux command not found')
        if not shutil.which('claude'):
            raise RuntimeError('claude command not found')

        row = self._get_session_row(session_id)
        cwd = self._session_cwd(row, session_id)
        title = (row['title'] if row else session_id) or session_id
        window = 'cc-' + session_id.replace('-', '')[:8]
        target = f'{self.tmux_session}:{window}'

        self._ensure_tmux_session()
        windows = self._tmux(['list-windows', '-t', self.tmux_session, '-F', '#W'], check=False).stdout.splitlines()
        if window not in windows:
            cmd_args = ['claude', '--resume', session_id, '--permission-mode', 'auto', '--name', clip(title, 32)]
            command = ' '.join(shlex.quote(arg) for arg in cmd_args)
            self._tmux(['new-window', '-t', self.tmux_session, '-n', window, '-c', cwd, command], check=True)
        with self._connect() as con:
            con.execute(
                """
                INSERT INTO tmux_targets(session_id, target, window_name, cwd, updated_at)
                VALUES(?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                  target=excluded.target,
                  window_name=excluded.window_name,
                  cwd=excluded.cwd,
                  updated_at=excluded.updated_at
                """,
                (session_id, target, window, cwd, now_iso()),
            )
        return {'ok': True, 'sessionId': session_id, 'target': target, 'windowName': window, 'capture': self.capture_tmux(session_id).get('capture', '')}

    def send_tmux(self, session_id: str, prompt: str) -> dict:
        prompt = clean_text(prompt)
        if not prompt:
            raise ValueError('prompt is required')
        info = self.open_tmux(session_id)
        target = info['target']
        buffer_name = 'claudehub-' + uuid.uuid4().hex[:8]
        self._tmux(['load-buffer', '-b', buffer_name, '-'], input_text=prompt, check=True)
        self._tmux(['paste-buffer', '-t', target, '-b', buffer_name], check=True)
        self._tmux(['send-keys', '-t', target, 'Enter'], check=True)
        time.sleep(0.2)
        return {'ok': True, 'sessionId': session_id, 'target': target, 'capture': self.capture_tmux(session_id).get('capture', '')}

    def capture_tmux(self, session_id: str, lines: int = 220) -> dict:
        info = self.tmux_info(session_id)
        if not info.get('target'):
            return {'ok': False, 'sessionId': session_id, 'capture': '', 'tmux': info}
        result = self._tmux(['capture-pane', '-t', info['target'], '-p', '-S', f'-{lines}'], check=False)
        return {'ok': result.returncode == 0, 'sessionId': session_id, 'capture': result.stdout, 'tmux': info}

    def tmux_info(self, session_id: str) -> dict:
        with self._connect() as con:
            row = con.execute('SELECT * FROM tmux_targets WHERE session_id = ?', (session_id,)).fetchone()
        if not row:
            return {'attached': False, 'target': '', 'windowName': ''}
        exists = False
        if shutil.which('tmux'):
            result = self._tmux(['has-session', '-t', row['target']], check=False)
            exists = result.returncode == 0
        return {'attached': exists, 'target': row['target'], 'windowName': row['window_name'], 'cwd': row['cwd'] or ''}

    def _ensure_tmux_session(self) -> None:
        result = self._tmux(['has-session', '-t', self.tmux_session], check=False)
        if result.returncode != 0:
            self._tmux(['new-session', '-d', '-s', self.tmux_session, '-n', 'hub'], check=True)

    def _tmux(self, args: list[str], input_text: str | None = None, check: bool = False) -> subprocess.CompletedProcess:
        result = subprocess.run(
            ['tmux'] + args,
            input=input_text,
            text=True,
            capture_output=True,
        )
        if check and result.returncode != 0:
            raise RuntimeError(result.stderr or result.stdout or 'tmux command failed')
        return result

    def _session_cwd(self, row: sqlite3.Row | None, session_id: str) -> str:
        runtime = self.runtime_sessions().get(session_id)
        cwd = ''
        if row and row['cwd']:
            cwd = row['cwd']
        elif runtime and runtime.get('cwd'):
            cwd = runtime['cwd']
        if not cwd or not pathlib.Path(cwd).exists():
            cwd = str(self.default_cwd)
        return cwd

    # === Utilities ===

    def _param(self, query: dict[str, list[str]], name: str, default: str) -> str:
        vals = query.get(name)
        return vals[0] if vals else default

    def _int_param(self, query: dict[str, list[str]], name: str, default: int) -> int:
        try:
            return int(self._param(query, name, str(default)))
        except ValueError:
            return default
