#!/usr/bin/env python3
"""Walkers Dashboard — data.json generator (cross-platform, replaces refresh.sh)"""
import json, os, sys, pathlib, re, subprocess
from datetime import datetime

ROOT = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])

def safe_read(path, default=''):
    try:
        return path.read_text(encoding='utf-8')
    except Exception:
        return default

# === 1. Skills ===
skills = []
cmds_dir = ROOT / '.claude' / 'commands'
if cmds_dir.exists():
    for f in sorted(cmds_dir.glob('*.md')):
        content = safe_read(f)
        triggers = ''
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
projects_dir = ROOT / '.claude' / 'projects'
if projects_dir.is_dir():
    for d in projects_dir.iterdir():
        candidate = d / 'memory' / 'MEMORY.md'
        if candidate.exists():
            content = safe_read(candidate)
            lines = content.split('\n')
            memories['auto_memory'] = {
                'path': str(candidate.relative_to(ROOT)),
                'preview': '\n'.join(lines[:5]),
                'lines': len(lines),
                'size': candidate.stat().st_size,
                'modified': datetime.fromtimestamp(candidate.stat().st_mtime).isoformat(timespec='seconds')
            }
            break

# === 3. Pipeline ===
pipeline_path = ROOT / '04_sales' / 'pipeline.md'
pipeline_raw = safe_read(pipeline_path)
deal_count = len(re.findall(r'^### \d+\.', pipeline_raw, re.MULTILINE))
stages = {}
for m in re.finditer(r'\*\*ステータス\*\*:\s*(.+)', pipeline_raw):
    stage = m.group(1).split('（')[0].strip()
    stages[stage] = stages.get(stage, 0) + 1
urgent_section = re.search(r'## 要対応アクション([\s\S]*?)(?=\n## |\Z)', pipeline_raw)
urgent_count = 0
if urgent_section:
    urgent_count = max(0, len(re.findall(r'^\|(?!\s*[-|])', urgent_section.group(1), re.MULTILINE)) - 1)
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
            files = [str(item.relative_to(d)) for item in sorted(d.rglob('*')) if item.is_file()]
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
    except Exception:
        pass
connected = ['notion', 'playwright', 'taskgod', 'google-sheets', 'google-drive', 'google-slides', 'walkers-sub-agents']
settings = {
    'mcpServers': mcp_servers,
    'connectedServers': [s for s in mcp_servers if s in connected],
    'claudeMdLines': claude_content.count('\n') + 1,
    'claudeMdSize': len(claude_content.encode('utf-8'))
}

# === 9. Git ===
git_info = {'branch': 'unknown', 'commits': []}
try:
    r = subprocess.run(['git', 'branch', '--show-current'], capture_output=True, text=True,
                       cwd=str(ROOT), timeout=5, encoding='utf-8', errors='replace')
    git_info['branch'] = r.stdout.strip()
    r = subprocess.run(['git', 'log', '--oneline', '-10'], capture_output=True, text=True,
                       cwd=str(ROOT), timeout=5, encoding='utf-8', errors='replace')
    git_info['commits'] = [l.strip() for l in r.stdout.strip().split('\n') if l.strip()]
except Exception:
    pass

# === 10. Skill Hub ===
skillhub = {'skills': [], 'version': '1.0.0', 'installed': []}
registry_path = ROOT / '05_development' / 'walkers-marketplace' / 'skill-registry.json'
if registry_path.exists():
    try:
        registry_data = json.loads(safe_read(registry_path))
        skillhub['skills'] = registry_data.get('skills', [])
        skillhub['version'] = registry_data.get('version', '1.0.0')
    except Exception:
        pass
cmd_dir = ROOT / '.claude' / 'commands'
if cmd_dir.exists():
    skillhub['installed'] = [f.stem for f in cmd_dir.glob('*.md')]

# === Build data.json (atomic write) ===
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

tmp = OUT.with_suffix('.json.tmp')
tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
os.replace(str(tmp), str(OUT))
print(f'data.json written: {OUT.stat().st_size} bytes')
