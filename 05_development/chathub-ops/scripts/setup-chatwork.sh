#!/usr/bin/env bash
# Chatwork ブリッジを追加する。
# as_token / hs_token / provisioningSecret はこのホスト上で生成し、外へ出さない。
#
# /opt/chathub/synapse 配下は Synapse コンテナが uid 991 で作るため sudo が要る。
set -euo pipefail

INSTALL=/opt/chathub
DOMAIN=chathub.naru.internal
OWNER="@naru:$DOMAIN"
AS_YAML="$INSTALL/synapse/appservices/chatwork.yaml"

sudo mkdir -p "$INSTALL/synapse/appservices"
mkdir -p "$INSTALL/chatwork-bridge/data"

if sudo test -f "$AS_YAML"; then
  echo "appservice already exists; reusing tokens"
  AS_TOKEN=$(sudo grep '^as_token:' "$AS_YAML" | awk '{print $2}')
  HS_TOKEN=$(sudo grep '^hs_token:' "$AS_YAML" | awk '{print $2}')
else
  AS_TOKEN=$(openssl rand -hex 32)
  HS_TOKEN=$(openssl rand -hex 32)
  SENDER=$(openssl rand -hex 8)
  sudo tee "$AS_YAML" >/dev/null <<YAML
id: chatwork
url: http://chatwork-bridge:29350
as_token: $AS_TOKEN
hs_token: $HS_TOKEN
# ブリッジは常に ?user_id= で masquerade するため、この localpart 自身は使われない。
sender_localpart: _chatwork_$SENDER
rate_limited: false
namespaces:
  users:
    - exclusive: true
      regex: '@chatwork_.*:chathub\.naru\.internal'
    - exclusive: true
      regex: '@chatworkbot:chathub\.naru\.internal'
  aliases: []
  rooms: []
YAML
  sudo chown 991:991 "$AS_YAML"
  sudo chmod 600 "$AS_YAML"
  echo "created appservice registration"
fi
sudo chown 991:991 "$INSTALL/synapse/appservices"

if [ -f "$INSTALL/chatwork-bridge/config.json" ]; then
  echo "bridge config already exists; reusing provisioning secret"
  PROV_SECRET=$(python3 -c 'import json;print(json.load(open("/opt/chathub/chatwork-bridge/config.json"))["provisioningSecret"])')
else
  PROV_SECRET=$(openssl rand -hex 24)
  cat > "$INSTALL/chatwork-bridge/config.json" <<JSON
{
  "homeserver": "http://synapse:8008",
  "domain": "$DOMAIN",
  "botLocalpart": "chatworkbot",
  "owner": "$OWNER",
  "port": 29350,
  "asToken": "$AS_TOKEN",
  "hsToken": "$HS_TOKEN",
  "provisioningSecret": "$PROV_SECRET",
  "chatworkToken": ""
}
JSON
  chmod 600 "$INSTALL/chatwork-bridge/config.json"
  echo "created bridge config"
fi

# Synapse に appservice を読ませる。
if ! sudo grep -q '^app_service_config_files:' "$INSTALL/synapse/homeserver.yaml"; then
  sudo tee -a "$INSTALL/synapse/homeserver.yaml" >/dev/null <<'YAML'

app_service_config_files:
  - /data/appservices/chatwork.yaml
YAML
  echo "registered appservice in homeserver.yaml"
fi

# nginx に provisioning の経路を足す。secret は実値を埋める。
if ! grep -q '/provision/chatwork/' "$INSTALL/nginx-default.conf"; then
  python3 - "$PROV_SECRET" <<'PY'
import sys
secret = sys.argv[1]
path = "/opt/chathub/nginx-default.conf"
src = open(path).read()
block = (
    "\n  location /provision/chatwork/ {\n"
    "    proxy_pass http://chatwork-bridge:29350/_matrix/provision/;\n"
    f'    proxy_set_header Authorization "Bearer {secret}";\n'
    "    proxy_read_timeout 130s;\n"
    "  }\n"
)
idx = src.rstrip().rfind("}")
open(path, "w").write(src[:idx] + block + src[idx:])
PY
  echo "added /provision/chatwork/ to nginx"
fi

cd "$INSTALL"
docker compose config -q
docker compose restart synapse
for _ in $(seq 1 60); do
  curl -fsS http://localhost:8008/health >/dev/null 2>&1 && break
  sleep 2
done
docker compose up -d chatwork-bridge
docker compose up -d --force-recreate webui
sleep 6

echo "== status =="
docker compose ps --format '{{.Name}}\t{{.Status}}'
echo "== bridge health =="
curl -fsS -o /dev/null -w 'bridge /health HTTP %{http_code}\n' http://localhost:8009/provision/chatwork/../health 2>/dev/null || \
docker exec chatwork-bridge node -e "require('http').get('http://localhost:29350/health',r=>{console.log('bridge /health HTTP',r.statusCode)}).on('error',e=>console.log('bridge unreachable:',e.message))"
echo "CHATWORK_SETUP_DONE"
