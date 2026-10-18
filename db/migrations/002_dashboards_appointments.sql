-- Admin role, therapist availability, appointments and private session notes.

-- ─── Admin role ─────────────────────────────────────────────────────────────
-- Admins are created from the command line (scripts/admin.mjs create-admin)
-- and have no therapist/patient profile.

alter table ndiho_users drop constraint if exists ndiho_users_role_check;
alter table ndiho_users
  add constraint ndiho_users_role_check check (role in ('therapist', 'patient', 'admin'));

-- ─── Weekly availability ────────────────────────────────────────────────────
-- Times are minutes after midnight in the platform time zone (Africa/Kigali).
-- weekday: 0 = Sunday … 6 = Saturday.

create table if not exists ndiho_availability (
  id            uuid primary key default gen_random_uuid(),
  therapist_id  uuid not null references ndiho_users (id) on delete cascade,
  weekday       smallint not null check (weekday between 0 and 6),
  start_minute  smallint not null check (start_minute between 0 and 1439),
  end_minute    smallint not null check (end_minute between 1 and 1440),
  constraint ndiho_availability_range check (end_minute > start_minute)
);

create index if not exists ndiho_availability_therapist_idx on ndiho_availability (therapist_id, weekday);

-- ─── Appointments ───────────────────────────────────────────────────────────

create table if not exists ndiho_appointments (
  id                uuid primary key default gen_random_uuid(),
  therapist_id      uuid not null references ndiho_users (id) on delete cascade,
  patient_id        uuid not null references ndiho_users (id) on delete cascade,
  service           text not null,
  starts_at         timestamptz not null,
  duration_minutes  smallint not null default 50 check (duration_minutes between 15 and 180),
  status            text not null default 'booked'
                      check (status in ('booked', 'cancelled', 'completed')),
  patient_note      text,
  cancelled_by      uuid references ndiho_users (id) on delete set null,
  cancel_reason     text,
  cancelled_at      timestamptz,
  created_at        timestamptz not null default now(),
  constraint ndiho_appointments_distinct_participants check (therapist_id <> patient_id)
);

-- Sessions start on a fixed hourly grid, so a unique start time per person
-- is enough to make double-booking impossible, even under concurrent requests.
create unique index if not exists ndiho_appointments_therapist_slot_key
  on ndiho_appointments (therapist_id, starts_at) where status = 'booked';
create unique index if not exists ndiho_appointments_patient_slot_key
  on ndiho_appointments (patient_id, starts_at) where status = 'booked';
create index if not exists ndiho_appointments_therapist_idx on ndiho_appointments (therapist_id, starts_at);
create index if not exists ndiho_appointments_patient_idx on ndiho_appointments (patient_id, starts_at);

-- Calls started from an appointment remember it.
alter table ndiho_calls
  add column if not exists appointment_id uuid references ndiho_appointments (id) on delete set null;
create index if not exists ndiho_calls_appointment_idx on ndiho_calls (appointment_id);

-- ─── Private session notes ──────────────────────────────────────────────────
-- Visible only to the therapist who wrote them.

create table if not exists ndiho_session_notes (
  id              uuid primary key default gen_random_uuid(),
  therapist_id    uuid not null references ndiho_users (id) on delete cascade,
  patient_id      uuid not null references ndiho_users (id) on delete cascade,
  appointment_id  uuid references ndiho_appointments (id) on delete set null,
  body            text not null check (char_length(body) between 1 and 20000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists ndiho_session_notes_idx on ndiho_session_notes (therapist_id, patient_id, created_at desc);

alter table ndiho_availability  enable row level security;
alter table ndiho_appointments  enable row level security;
alter table ndiho_session_notes enable row level security;
