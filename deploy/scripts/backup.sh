#!/usr/bin/env bash
# Nightly database dump (cron) — keeps the last 14 days in deploy/backups.
source "$(dirname "$0")/lib.sh"
load_env
mkdir -p backups
chmod 700 backups
file="backups/ndiho-$(date -u +%Y%m%d-%H%M%S).sql.gz"
compose exec -T db pg_dump -U ndiho -d ndiho --no-owner | gzip > "$file"
chmod 600 "$file"
find backups -name 'ndiho-*.sql.gz' -mtime +14 -delete
ok "Backup written to deploy/$file"
# Restore: gunzip -c deploy/backups/<file> | docker compose -f deploy/docker-compose.yml exec -T db psql -U ndiho -d ndiho
