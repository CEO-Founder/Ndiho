# Deploying NdihoSpace to a VPS

This folder deploys NdihoSpace (therapist/patient accounts + real-time video
consultations) to a single Ubuntu/Debian VPS with Docker:

| Service | What it does | Ports |
| --- | --- | --- |
| `caddy` | HTTPS with automatic Let's Encrypt certificates, reverse proxy | 80/tcp, 443/tcp+udp |
| `app` | The Next.js app (accounts, call signaling, `/` pages) | internal only |
| `db` | PostgreSQL 16 | internal only |
| `coturn` | STUN/TURN server so calls connect across any network (mobile data, NAT, firewalls) | 3478/tcp+udp, 5349/tcp+udp, 49160–49999/udp |

**How video calls work:** the two browsers send audio/video to each other
directly over WebRTC, encrypted end to end (DTLS-SRTP). The app only exchanges
the connection setup ("signaling"). When a direct path is impossible, media is
relayed through coturn over UDP, TCP, or TLS on 5349, which gets through
strict firewalls. Relayed media stays encrypted; coturn can't decrypt it.

## Before you start

1. **A VPS** running Ubuntu 22.04/24.04 (or Debian 12) with a public IPv4 address.
   2 GB RAM recommended; 1 GB works (the installer adds swap for the build).
2. **A domain/subdomain** (e.g. `app.ndihospace.com`) with an **A record → your
   VPS IP**. On Cloudflare, set it to **DNS only** (grey cloud).
   **No domain yet?** Use the free name `<your-ip-with-dashes>.sslip.io`, e.g.
   `102-202-208-135.sslip.io`. It already resolves to that IP, so it gets a normal
   trusted HTTPS certificate (browsers only allow camera/microphone over HTTPS).
   Switch to your own domain later by re-running `install.sh --domain …`.
3. **Ports open in your provider's firewall** if it has one (e.g. Hostinger
   hPanel → VPS → Firewall): TCP 22, 80, 443, 3478, 5349; UDP 443, 3478, 5349,
   49160–49999. The installer configures the VPS's own firewall (ufw).
4. Nothing else listening on ports 80/443 (stop nginx/apache if present).

## Install (copy and paste)

From your computer:

```bash
ssh root@YOUR_VPS_IP
```

On the VPS. The repository is private, so give the server a read-only deploy key:

```bash
apt-get update && apt-get install -y git
ssh-keygen -t ed25519 -f ~/.ssh/ndiho_deploy -N "" -C "ndihospace-vps"
cat ~/.ssh/ndiho_deploy.pub
```

Add that public key in GitHub: **repository → Settings → Deploy keys → Add
deploy key** (leave "Allow write access" unchecked). Then:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/ndiho_deploy
  IdentitiesOnly yes
EOF
ssh-keyscan github.com >> ~/.ssh/known_hosts

git clone git@github.com:Nshuti-Clement/Ndiho-.git /opt/ndihospace
cd /opt/ndihospace

deploy/scripts/install.sh --domain app.ndihospace.com --email you@example.com
```

`install.sh` installs Docker, adds swap if needed, writes `deploy/.env` with
generated secrets, checks DNS, configures the firewall, schedules backups and
certificate syncing, then builds and starts everything. It is safe to re-run.

Then check the whole stack:

```bash
deploy/scripts/verify.sh
```

It tests HTTPS, health, a complete call flow through your public URL
(incoming-call event → accept → signaling → hang-up), and real TURN relay
allocations over UDP, TCP and TLS. Every line must show ✓.

## Create your admin account and approve therapists

```bash
cd /opt/ndihospace/deploy
docker compose exec app node scripts/admin.mjs create-admin you@example.com "Your Name"
```

This prints a one-time password. Sign in at `https://YOUR_DOMAIN/login` to reach
the **admin dashboard** (`/admin`). Therapists register at
`/register?role=therapist` and appear there as *pending*. Check their license,
then **Approve**, or **Reject** with a reason they will see. Approved therapists
then set their weekly hours under **Availability** so patients can book them.

Command-line alternative:
`docker compose exec app node scripts/admin.mjs pending | verify <email> | reject <email> "<reason>"`.

## Test real video calls (do this before going live)

`verify.sh` proves the server side. Confirm the user experience on real
devices and networks too:

1. On a **phone using mobile data** (Wi-Fi off) and a **laptop on Wi-Fi**, sign
   in and open `https://YOUR_DOMAIN/check` → *Start test*. Expect ✅ for
   camera, microphone and at least one relay server. This is the quickest way to
   diagnose any user's connection later, too.
2. Sign in as a patient on one device and a verified therapist on the other.
   The patient presses **Video call**, the therapist **Accept**s.
3. Confirm you see and hear each other. The top-left badge shows **Direct** or
   **Relayed** (via your TURN server). Both are fine.
4. Try mute, camera off, and **End call**; the other side should update instantly.

## Day-to-day operations

All commands run on the VPS as root.

| Task | Command |
| --- | --- |
| Deploy the latest code (backs up the DB first) | `/opt/ndihospace/deploy/scripts/update.sh` |
| Status | `cd /opt/ndihospace/deploy && docker compose ps` |
| Live logs | `cd /opt/ndihospace/deploy && docker compose logs -f app` (or `caddy`, `coturn`, `db`) |
| Restart one service | `cd /opt/ndihospace/deploy && docker compose restart app` |
| End-to-end check | `/opt/ndihospace/deploy/scripts/verify.sh` |
| Backup now | `/opt/ndihospace/deploy/scripts/backup.sh` (nightly at 02:42 server time, 14 days kept in `deploy/backups/`) |
| Restore a backup | `gunzip -c deploy/backups/<file>.sql.gz \| docker compose -f deploy/docker-compose.yml exec -T db psql -U ndiho -d ndiho` |
| Copy renewed certificate to TURN | `/opt/ndihospace/deploy/scripts/sync-turn-cert.sh` (daily automatically) |
| Rotate the TURN secret (when no sessions are running) | `sed -i "s/^TURN_SECRET=.*/TURN_SECRET=$(openssl rand -hex 32)/" deploy/.env && docker compose -f deploy/docker-compose.yml up -d app coturn` |

Ongoing calls survive app restarts and updates: media doesn't pass through the
app, and the browsers reconnect their event stream on their own. If coturn
restarts, relayed calls drop to "reconnecting…" and recover on their own
within about 20 seconds.

Copy `deploy/backups/` off the server regularly (e.g. `scp -r root@YOUR_VPS_IP:/opt/ndihospace/deploy/backups .`).

## Troubleshooting video calls

| Symptom | Likely cause → fix |
| --- | --- |
| "Camera & microphone needed" | The browser blocked access. Allow camera/mic for the site (padlock icon in the address bar). On iPhone: Settings → Safari → Camera/Microphone. |
| Call rings and is accepted but stays on "Connecting securely…" | TURN unreachable. Run `verify.sh`; check the provider firewall has UDP 49160–49999, 3478 and TCP 3478, 5349 open; open `/check` on the failing device. |
| `/check` shows relay ❌ only for UDP | That network blocks UDP; calls still work over TCP/TLS (slightly higher latency). |
| `/check` shows every relay ❌ | Ports blocked on the VPS side (provider firewall) or `PUBLIC_IP`/`RELAY_IP` wrong in `deploy/.env`. Fix, then `docker compose up -d coturn`. |
| No sound on a phone | Tap **"Tap to turn on sound"** (mobile autoplay rules). |
| Incoming calls arrive late or not at all | A proxy in front is buffering. Don't put Cloudflare's proxy or another CDN in front; `verify.sh` measures this. |
| TURN TLS check fails | Run `deploy/scripts/sync-turn-cert.sh`. |
| `install.sh` stops at the DNS check | The A record doesn't point to the VPS yet (or is proxied). Wait for DNS, then re-run. |

## Configuration reference (`deploy/.env`)

| Variable | Meaning |
| --- | --- |
| `DOMAIN` | Public hostname (HTTPS + TURN) |
| `ACME_EMAIL` | Let's Encrypt account email |
| `PUBLIC_IP` | VPS public IPv4 (advertised by TURN) |
| `RELAY_IP` | Address of the main network interface (TURN relays from it); same as `PUBLIC_IP` unless the provider uses NAT |
| `POSTGRES_PASSWORD`, `TURN_SECRET` | Generated secrets (hex only). Keep `deploy/.env` private (mode 600). |
| `TURN_MIN_PORT`, `TURN_MAX_PORT` | Relay UDP port range (must match the firewall) |
| `NDIHO_ICE_TRANSPORT_POLICY` | `all` (default). Set `relay` temporarily to force every call through TURN when testing. |

Important: run **one** `app` container. Call signaling is delivered inside the
app process; scaling to several instances needs a shared message bus first (see
the root `README.md`).
