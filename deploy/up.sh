#!/bin/sh
# Starts or updates Rankflow on the VPS. GitHub Actions runs it after every push to main;
# you can also run it by hand: sh /opt/rankflow/up.sh
set -eu
cd /opt/rankflow

[ -f .env ] || { echo "Missing /opt/rankflow/.env (see deploy/HOSTINGER.md step 3)"; exit 1; }
APP_DOMAIN=$(grep -E '^APP_URL=' .env | head -1 | sed -E 's/^APP_URL=//; s/"//g; s#^https?://##; s#/.*$##')
[ -n "$APP_DOMAIN" ] || { echo "APP_URL is not set in .env"; exit 1; }

# Reuse n8n's Traefik: its network, certificate resolver and HTTPS entrypoint.
N8N=$(docker ps --format '{{.Names}}' | grep -i n8n | grep -vi traefik | head -1 || true)
[ -n "$N8N" ] || { echo "Could not find the running n8n container"; exit 1; }
LABELS=$(docker inspect "$N8N" -f '{{json .Config.Labels}}')
TRAEFIK_NET=$(docker inspect "$N8N" -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' | awk '{print $1}')
TRAEFIK_RESOLVER=$(echo "$LABELS" | grep -oE '"traefik\.http\.routers\.[^"]+\.tls\.certresolver":"[^"]+"' | head -1 | sed -E 's/.*:"([^"]+)"$/\1/' || true)
TRAEFIK_ENTRYPOINT=$(echo "$LABELS" | grep -oE '"traefik\.http\.routers\.[^"]+\.entrypoints":"[^"]+"' | head -1 | sed -E 's/.*:"([^"]+)"$/\1/' || true)

cat > .deploy.env <<ENV
IMAGE=${IMAGE:-ghcr.io/digitaloasisae-debu/seo-crm-dashboard:latest}
APP_DOMAIN=$APP_DOMAIN
TRAEFIK_NET=$TRAEFIK_NET
TRAEFIK_RESOLVER=${TRAEFIK_RESOLVER:-mytlschallenge}
TRAEFIK_ENTRYPOINT=${TRAEFIK_ENTRYPOINT:-websecure}
ENV
echo "Deploying to https://$APP_DOMAIN (network $TRAEFIK_NET)"

docker compose --env-file .deploy.env pull app
docker compose --env-file .deploy.env up -d --remove-orphans
docker image prune -f >/dev/null
