#!/usr/bin/env bash
# install-windows.ps1 の WSL 内処理を Linux ネイティブに移したもの。
# PowerShell を経由しないので、SSH だけで構築・更新が完結する。
set -euo pipefail

SRC="$HOME/chathub-src/chathub-distribution"
ENV_FILE="$SRC/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "missing $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

INSTALL="${CHATHUB_INSTALL_DIR:-/opt/chathub}"
SERVER_NAME="${CHATHUB_SERVER_NAME:-chathub.internal}"
ADMIN="${CHATHUB_MATRIX_ADMIN:-admin}"
PASSWORD="${CHATHUB_MATRIX_ADMIN_PASSWORD:-}"
if [ -z "$PASSWORD" ]; then
  PASSWORD="$(openssl rand -hex 18)"
fi

echo "== staging source into $INSTALL"
sudo mkdir -p "$INSTALL"
sudo chown "$USER":"$USER" "$INSTALL"

# install-windows.ps1 と同じ除外リスト。
tar --exclude=.git \
    --exclude=.env \
    --exclude=node_modules \
    --exclude=ui/node_modules \
    --exclude=ui/dist \
    --exclude=ui/release \
    --exclude=gmail-proxy/creds.json \
    --exclude=chatwork-bridge/data \
    --exclude=android-twa \
    -cf /tmp/chathub-install.tar -C "$SRC" .
tar -xf /tmp/chathub-install.tar -C "$INSTALL"

mkdir -p "$INSTALL"/{synapse,webui,sygnal,bridges,gmail-proxy,bridge-links,bridge-links-data,chatwork-bridge}

if [ ! -f "$INSTALL/docker-compose.yml" ]; then
  sed "s#/opt/chathub#$INSTALL#g" "$INSTALL/infra/docker-compose.yml" > "$INSTALL/docker-compose.yml"
fi
if [ ! -f "$INSTALL/nginx-default.conf" ]; then
  cp "$INSTALL/infra/nginx-default.conf" "$INSTALL/nginx-default.conf"
fi

if [ ! -f "$INSTALL/synapse/homeserver.yaml" ]; then
  echo "== generating synapse config for $SERVER_NAME"
  docker run --rm -v "$INSTALL/synapse:/data" \
    -e SYNAPSE_SERVER_NAME="$SERVER_NAME" \
    -e SYNAPSE_REPORT_STATS=no \
    matrixdotorg/synapse:latest generate
fi

cd "$INSTALL"
docker compose config -q
echo "== starting synapse, webui, bridge-links"
docker compose up -d synapse webui bridge-links

echo "== waiting for synapse health"
for _ in $(seq 1 60); do
  if curl -fsS http://localhost:8008/health >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS http://localhost:8008/health >/dev/null

if [ ! -f "$INSTALL/credentials.txt" ]; then
  echo "== registering admin user @$ADMIN:$SERVER_NAME"
  docker exec synapse register_new_matrix_user -u "$ADMIN" -p "$PASSWORD" -a \
    -c /data/homeserver.yaml http://localhost:8008
  {
    echo "matrix user: @$ADMIN:$SERVER_NAME"
    echo "password: $PASSWORD"
    echo "homeserver URL: http://127.0.0.1:8008"
  } > "$INSTALL/credentials.txt"
  chmod 600 "$INSTALL/credentials.txt"
fi

echo "INSTALL_DONE $INSTALL"
