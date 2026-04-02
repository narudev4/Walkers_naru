#!/usr/bin/env python3
"""Walkers Sub-Agent MCP Server — stdio JSON-RPC 2.0

Exposes sub-agent tools to Claude CLI so the main agent can:
- List all sub-agents and their status
- Delegate tasks to specific sub-agents
- Read sub-agent memory (facts/decisions/preferences)
- Check sub-agent execution logs

This server communicates with server.py via HTTP (localhost:8080).
"""

import json
import sys
import urllib.request
import urllib.error
import pathlib

# Config
DASHBOARD_DIR = pathlib.Path(__file__).parent.resolve()
CONFIG_PATH = DASHBOARD_DIR / 'config.json'


def _load_config():
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text(encoding='utf-8'))
    return {}


def _base_url():
    cfg = _load_config()
    host = cfg.get('host', '127.0.0.1')
    port = cfg.get('port', 8080)
    return f'http://{host}:{port}'


def _http(method, path, body=None):
    """Make HTTP request to server.py and return parsed JSON."""
    url = f'{_base_url()}{path}'
    data = json.dumps(body).encode('utf-8') if body else None
    headers = {'Content-Type': 'application/json'} if data else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8', errors='replace')
        return {'error': f'HTTP {e.code}: {error_body[:500]}'}
    except Exception as e:
        return {'error': str(e)}


# === Tool Definitions ===

TOOLS = [
    {
        'name': 'list_sub_agents',
        'description': (
            'サブエージェント一覧を取得します。各サブエージェントのID・名前・説明・'
            'スキル・cron設定・最終実行結果・統計情報を返します。'
            'メインエージェントが委譲先を判断するために使用します。'
        ),
        'inputSchema': {
            'type': 'object',
            'properties': {},
            'required': [],
        },
    },
    {
        'name': 'call_sub_agent',
        'description': (
            '指定したサブエージェントにタスクを委譲します。'
            'サブエージェントは自身のスキル権限・サブ記憶を使って実行します。'
            'カスタムプロンプトを渡すことで、登録済みプロンプト以外のタスクも依頼できます。'
            '実行は非同期で行われ、完了まで数分かかることがあります。'
        ),
        'inputSchema': {
            'type': 'object',
            'properties': {
                'id': {
                    'type': 'string',
                    'description': 'サブエージェントのID（list_sub_agentsで取得可能）',
                },
                'prompt': {
                    'type': 'string',
                    'description': (
                        '実行するタスクの指示。省略すると登録済みのデフォルトプロンプトで実行。'
                        '指定すると、このプロンプトがサブエージェントに送信される。'
                    ),
                },
            },
            'required': ['id'],
        },
    },
    {
        'name': 'read_sub_agent_memory',
        'description': (
            'サブエージェントの記憶（facts/decisions/preferences）を読み取ります。'
            'サブエージェントが過去に蓄積した知識・判断履歴・設定を確認できます。'
        ),
        'inputSchema': {
            'type': 'object',
            'properties': {
                'id': {
                    'type': 'string',
                    'description': 'サブエージェントのID',
                },
                'type': {
                    'type': 'string',
                    'enum': ['facts', 'decisions', 'preferences', 'all'],
                    'description': '取得する記憶の種類。allで全種類を取得。',
                    'default': 'all',
                },
            },
            'required': ['id'],
        },
    },
    {
        'name': 'get_sub_agent_logs',
        'description': (
            'サブエージェントの最近の実行ログを取得します。'
            '過去の実行結果・エラー・出力を確認できます。'
        ),
        'inputSchema': {
            'type': 'object',
            'properties': {
                'id': {
                    'type': 'string',
                    'description': 'サブエージェントのID',
                },
            },
            'required': ['id'],
        },
    },
]


# === Tool Handlers ===

def handle_list_sub_agents(_args):
    data = _http('GET', '/api/sub-agents')
    agents = data.get('subAgents', [])
    if not agents:
        return 'サブエージェントが登録されていません。'

    lines = [f'## サブエージェント一覧（{len(agents)}件）\n']
    for sa in agents:
        cron = sa.get('cron', {})
        last_run = sa.get('lastRun') or {}
        stats = sa.get('stats', {})
        skills = ', '.join(f'/{s}' for s in sa.get('skills', []))

        status_icon = '●' if cron.get('enabled') else '○'
        last_status = last_run.get('status', '未実行')
        last_time = last_run.get('timestamp', '-')

        lines.append(
            f'### {status_icon} {sa["name"]} (id: `{sa["id"]}`)\n'
            f'- 説明: {sa.get("description", "-")}\n'
            f'- スキル: {skills or "なし"}\n'
            f'- cron: {cron.get("description", cron.get("expression", "未設定"))} '
            f'({"有効" if cron.get("enabled") else "無効"})\n'
            f'- 最終実行: {last_time} ({last_status})\n'
            f'- 統計: {stats.get("totalRuns", 0)}回実行, 成功率{int(stats.get("successRate", 0)*100)}%\n'
            f'- プロンプト: {(sa.get("prompt", "") or "")[:100]}...\n'
        )
    return '\n'.join(lines)


def handle_call_sub_agent(args):
    sa_id = args.get('id', '')
    custom_prompt = args.get('prompt', '')

    if not sa_id:
        return 'エラー: idは必須です'

    body = {}
    if custom_prompt:
        body['prompt'] = custom_prompt

    data = _http('POST', f'/api/sub-agents/{sa_id}/run', body if body else None)

    if data.get('ok'):
        msg = f'サブエージェント `{sa_id}` の実行を開始しました。'
        if custom_prompt:
            msg += f'\nカスタムプロンプト: {custom_prompt[:100]}...'
        msg += '\n\n実行には数分かかることがあります。get_sub_agent_logsで結果を確認できます。'
        return msg
    else:
        return f'エラー: {data.get("error", json.dumps(data))}'


def handle_read_sub_agent_memory(args):
    sa_id = args.get('id', '')
    mem_type = args.get('type', 'all')

    if not sa_id:
        return 'エラー: idは必須です'

    data = _http('GET', f'/api/sub-agents/{sa_id}/memory')

    if 'error' in data:
        return f'エラー: {data["error"]}'

    if mem_type == 'all':
        lines = [f'## サブエージェント `{sa_id}` の記憶\n']
        for key in ['facts', 'decisions', 'preferences']:
            content = data.get(key, '（なし）')
            lines.append(f'### {key}.md\n```\n{content}\n```\n')
        return '\n'.join(lines)
    else:
        content = data.get(mem_type, '（なし）')
        return f'## {sa_id} / {mem_type}.md\n```\n{content}\n```'


def handle_get_sub_agent_logs(args):
    sa_id = args.get('id', '')
    if not sa_id:
        return 'エラー: idは必須です'

    data = _http('GET', f'/api/sub-agents/{sa_id}/logs')
    lines = data.get('lines', [])

    if not lines:
        return f'サブエージェント `{sa_id}` の実行ログはありません。'

    # Return last 50 lines to keep context manageable
    recent = lines[-50:]
    return f'## サブエージェント `{sa_id}` 実行ログ（最新{len(recent)}行）\n```\n' + '\n'.join(recent) + '\n```'


TOOL_HANDLERS = {
    'list_sub_agents': handle_list_sub_agents,
    'call_sub_agent': handle_call_sub_agent,
    'read_sub_agent_memory': handle_read_sub_agent_memory,
    'get_sub_agent_logs': handle_get_sub_agent_logs,
}


# === MCP Protocol (JSON-RPC 2.0 over stdio) ===

def send_response(response):
    """Send a JSON-RPC response via stdout (binary mode for Windows compat)."""
    msg_bytes = json.dumps(response, ensure_ascii=False).encode('utf-8')
    header = f'Content-Length: {len(msg_bytes)}\r\n\r\n'.encode('utf-8')
    sys.stdout.buffer.write(header)
    sys.stdout.buffer.write(msg_bytes)
    sys.stdout.buffer.flush()


def handle_request(request):
    """Handle a JSON-RPC 2.0 request."""
    method = request.get('method', '')
    req_id = request.get('id')
    params = request.get('params', {})

    if method == 'initialize':
        return {
            'jsonrpc': '2.0',
            'id': req_id,
            'result': {
                'protocolVersion': '2024-11-05',
                'capabilities': {
                    'tools': {},
                },
                'serverInfo': {
                    'name': 'walkers-sub-agents',
                    'version': '1.0.0',
                },
            },
        }

    elif method == 'notifications/initialized':
        return None  # No response for notifications

    elif method == 'tools/list':
        return {
            'jsonrpc': '2.0',
            'id': req_id,
            'result': {
                'tools': TOOLS,
            },
        }

    elif method == 'tools/call':
        tool_name = params.get('name', '')
        tool_args = params.get('arguments', {})

        handler = TOOL_HANDLERS.get(tool_name)
        if not handler:
            return {
                'jsonrpc': '2.0',
                'id': req_id,
                'result': {
                    'content': [{'type': 'text', 'text': f'Unknown tool: {tool_name}'}],
                    'isError': True,
                },
            }

        try:
            result_text = handler(tool_args)
            return {
                'jsonrpc': '2.0',
                'id': req_id,
                'result': {
                    'content': [{'type': 'text', 'text': result_text}],
                },
            }
        except Exception as e:
            return {
                'jsonrpc': '2.0',
                'id': req_id,
                'result': {
                    'content': [{'type': 'text', 'text': f'Error: {str(e)}'}],
                    'isError': True,
                },
            }

    elif method == 'ping':
        return {'jsonrpc': '2.0', 'id': req_id, 'result': {}}

    else:
        # Unknown method — return error for requests with id, ignore notifications
        if req_id is not None:
            return {
                'jsonrpc': '2.0',
                'id': req_id,
                'error': {
                    'code': -32601,
                    'message': f'Method not found: {method}',
                },
            }
        return None


def main():
    """Main loop — read JSON-RPC messages from stdin, respond via stdout."""
    buffer = b''

    while True:
        try:
            # Read Content-Length header
            line = sys.stdin.buffer.readline()
            if not line:
                break  # EOF

            line_str = line.decode('utf-8', errors='replace').strip()

            # Parse Content-Length
            if line_str.startswith('Content-Length:'):
                content_length = int(line_str.split(':')[1].strip())

                # Read blank line separator
                sys.stdin.buffer.readline()

                # Read body
                body = sys.stdin.buffer.read(content_length)
                request = json.loads(body.decode('utf-8'))

                response = handle_request(request)
                if response is not None:
                    send_response(response)

        except json.JSONDecodeError:
            continue
        except KeyboardInterrupt:
            break
        except Exception:
            continue


if __name__ == '__main__':
    main()
