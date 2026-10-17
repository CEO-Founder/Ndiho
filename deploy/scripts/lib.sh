# shellcheck shell=bash
# Shared helpers for the deploy scripts (sourced, not executed).
set -euo pipefail
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DEPLOY_DIR"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m !\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m ✗\033[0m %s\n' "$*" >&2; exit 1; }

load_env() {
  [ -f .env ] || die "deploy/.env not found. Run deploy/scripts/install.sh first (or copy env.example)."
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
}

compose() { docker compose "$@"; }
