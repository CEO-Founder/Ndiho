#!/usr/bin/env bash
# Pulls the latest code and redeploys. Migrations run automatically on start.
source "$(dirname "$0")/lib.sh"
log "Pulling latest code"
git -C "$DEPLOY_DIR/.." pull --ff-only
"$DEPLOY_DIR/scripts/backup.sh"
"$DEPLOY_DIR/scripts/deploy.sh"
