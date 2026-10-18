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

Create the first admin, then approve therapists at `/admin`:

```bash
npm run admin -- create-admin you@example.com "Your Name"   # prints a one-time password
```

The CLI can also do it: `npm run admin -- pending | verify <email> | reject <email> "<reason>"`.

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
| `/dashboard` | Stats, upcoming sessions with **Join session** / cancel, call history. Patients: therapist directory (book or call now). Therapists: verification status, patients. |
| `/book` | Booking wizard: service → therapist → date & time → confirm |
| `/availability` | Therapists: weekly availability editor |
| `/patients`, `/patients/[id]` | Therapists: patient list, session history and private session notes |
| `/admin` | Admins: platform stats, therapist review (approve / reject with reason), user search, suspend / reactivate |
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

**Appointments.** Therapists set weekly availability (Kigali time). Patients
book 50-minute sessions on the hour, up to 14 days ahead and at least an hour in
advance. Partial unique indexes make double-booking impossible even under
concurrent requests. Either side can cancel before the start. From 10 minutes
before until 15 minutes after a session, both see **Join session**, which starts
the video call linked to the appointment. That also lets a therapist call a new
patient who booked them, and an answered call marks the session as held.
Therapists keep private notes per patient that nobody else can read.

**Admins** are created with `scripts/admin.mjs create-admin`. They approve or
reject therapists (with a reason the therapist sees), suspend or reactivate
accounts (signing them out immediately), and see platform activity. Admin
accounts cannot take part in calls.

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
- Not built yet: online payment (MTN MoMo / Airtel Money / card), email or SMS reminders, email verification / password reset, social login.
