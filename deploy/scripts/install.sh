#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu/Debian VPS for NdihoSpace, then deploys it.
#   sudo deploy/scripts/install.sh --domain ndiho.example.com --email you@example.com
# Re-running is safe: existing secrets in deploy/.env are kept.
source "$(dirname "$0")/lib.sh"

DOMAIN_ARG="" EMAIL_ARG="" IP_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN_ARG="$2"; shift 2 ;;
    --email) EMAIL_ARG="$2"; shift 2 ;;
    --public-ip) IP_ARG="$2"; shift 2 ;;
    *) die "Unknown option: $1" ;;
  esac
done

[ "$(id -u)" = 0 ] || die "Run as root (sudo)."
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}${ID_LIKE:-}" in *debian*|*ubuntu*) ;; *) die "This script supports Ubuntu/Debian." ;; esac

log "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ufw jq openssl dnsutils cron >/dev/null
ok "Packages installed"

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  log "Installing Docker Engine + Compose plugin"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null
ok "Docker $(docker --version | awk '{print $3}' | tr -d ,)"

# Building the app needs ~2 GB of memory; add swap on small VPS plans.
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 3000 ] && [ "$(swapon --noheadings | wc -l)" = 0 ]; then
  log "Adding a 2 GB swap file (RAM: ${mem_mb} MB)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "Swap enabled"
fi

for port in 80 443; do
  if ss -ltnH "sport = :$port" | grep -q . && ! docker ps --format '{{.Names}}' | grep -q '^ndiho-caddy'; then
    die "Port $port is already in use ($(ss -ltnpH "sport = :$port" | head -1)). Stop that web server first (e.g. systemctl disable --now nginx apache2)."
  fi
done

log "Configuring deploy/.env"
if [ ! -f .env ]; then
  cp env.example .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 32)|" .env
  sed -i "s|^TURN_SECRET=.*|TURN_SECRET=$(openssl rand -hex 32)|" .env
  ok "Generated database password and TURN secret"
fi
chmod 600 .env
set_env() { sed -i "s|^$1=.*|$1=$2|" .env; }

domain="${DOMAIN_ARG:-$(grep -E '^DOMAIN=' .env | cut -d= -f2)}"
email="${EMAIL_ARG:-$(grep -E '^ACME_EMAIL=' .env | cut -d= -f2)}"
if [ -z "$domain" ] || [ "$domain" = ndiho.example.com ]; then read -rp "Domain for NdihoSpace (e.g. app.ndihospace.com): " domain; fi
if [ -z "$email" ] || [ "$email" = admin@example.com ]; then read -rp "Email for Let's Encrypt notices: " email; fi
public_ip="${IP_ARG:-$(curl -4fsS --max-time 10 https://api.ipify.org || true)}"
[ -n "$public_ip" ] || public_ip=$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
[ -n "$public_ip" ] || die "Could not detect the public IP; pass --public-ip"
set_env DOMAIN "$domain"
set_env ACME_EMAIL "$email"
relay_ip=$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
[ -n "$relay_ip" ] || die "Could not detect the main network interface address"
grep -q '^RELAY_IP=' .env || echo "RELAY_IP=" >> .env
set_env PUBLIC_IP "$public_ip"
set_env RELAY_IP "$relay_ip"
ok "DOMAIN=$domain PUBLIC_IP=$public_ip RELAY_IP=$relay_ip"

resolved=$(dig +short A "$domain" | tail -n1)
if [ "$resolved" != "$public_ip" ]; then
  warn "DNS: $domain resolves to '${resolved:-nothing}', expected $public_ip."
  warn "Create an A record for $domain -> $public_ip, wait for it to propagate, then re-run this script."
  warn "Using Cloudflare? Set the record to 'DNS only' (grey cloud): calls need direct access to this server."
  exit 1
fi
ok "DNS points to this server"

log "Configuring the firewall (ufw)"
# Keep SSH open on whatever port(s) sshd actually uses, so enabling ufw can't lock you out.
ssh_ports=$(sshd -T 2>/dev/null | awk '/^port /{print $2}')
for p in ${ssh_ports:-22}; do ufw allow "${p}/tcp" >/dev/null; done
ok "SSH allowed on port(s): ${ssh_ports:-22}"
ufw allow 80/tcp >/dev/null          # HTTP (certificate issuance + redirect)
ufw allow 443/tcp >/dev/null         # HTTPS
ufw allow 443/udp >/dev/null         # HTTP/3
ufw allow 3478/tcp >/dev/null        # STUN/TURN
ufw allow 3478/udp >/dev/null
ufw allow 5349/tcp >/dev/null        # TURN over TLS
ufw allow 5349/udp >/dev/null
min_port=$(grep -E '^TURN_MIN_PORT=' .env | cut -d= -f2); max_port=$(grep -E '^TURN_MAX_PORT=' .env | cut -d= -f2)
ufw allow "${min_port:-49160}:${max_port:-49999}/udp" >/dev/null   # TURN media relay
ufw --force enable >/dev/null
ok "Firewall enabled"
warn "If your provider also has a cloud firewall (e.g. Hostinger hPanel → VPS → Firewall), open the same ports there."

log "Scheduling certificate sync (daily) and database backups (nightly)"
cat > /etc/cron.d/ndiho <<CRON
SHELL=/bin/bash
17 3 * * * root $DEPLOY_DIR/scripts/sync-turn-cert.sh >> /var/log/ndiho-cron.log 2>&1
42 2 * * * root $DEPLOY_DIR/scripts/backup.sh >> /var/log/ndiho-cron.log 2>&1
CRON
ok "Cron jobs installed (/etc/cron.d/ndiho)"

"$DEPLOY_DIR/scripts/deploy.sh"
