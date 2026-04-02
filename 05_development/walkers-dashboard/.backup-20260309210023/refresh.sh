#!/bin/bash
# refresh.sh — Walkers Dashboard データ収集
# ファイルシステムからデータを読み取り data.json を生成する
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT="$SCRIPT_DIR/data.json"

python3 - "$ROOT" "$OUT" << 'PYEOF'
import json, os, sys, pathlib, time, re, subprocess
from datetime import datetime

ROOT = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])

def safe_read(path, default=''):
    try:
        return path.read_text(encoding='utf-8')
    except:
        return default

def file_meta(path):
    st = path.stat()
    return {
        'size': st.st_size,
        'modified': datetime.fromtimestamp(st.st_mtime).isoformat(timespec='seconds')
    }

# === 1. Skills ===
skills = []
cmds_dir = ROOT / '.claude' / 'commands'
if cmds_dir.exists():
    for f in sorted(cmds_dir.glob('*.md')):
        content = safe_read(f)
        triggers = ''
        phases = 0
        for line in content.split('\n'):
            if 'トリガー' in line and ':' in line:
                triggers = line.split(':', 1)[1].strip().strip('`"')
                break
        phases = len(re.findall(r'^##\s+', content, re.MULTILINE))
        skills.append({
            'name': f.stem,
            'triggers': triggers,
            'phases': phases,
            'lines': content.count('\n') + 1,
            'size': f.stat().st_size,
            'modified': datetime.fromtimestamp(f.stat().st_mtime).isoformat(timespec='seconds')
        })

# === 2. Memories ===
memories = {}
mem_dir = ROOT / '00_context' / 'memories'
if mem_dir.exists():
    for f in mem_dir.glob('*.md'):
        content = safe_read(f)
        lines = content.split('\n')
        memories[f.stem] = {
            'path': str(f.relative_to(ROOT)),
            'preview': '\n'.join(lines[:5]),
            'lines': len(lines),
            'size': f.stat().st_size,
            'modified': datetime.fromtimestamp(f.stat().st_mtime).isoformat(timespec='seconds')
        }

# Auto-memory (dynamically find MEMORY.md)
auto_mem_path = None
projects_dir = ROOT / '.claude' / 'projects'
if projects_dir.is_dir():
    for d in projects_dir.iterdir():
        candidate = d / 'memory' / 'MEMORY.md'
        if candidate.exists():
            auto_mem_path = candidate
            break
if auto_mem_path and auto_mem_path.exists():
    content = safe_read(auto_mem_path)
    lines = content.split('\n')
    memories['auto_memory'] = {
        'path': str(auto_mem_path.relative_to(ROOT)),
        'preview': '\n'.join(lines[:5]),
        'lines': len(lines),
        'size': auto_mem_path.stat().st_size,
        'modified': datetime.fromtimestamp(auto_mem_path.stat().st_mtime).isoformat(timespec='seconds')
    }

# === 3. Pipeline ===
pipeline_path = ROOT / '04_sales' / 'pipeline.md'
pipeline_raw = safe_read(pipeline_path)
deal_count = len(re.findall(r'^### \d+\.', pipeline_raw, re.MULTILINE))

# Count stages
stages = {}
for m in re.finditer(r'\*\*ステータス\*\*:\s*(.+)', pipeline_raw):
    stage = m.group(1).split('（')[0].strip()
    stages[stage] = stages.get(stage, 0) + 1

# Count urgent actions
urgent_section = re.search(r'## 要対応アクション([\s\S]*?)(?=\n## |\Z)', pipeline_raw)
urgent_count = 0
if urgent_section:
    urgent_count = len(re.findall(r'^\|(?!\s*[-|])', urgent_section.group(1), re.MULTILINE)) - 1
    urgent_count = max(0, urgent_count)

pipeline = {
    'raw': pipeline_raw,
    'dealCount': deal_count,
    'stages': stages,
    'urgentActions': urgent_count,
    'modified': datetime.fromtimestamp(pipeline_path.stat().st_mtime).isoformat(timespec='seconds') if pipeline_path.exists() else None
}

# === 4. Projects ===
projects = []
proj_dir = ROOT / '03_projects'
if proj_dir.exists():
    for d in sorted(proj_dir.iterdir()):
        if d.is_dir() and d.name != 'templates':
            files = []
            for item in sorted(d.rglob('*')):
                if item.is_file():
                    files.append(str(item.relative_to(d)))
            projects.append({
                'name': d.name,
                'files': files,
                'fileCount': len(files),
                'modified': datetime.fromtimestamp(d.stat().st_mtime).isoformat(timespec='seconds')
            })

# === 5. Finance ===
finance_path = ROOT / '02_finance' / 'monthly-summary.md'
finance_raw = safe_read(finance_path)
finance = {
    'raw': finance_raw,
    'hasData': len(finance_raw.strip()) > 50,
    'modified': datetime.fromtimestamp(finance_path.stat().st_mtime).isoformat(timespec='seconds') if finance_path.exists() else None
}

# === 6. Daily ===
daily_path = ROOT / 'DAILY.md'
daily_raw = safe_read(daily_path)
daily = {
    'raw': daily_raw,
    'hasData': len(daily_raw.strip()) > 10,
    'modified': datetime.fromtimestamp(daily_path.stat().st_mtime).isoformat(timespec='seconds') if daily_path.exists() else None
}

# === 7. Outputs ===
outputs = []
gui_dir = ROOT / 'output' / 'gui'
if gui_dir.exists():
    for f in sorted(gui_dir.glob('*.html')):
        if f.name in ('gui-core.js', 'gui-style.css'):
            continue
        outputs.append({
            'name': f.name,
            'size': f.stat().st_size,
            'modified': datetime.fromtimestamp(f.stat().st_mtime).isoformat(timespec='seconds')
        })

# === 8. Settings ===
claude_md = ROOT / 'CLAUDE.md'
claude_content = safe_read(claude_md)
mcp_json = ROOT / '.mcp.json'
mcp_servers = []
if mcp_json.exists():
    try:
        mcp_data = json.loads(safe_read(mcp_json))
        mcp_servers = list(mcp_data.get('mcpServers', {}).keys())
    except:
        pass

# Known connected servers
connected = ['notion', 'playwright', 'misoca', 'misoca-private', 'google', 'taskgod']

settings = {
    'mcpServers': mcp_servers,
    'connectedServers': [s for s in mcp_servers if s in connected],
    'claudeMdLines': claude_content.count('\n') + 1,
    'claudeMdSize': len(claude_content.encode('utf-8'))
}

# === 9. Git ===
git_info = {'branch': 'unknown', 'commits': []}
try:
    result = subprocess.run(['git', 'branch', '--show-current'], capture_output=True, text=True, cwd=str(ROOT), timeout=5)
    git_info['branch'] = result.stdout.strip()
    result = subprocess.run(['git', 'log', '--oneline', '-10'], capture_output=True, text=True, cwd=str(ROOT), timeout=5)
    git_info['commits'] = [line.strip() for line in result.stdout.strip().split('\n') if line.strip()]
except:
    pass

# === 10. Skill Hub (shared registry) ===
skillhub = {'skills': [], 'version': '1.0.0', 'installed': []}
registry_path = ROOT / '05_development' / 'walkers-marketplace' / 'skill-registry.json'
if registry_path.exists():
    try:
        registry_data = json.loads(safe_read(registry_path))
        skillhub['skills'] = registry_data.get('skills', [])
        skillhub['version'] = registry_data.get('version', '1.0.0')
    except:
        pass

# Check installed skills
cmd_dir = ROOT / '.claude' / 'commands'
if cmd_dir.exists():
    skillhub['installed'] = [f.stem for f in cmd_dir.glob('*.md')]

# === Build data.json ===
data = {
    '_meta': {
        'refreshedAt': datetime.now().isoformat(timespec='seconds'),
        'walkersRoot': str(ROOT),
        'version': '1.0.0'
    },
    'skills': skills,
    'memories': memories,
    'pipeline': pipeline,
    'projects': projects,
    'finance': finance,
    'daily': daily,
    'outputs': outputs,
    'settings': settings,
    'git': git_info,
    'skillhub': skillhub
}

# Atomic write
tmp = OUT.with_suffix('.json.tmp')
tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
tmp.rename(OUT)
print(f'data.json written: {OUT.stat().st_size} bytes')
PYEOF
