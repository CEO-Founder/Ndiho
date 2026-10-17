# NdihoSpace

Confidential online therapy for Rwanda and beyond: therapists and patients
create accounts, and patients start **secure real-time video consultations**
with verified therapists.

- **Next.js 16** (App Router, standalone server) + **TypeScript** + **Tailwind CSS 4**
- **PostgreSQL** for accounts, sessions and call state
- **WebRTC** video/audio, peer-to-peer and encrypted end to end, with a
  self-hosted **coturn** STUN/TURN server so calls connect across any network
- **Caddy** for automatic HTTPS in production

## Deploying to a VPS

See **[deploy/README.md](deploy/README.md)**: one install script, then
`deploy/scripts/verify.sh` checks HTTPS, the full call flow and the TURN relay
end to end.

## Local development

```bash
npm install
cp .env.example .env            # point NDIHO_DATABASE_URL at a Postgres database
npm run db:migrate
npm run dev                     # http://localhost:3000
```

Camera access works on `localhost`; other origins need HTTPS. Without TURN
configured, calls connect between devices on the same network.

Approve a therapist (there is no admin UI yet):

```bash
npm run admin -- pending
npm run admin -- verify therapist@example.com
```

Checks:

```bash
npm run typecheck && npm run lint
NDIHO_TEST_DATABASE_URL=postgres://postgres@localhost:5432/ndiho_test npm test
```

The tests drop and re-create every `ndiho_` table in the test database. Use a
disposable one.

## Pages

| Path | |
| --- | --- |
| `/` | Homepage |
| `/register` (`?role=therapist`), `/login` | Accounts |
| `/dashboard` | Patients: verified-therapist directory and **Video call**. Therapists: verification status, patients, call-back. Both: call history. |
| `/call/[id]` | Video call room |
| `/check` | Camera, microphone and STUN/TURN (UDP/TCP/TLS) self-test |
| `/profile`, `/privacy` | Profile editing, privacy policy |

## How it works

**Accounts.** Passwords are hashed with bcrypt. Sessions are random tokens in
an `HttpOnly` cookie, stored only as SHA-256 hashes, and revocable server-side.
Login and registration are rate-limited. Mutations require a JSON body and a
same-site `Origin` (CSRF protection). Therapists register with license details
and stay *pending*, hidden and not callable, until verified. Changing license
details resets verification. Patients give explicit consent. Therapists see a
patient's name only.

**Calls.** `POST /api/calls` rings the callee, who is notified over their
Server-Sent Events stream (`GET /api/realtime`). The call moves through
`ringing → accepted → ended`, or ends as `rejected | cancelled | missed`. The
server relays WebRTC signaling (`POST /api/calls/:id/signal`) only between the
two participants and only while the call is accepted. Patients can call any
verified therapist; therapists can call back patients who contacted them.
Nobody can be in two calls at once.

**Connectivity.** `GET /api/ice` returns STUN/TURN servers with short-lived,
per-user TURN credentials (coturn `use-auth-secret`). Each negotiation has an
id, so stale signals are ignored. The caller restarts ICE when the connection
drops and renegotiates if it hasn't recovered within 12 s. Both sides
renegotiate after their event stream reconnects. Calls survive app restarts
(media never passes through the app) and recover from TURN server restarts.

**Scaling.** Signaling is delivered in-process, so run a single app instance
(the default deployment). To scale out, replace `src/lib/realtime.ts` with a
shared bus (Postgres `LISTEN/NOTIFY`, Redis…); callers don't change.

## Configuration

| Variable | Purpose |
| --- | --- |
| `NDIHO_DATABASE_URL` | Postgres connection string (required) |
| `NDIHO_DATABASE_CA` | Optional PEM CA to verify the database's TLS certificate |
| `NDIHO_TURN_URLS` | Comma-separated `turn:`/`turns:` URLs |
| `NDIHO_TURN_SECRET` | coturn `static-auth-secret` |
| `NDIHO_TURN_TTL_SECONDS` | TURN credential lifetime (default 12 h) |
| `NDIHO_STUN_URLS` | STUN URLs (default: Google public STUN) |
| `NDIHO_ICE_TRANSPORT_POLICY` | `relay` forces media through TURN (testing) |
| `NDIHO_ICE_SERVERS` | JSON `RTCIceServer[]` static override |
| `NDIHO_ALLOWED_ORIGINS` | Extra origins allowed to make API mutations |

The Docker deployment sets these for you from `deploy/.env`.

## Before launch

- Add a verified 24/7 crisis helpline to the footer (`src/app/page.tsx`).
- Add your contact address to the privacy policy and have it reviewed (`src/app/privacy/page.tsx`).
- Not built yet: booking & payments, admin UI, email verification / password reset, social login.
