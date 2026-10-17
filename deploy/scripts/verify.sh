#!/usr/bin/env bash
# End-to-end production check: HTTPS, health, a full call flow through the
# public URL (registration → incoming-call event → accept → signaling → end),
# and real TURN relay allocations over UDP, TCP and TLS.
source "$(dirname "$0")/lib.sh"
load_env
command -v jq >/dev/null || die "jq is required (apt-get install -y jq)"
# Keep going after a failed check so every problem is reported at once.
set +e +o pipefail
# shellcheck disable=SC2015  # `ok` never fails, so `a && ok || fail` is safe here

BASE="https://${DOMAIN}"
CURL=(curl -fsS --max-time 15)
[ "${VERIFY_INSECURE:-0}" = 1 ] && CURL+=(-k) && warn "Skipping TLS verification (VERIFY_INSECURE=1)"
failures=0
fail() { printf '\033[1;31m ✗\033[0m %s\n' "$*" >&2; failures=$((failures + 1)); }
work=$(mktemp -d)
cleanup() {
  compose exec -T db psql -U ndiho -d ndiho -qc "delete from ndiho_users where email like 'ndiho-verify-%@example.com'" >/dev/null 2>&1 || true
  kill "${sse_pid:-0}" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

log "Containers"
for svc in db app caddy coturn; do
  if [ -n "$(compose ps --status running -q "$svc")" ]; then ok "$svc running"; else fail "$svc is not running"; fi
done

log "HTTPS and health"
if "${CURL[@]}" "$BASE/api/health" | jq -e '.ok == true' >/dev/null; then ok "$BASE/api/health"; else fail "health check failed"; fi
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://${DOMAIN}/" || true)
[ "$code" = 308 ] || [ "$code" = 301 ] && ok "HTTP redirects to HTTPS" || fail "HTTP did not redirect to HTTPS (got $code)"
if "${CURL[@]}" -o /dev/null "$BASE/"; then ok "Homepage loads"; else fail "Homepage failed"; fi

log "Call flow through ${BASE}"
id=$(openssl rand -hex 4)
pw="Verify-${id}-Passw0rd"
t_email="ndiho-verify-t-${id}@example.com"; p_email="ndiho-verify-p-${id}@example.com"
post() { "${CURL[@]}" -H 'Content-Type: application/json' -H "Origin: $BASE" -b "$1" -c "$1" -X POST "$BASE/api$2" -d "$3"; }

post "$work/t" /auth/register/therapist "{\"fullName\":\"Verify Therapist\",\"email\":\"$t_email\",\"password\":\"$pw\",\"phone\":\"+250788000001\",\"professionalTitle\":\"Psychologist\",\"licenseNumber\":\"VERIFY-$id\",\"licensingBody\":\"Verification\",\"licenseCountry\":\"RW\",\"yearsExperience\":1,\"specialties\":[\"Anxiety & Depression\"],\"languages\":[\"English\"]}" > "$work/t.json"
t_id=$(jq -r .user.id "$work/t.json")
compose exec -T app node scripts/admin.mjs verify "$t_email" >/dev/null
post "$work/p" /auth/register/patient "{\"fullName\":\"Verify Patient\",\"email\":\"$p_email\",\"password\":\"$pw\",\"consent\":true}" > "$work/p.json"
[ -n "$t_id" ] && [ "$t_id" != null ] && ok "Registered test therapist + patient" || fail "Registration failed"

# Therapist listens for events exactly like the browser does.
sse_opts=(-sN --max-time 40)
[ "${VERIFY_INSECURE:-0}" = 1 ] && sse_opts+=(-k)
curl "${sse_opts[@]}" -b "$work/t" "$BASE/api/realtime" > "$work/sse.log" &
sse_pid=$!
sleep 2
grep -q 'event: ready' "$work/sse.log" && ok "Realtime stream connected" || fail "Realtime stream did not connect"

call_id=$(post "$work/p" /calls "{\"calleeId\":\"$t_id\"}" | jq -r .call.id)
start=$(date +%s%N)
for _ in $(seq 1 30); do grep -q "call.incoming" "$work/sse.log" && break; sleep 0.1; done
if grep -q "call.incoming" "$work/sse.log"; then
  ok "Incoming-call event delivered in $(( ($(date +%s%N) - start) / 1000000 )) ms (no proxy buffering)"
else
  fail "Incoming-call event not delivered within 3 s — check proxy buffering"
fi
[ "$(post "$work/t" "/calls/$call_id/accept" '{}' | jq -r .call.status)" = accepted ] && ok "Call accepted" || fail "Accept failed"
post "$work/p" "/calls/$call_id/signal" '{"kind":"offer","data":{"negId":1,"sdp":{"type":"offer","sdp":"verify"}}}' >/dev/null
for _ in $(seq 1 30); do grep -q "call.signal" "$work/sse.log" && break; sleep 0.1; done
grep -q '"kind":"offer"' "$work/sse.log" && ok "Signaling relayed to the other participant" || fail "Signal not relayed"
ice=$("${CURL[@]}" -b "$work/p" "$BASE/api/ice")
echo "$ice" | jq -e '.iceServers[] | select(.username) | .urls[] | select(startswith("turns:"))' >/dev/null && ok "ICE config includes TURN (UDP/TCP/TLS) with short-lived credentials" || fail "ICE config has no TURN server"
[ "$(post "$work/p" "/calls/$call_id/end" '{}' | jq -r .call.status)" = ended ] && ok "Call ended" || fail "End failed"

log "TURN relay (real allocations against ${DOMAIN})"
turn_test() {
  # Two clients allocate relays and exchange 120 packets through them. Over
  # TCP/TLS the test client drops ~1 packet per stream at startup, hence ≤5%.
  local label=$1; shift
  out=$(compose exec -T coturn timeout 40 turnutils_uclient -y -n 30 -l 170 -m 1 -W "$TURN_SECRET" -u verify "$@" "$PUBLIC_IP" 2>&1 || true)
  loss=$(echo "$out" | sed -nE 's/.*Total lost packets [0-9]+ \(([0-9.]+)%\).*/\1/p' | tail -n1)
  recv=$(echo "$out" | sed -nE 's/.*tot_recv_bytes ~ ([0-9]+).*/\1/p' | tail -n1)
  if [ -n "$loss" ] && [ "${recv:-0}" -gt 0 ] && awk "BEGIN {exit !($loss <= 5)}"; then
    ok "TURN $label: media relayed (${recv} bytes, ${loss}% loss)"
  else
    fail "TURN $label failed:"; echo "$out" | tail -n 5 >&2
  fi
}
turn_test "UDP (3478)" -p 3478
turn_test "TCP (3478)" -t -p 3478
turn_test "TLS (5349)" -t -S -p 5349
if [ "${VERIFY_INSECURE:-0}" != 1 ]; then
  if echo | timeout 10 openssl s_client -connect "${DOMAIN}:5349" -servername "$DOMAIN" -verify_return_error >/dev/null 2>&1; then
    ok "TURN TLS certificate is valid for ${DOMAIN}"
  else
    fail "TURN TLS certificate is not valid — run deploy/scripts/sync-turn-cert.sh"
  fi
fi

echo
if [ "$failures" = 0 ]; then
  ok "All checks passed. Finish with a real call between two devices on different networks (e.g. one on mobile data) and run ${BASE}/check on each."
else
  die "$failures check(s) failed"
fi
