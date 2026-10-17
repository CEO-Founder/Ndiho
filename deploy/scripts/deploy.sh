#!/usr/bin/env bash
# Builds and (re)starts the whole stack. Safe to run repeatedly.
source "$(dirname "$0")/lib.sh"
load_env

if [ "${SKIP_BUILD:-0}" != 1 ]; then
  log "Building the app image"
  compose build app
fi

log "Starting database, app and HTTPS proxy"
compose up -d db app caddy

log "Waiting for the app to become healthy"
for i in $(seq 1 60); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q app)" 2>/dev/null || echo starting)
  [ "$status" = healthy ] && break
  [ "$i" = 60 ] && { compose logs --tail=80 app; die "App did not become healthy"; }
  sleep 3
done
ok "App is healthy"

log "Waiting for the HTTPS certificate for ${DOMAIN}"
for i in $(seq 1 40); do
  if "$DEPLOY_DIR/scripts/sync-turn-cert.sh" >/dev/null 2>&1; then break; fi
  [ "$i" = 40 ] && { compose logs --tail=40 caddy; die "No certificate yet. Check that ${DOMAIN} points to ${PUBLIC_IP} and ports 80/443 are open."; }
  sleep 3
done
ok "Certificate ready (also installed for TURN over TLS)"

log "Starting the TURN server"
compose up -d coturn
sleep 2
[ -n "$(compose ps -q coturn)" ] || die "coturn failed to start: $(compose logs --tail=40 coturn)"
ok "coturn running"

docker image prune -f >/dev/null || true
ok "Deployed. Run deploy/scripts/verify.sh to test it end to end."
