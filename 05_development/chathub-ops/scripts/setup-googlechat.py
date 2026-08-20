#!/usr/bin/env python3
"""mautrix-googlechat の config.yaml をこの環境向けに書き換える。

shared_secret は "generate" のままにしておき、ブリッジ自身に生成させてから
nginx へ写す。こちらで決め打ちにすると、ブリッジ側の再生成とずれる。
"""
import shutil
import sys

import yaml

PATH = "/opt/chathub/bridges/googlechat/config.yaml"
DOMAIN = "chathub.naru.internal"
OWNER = f"@naru:{DOMAIN}"

shutil.copy(PATH, PATH + ".orig")
with open(PATH) as f:
    cfg = yaml.safe_load(f)

cfg["homeserver"]["address"] = "http://synapse:8008"
cfg["homeserver"]["domain"] = DOMAIN

asv = cfg["appservice"]
asv["address"] = "http://mautrix-googlechat:29320"
asv["hostname"] = "0.0.0.0"
asv["port"] = 29320
asv["database"] = "sqlite:////data/mautrix-googlechat.db"
asv["id"] = "googlechat"
asv["bot_username"] = "googlechatbot"

br = cfg["bridge"]
br["permissions"] = {"*": "relay", DOMAIN: "user", OWNER: "admin"}

# 未着信をクライアントが「届かなかった」と表示できるよう bridge-links に送る。
hs = cfg["homeserver"]
hs["message_send_checkpoint_endpoint"] = "http://bridge-links:29360/checkpoints"

with open(PATH, "w") as f:
    yaml.safe_dump(cfg, f, allow_unicode=True, sort_keys=False)

print("configured:")
print("  homeserver:", cfg["homeserver"]["address"], cfg["homeserver"]["domain"])
print("  appservice:", asv["address"], "id=" + asv["id"], "bot=" + asv["bot_username"])
print("  permissions:", br["permissions"])
print("  provisioning.shared_secret:", br["provisioning"]["shared_secret"])
