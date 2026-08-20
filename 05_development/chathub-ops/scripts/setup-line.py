#!/usr/bin/env python3
"""matrix-line-messenger の config.yaml をこの環境向けに書き換える。

bridgev2 系なので googlechat（旧世代）と構造が違う。provisioning はトップレベル、
database は type + uri の2本立てで、既定が postgres なので sqlite に倒す。
"""
import shutil

import yaml

PATH = "/opt/chathub/bridges/line/config.yaml"
DOMAIN = "chathub.naru.internal"
OWNER = f"@naru:{DOMAIN}"
PUBLIC = "https://winnaru.tailac157e.ts.net"

shutil.copy(PATH, PATH + ".orig")
with open(PATH) as f:
    cfg = yaml.safe_load(f)

cfg["homeserver"]["address"] = "http://synapse:8008"
cfg["homeserver"]["domain"] = DOMAIN

# 単独利用なので postgres を建てる意味がない。他ブリッジと同じくファイル1つで済ませる。
cfg["database"]["type"] = "sqlite3-fk-wal"
cfg["database"]["uri"] = "file:/data/bridge.db?_txlock=immediate"

asv = cfg["appservice"]
asv["address"] = "http://mautrix-line:29322"
asv["public_address"] = PUBLIC
asv["hostname"] = "0.0.0.0"
asv["port"] = 29322
asv["id"] = "line"

cfg["bridge"]["permissions"] = {"*": "relay", DOMAIN: "user", OWNER: "admin"}

# 未着信をクライアントが「届かなかった」と出せるよう bridge-links に送る。
cfg["homeserver"]["message_send_checkpoint_endpoint"] = "http://bridge-links:29360/checkpoints"

with open(PATH, "w") as f:
    yaml.safe_dump(cfg, f, allow_unicode=True, sort_keys=False)

print("configured:")
print("  homeserver:", cfg["homeserver"]["address"], cfg["homeserver"]["domain"])
print("  database:", cfg["database"]["type"], cfg["database"]["uri"])
print("  appservice:", asv["address"], "id=" + asv["id"], "bot=" + asv["bot"]["username"])
print("  username_template:", asv["username_template"])
print("  permissions:", cfg["bridge"]["permissions"])
print("  provisioning.shared_secret:", cfg["provisioning"]["shared_secret"])
