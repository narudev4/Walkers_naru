#!/usr/bin/env python3
"""Walkers Gateway Service — Windows persistent daemon wrapper.

Keeps server.py running as a background service with auto-restart.
Integrates cloud command polling for remote gateway access.

Usage:
  python gateway-service.py              # Run in foreground
  python gateway-service.py --install    # Install as Windows Task Scheduler task
  python gateway-service.py --uninstall  # Remove scheduled task
  pythonw gateway-service.py             # Run silently (no console window)
"""

import json
import os
import pathlib
import subprocess
import sys
import time
import signal
import urllib.request
import urllib.error
import ssl
import logging
from datetime import datetime

# === Config ===
DASHBOARD_DIR = pathlib.Path(__file__).parent.resolve()
CONFIG_PATH = DASHBOARD_DIR / 'config.json'
LOG_DIR = DASHBOARD_DIR / 'logs'
LOG_DIR.mkdir(exist_ok=True)

TASK_NAME = 'WalkersGateway'
RESTART_DELAY = 5  # seconds between restart attempts
MAX_RESTART_DELAY = 60  # max backoff
HEALTH_CHECK_INTERVAL = 30  # seconds
CLOUD_POLL_INTERVAL = 15  # seconds
RESULT_RELAY_INTERVAL = 5  # seconds — check for completed local results

# Track cloud→local command mapping for result relay
# {cloud_cmd_id: {local_cmd_id, base_url, api_key, machine_id, timestamp}}
_pending_relays = {}

# SSL context
try:
    import certifi
    _ssl_ctx = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _ssl_ctx = ssl.create_default_context()
    _ssl_ctx.check_hostname = False
    _ssl_ctx.verify_mode = ssl.CERT_NONE

# === Logging ===
log_file = LOG_DIR / f'gateway-{datetime.now().strftime("%Y-%m-%d")}.log'
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(str(log_file), encoding='utf-8'),
        logging.StreamHandler(sys.stdout),
    ]
)
log = logging.getLogger('gateway')


def load_config():
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text(encoding='utf-8'))
    return {}


def health_check(host, port):
    """Check if server.py is responding."""
    try:
        req = urllib.request.Request(f'http://{host}:{port}/api/gateway/status')
        urllib.request.urlopen(req, timeout=5)
        return True
    except Exception:
        return False


def poll_cloud_commands(config):
    """Poll Cloud API for pending gateway commands and relay to local server."""
    cloud = config.get('cloudApi', {})
    sm = config.get('sharedMachineMode', {})
    base_url = cloud.get('url', '').rstrip('/')
    api_key = cloud.get('apiKey', '')
    machine_id = config.get('machineId', '')

    if not (sm.get('enabled') and base_url and api_key):
        return

    try:
        # Poll for pending commands
        req = urllib.request.Request(
            f'{base_url}/api/gateway/poll',
            headers={
                'X-API-Key': api_key,
                'X-Machine-Id': machine_id,
            }
        )
        resp = urllib.request.urlopen(req, timeout=10, context=_ssl_ctx)
        data = json.loads(resp.read().decode('utf-8'))
        commands = data.get('commands', [])

        if not commands:
            return

        log.info(f'Received {len(commands)} command(s) from cloud')

        host = config.get('host', '127.0.0.1')
        port = int(config.get('port', 8080))

        for cmd in commands:
            # Forward to local gateway
            try:
                payload = json.dumps({
                    'prompt': cmd['prompt'],
                    'source': 'cloud',
                }).encode('utf-8')
                local_req = urllib.request.Request(
                    f'http://{host}:{port}/api/gateway/chat',
                    data=payload,
                    headers={'Content-Type': 'application/json'},
                    method='POST',
                )
                local_resp = urllib.request.urlopen(local_req, timeout=5)
                local_data = json.loads(local_resp.read().decode('utf-8'))

                # Update cloud command status and track for result relay
                if local_data.get('ok'):
                    local_cmd_id = local_data.get('commandId', '')
                    update_payload = json.dumps({
                        'status': 'running',
                        'result': {'localCommandId': local_cmd_id},
                    }).encode('utf-8')
                    update_req = urllib.request.Request(
                        f'{base_url}/api/gateway/{machine_id}/{cmd["id"]}',
                        data=update_payload,
                        headers={
                            'Content-Type': 'application/json',
                            'X-API-Key': api_key,
                            'X-Machine-Id': machine_id,
                        },
                        method='PUT',
                    )
                    urllib.request.urlopen(update_req, timeout=10, context=_ssl_ctx)

                    # Track for result relay
                    _pending_relays[cmd['id']] = {
                        'local_cmd_id': local_cmd_id,
                        'base_url': base_url,
                        'api_key': api_key,
                        'machine_id': machine_id,
                        'timestamp': time.time(),
                    }
                    log.info(f'Command {cmd["id"]} forwarded (local={local_cmd_id}), tracking for relay')

            except Exception as e:
                log.error(f'Failed to forward command {cmd.get("id", "?")}: {e}')

    except urllib.error.URLError:
        pass  # Cloud API unreachable, skip silently
    except Exception as e:
        log.error(f'Cloud poll error: {e}')


def relay_results_to_cloud(config):
    """Check local gateway for completed results and relay back to Vercel cloud."""
    if not _pending_relays:
        return

    host = config.get('host', '127.0.0.1')
    port = int(config.get('port', 8080))

    completed = []
    for cloud_cmd_id, relay in list(_pending_relays.items()):
        local_cmd_id = relay['local_cmd_id']
        base_url = relay['base_url']
        api_key = relay['api_key']
        machine_id = relay['machine_id']

        try:
            # Check local result
            local_req = urllib.request.Request(
                f'http://{host}:{port}/api/gateway/result/{local_cmd_id}'
            )
            local_resp = urllib.request.urlopen(local_req, timeout=5)
            local_data = json.loads(local_resp.read().decode('utf-8'))

            # Still running — skip
            if local_data.get('status') == 'running' or local_data.get('message') == 'Still running...':
                # Timeout: expire after 15 minutes
                if time.time() - relay['timestamp'] > 900:
                    log.warning(f'Command {cloud_cmd_id} timed out (15min), marking failed')
                    _relay_final_status(base_url, machine_id, cloud_cmd_id, api_key,
                                       'failed', {'error': 'Execution timed out (15 min)'})
                    completed.append(cloud_cmd_id)
                continue

            # Completed — relay to cloud
            if 'ok' in local_data:
                status = 'done' if local_data['ok'] else 'failed'
                result_payload = {
                    'output': local_data.get('output', ''),
                    'error': local_data.get('error', ''),
                }
                _relay_final_status(base_url, machine_id, cloud_cmd_id, api_key,
                                    status, result_payload)
                log.info(f'Result relayed to cloud: {cloud_cmd_id} -> {status}')
                completed.append(cloud_cmd_id)

        except urllib.error.HTTPError as e:
            if e.code == 404:
                log.warning(f'Local command {local_cmd_id} not found, dropping relay')
                completed.append(cloud_cmd_id)
            else:
                log.error(f'Relay check error for {cloud_cmd_id}: {e}')
        except Exception as e:
            log.error(f'Relay check error for {cloud_cmd_id}: {e}')

    for cmd_id in completed:
        _pending_relays.pop(cmd_id, None)


def _relay_final_status(base_url, machine_id, cloud_cmd_id, api_key, status, result):
    """PUT final status + result back to Vercel cloud API."""
    payload = json.dumps({
        'status': status,
        'result': result,
    }).encode('utf-8')
    req = urllib.request.Request(
        f'{base_url}/api/gateway/{machine_id}/{cloud_cmd_id}',
        data=payload,
        headers={
            'Content-Type': 'application/json',
            'X-API-Key': api_key,
            'X-Machine-Id': machine_id,
        },
        method='PUT',
    )
    urllib.request.urlopen(req, timeout=10, context=_ssl_ctx)


def run_server():
    """Run server.py as a subprocess with auto-restart."""
    server_py = DASHBOARD_DIR / 'server.py'
    python_exe = sys.executable
    restart_delay = RESTART_DELAY

    log.info(f'Gateway service starting')
    log.info(f'Dashboard dir: {DASHBOARD_DIR}')
    log.info(f'Python: {python_exe}')

    running = True

    def signal_handler(signum, frame):
        nonlocal running
        log.info(f'Received signal {signum}, shutting down...')
        running = False

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    if hasattr(signal, 'SIGBREAK'):
        signal.signal(signal.SIGBREAK, signal_handler)

    while running:
        config = load_config()
        host = config.get('host', '127.0.0.1')
        port = int(config.get('port', 8080))

        log.info(f'Starting server.py on {host}:{port}')

        try:
            proc = subprocess.Popen(
                [python_exe, str(server_py)],
                cwd=str(DASHBOARD_DIR),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )

            last_health_check = time.time()
            last_cloud_poll = time.time()
            last_result_relay = time.time()

            while running and proc.poll() is None:
                # Read output (non-blocking via timeout)
                try:
                    line = proc.stdout.readline()
                    if line:
                        log.info(f'[server] {line.rstrip()}')
                except Exception:
                    pass

                now = time.time()

                # Periodic health check
                if now - last_health_check > HEALTH_CHECK_INTERVAL:
                    last_health_check = now
                    if health_check(host, port):
                        restart_delay = RESTART_DELAY  # Reset backoff on healthy
                    else:
                        log.warning('Health check failed')

                # Cloud polling + result relay are handled by server.py's built-in
                # _cloud_heartbeat_loop (which also handles Google Chat auto-reply).
                # gateway-service.py focuses on process management only.

            exit_code = proc.returncode
            log.warning(f'server.py exited with code {exit_code}')

        except FileNotFoundError:
            log.error(f'server.py not found at {server_py}')
            break
        except Exception as e:
            log.error(f'Failed to start server.py: {e}')

        if running:
            log.info(f'Restarting in {restart_delay}s...')
            time.sleep(restart_delay)
            restart_delay = min(restart_delay * 2, MAX_RESTART_DELAY)

    log.info('Gateway service stopped')


# === Windows Task Scheduler Integration ===

def install_task():
    """Install as Windows Task Scheduler task (runs at logon, auto-restart)."""
    python_exe = sys.executable
    # Use pythonw.exe for silent background execution
    pythonw = python_exe.replace('python.exe', 'pythonw.exe')
    if not os.path.exists(pythonw):
        pythonw = python_exe

    script_path = str(DASHBOARD_DIR / 'gateway-service.py')

    xml_content = f'''<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Walkers Gateway — Always-on AI agent gateway with cron engine</Description>
    <Author>Walkers</Author>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
    <BootTrigger>
      <Enabled>true</Enabled>
      <Delay>PT30S</Delay>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
  </Settings>
  <Actions>
    <Exec>
      <Command>{pythonw}</Command>
      <Arguments>"{script_path}"</Arguments>
      <WorkingDirectory>{DASHBOARD_DIR}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>'''

    xml_path = DASHBOARD_DIR / 'gateway-task.xml'
    xml_path.write_text(xml_content, encoding='utf-16')

    try:
        result = subprocess.run(
            ['schtasks', '/create', '/tn', TASK_NAME, '/xml', str(xml_path), '/f'],
            capture_output=True, text=True,
        )
        if result.returncode == 0:
            print(f'[OK] Task "{TASK_NAME}" installed successfully')
            print(f'     Auto-start on logon + boot')
            print(f'     Manual start: schtasks /run /tn {TASK_NAME}')
            print(f'     Check status: schtasks /query /tn {TASK_NAME}')
        else:
            print(f'[ERROR] Install failed: {result.stderr}')
            print(f'        Run as administrator')
    finally:
        xml_path.unlink(missing_ok=True)


def uninstall_task():
    """Remove the Windows Task Scheduler task."""
    result = subprocess.run(
        ['schtasks', '/delete', '/tn', TASK_NAME, '/f'],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        print(f'[OK] Task "{TASK_NAME}" removed')
    else:
        print(f'[ERROR] Remove failed: {result.stderr}')


def status_task():
    """Check task status."""
    result = subprocess.run(
        ['schtasks', '/query', '/tn', TASK_NAME, '/fo', 'LIST', '/v'],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        print(result.stdout)
    else:
        print(f'タスク "{TASK_NAME}" が見つかりません')


if __name__ == '__main__':
    if len(sys.argv) > 1:
        cmd = sys.argv[1].lower()
        if cmd == '--install':
            install_task()
        elif cmd == '--uninstall':
            uninstall_task()
        elif cmd == '--status':
            status_task()
        elif cmd == '--help':
            print(__doc__)
        else:
            print(f'Unknown command: {cmd}')
            print('Usage: python gateway-service.py [--install|--uninstall|--status|--help]')
    else:
        run_server()
