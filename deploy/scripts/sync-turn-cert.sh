#!/usr/bin/env bash
# Copies Caddy's TLS certificate for $DOMAIN to coturn (for TURN over TLS on
# port 5349) and restarts coturn when it changed. Runs daily from cron.
source "$(dirname "$0")/lib.sh"
load_env

crt=$(compose exec -T caddy sh -c "find /data/caddy/certificates -type f -name '${DOMAIN}.crt' | head -n1" 2>/dev/null || true)
if [ -z "$crt" ]; then
  warn "Caddy has no certificate for ${DOMAIN} yet"
  exit 1
fi
key="${crt%.crt}.key"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
compose cp "caddy:${crt}" "$tmp/turn.crt" >/dev/null
compose cp "caddy:${key}" "$tmp/turn.key" >/dev/null

mkdir -p turn-certs
changed=0
if ! cmp -s "$tmp/turn.crt" turn-certs/turn.crt 2>/dev/null || ! cmp -s "$tmp/turn.key" turn-certs/turn.key 2>/dev/null; then
  # coturn runs as nobody (uid 65534); the key stays private to it.
  install -m 0644 -o 65534 -g 65534 "$tmp/turn.crt" turn-certs/turn.crt
  install -m 0600 -o 65534 -g 65534 "$tmp/turn.key" turn-certs/turn.key
  changed=1
fi

if [ "$changed" = 1 ]; then
  ok "TURN certificate updated"
  if [ -n "$(compose ps -q coturn 2>/dev/null)" ]; then
    compose restart coturn >/dev/null && ok "coturn restarted"
  fi
else
  ok "TURN certificate already up to date"
fi
