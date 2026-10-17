-- Ndiho Space: therapists, patients, sessions and video calls.
--
-- All tables are prefixed `ndiho_` so they can live in the same Postgres
-- (Supabase) database as HausLink without colliding with its tables.
--
-- Row Level Security is enabled with NO policies on every table. The Ndiho
-- backend connects with a privileged role (table owner) that bypasses RLS,
-- while Supabase's anon/authenticated roles exposed through PostgREST get no
-- access at all. Do not add permissive policies here: patient data must only
-- ever be read through the Ndiho API, which enforces authorization.

create extension if not exists pgcrypto;

-- ─── Users ──────────────────────────────────────────────────────────────────

create table if not exists ndiho_users (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  password_hash     text not null,
  role              text not null check (role in ('therapist', 'patient')),
  full_name         text not null check (char_length(full_name) between 2 and 120),
  phone             text,
  account_status    text not null default 'active'
                      check (account_status in ('active', 'suspended')),
  email_verified_at timestamptz,
  last_login_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ndiho_users_email_lowercase check (email = lower(email))
);

create unique index if not exists ndiho_users_email_key on ndiho_users (email);
create index if not exists ndiho_users_role_idx on ndiho_users (role);

-- ─── Therapist profiles ─────────────────────────────────────────────────────

create table if not exists ndiho_therapist_profiles (
  user_id              uuid primary key references ndiho_users (id) on delete cascade,
  professional_title   text not null,
  license_number       text not null,
  licensing_body       text not null,
  license_country      text not null check (char_length(license_country) = 2),
  years_experience     integer not null check (years_experience between 0 and 70),
  specialties          text[] not null default '{}',
  languages            text[] not null default '{}',
  bio                  text not null default '',
  session_fee_rwf      integer check (session_fee_rwf is null or session_fee_rwf >= 0),
  verification_status  text not null default 'pending'
                         check (verification_status in ('pending', 'verified', 'rejected')),
  verification_notes   text,
  verified_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- A licence can only be claimed by one account.
create unique index if not exists ndiho_therapist_license_key
  on ndiho_therapist_profiles (license_country, lower(licensing_body), lower(license_number));
create index if not exists ndiho_therapist_verification_idx
  on ndiho_therapist_profiles (verification_status);

-- ─── Patient profiles ───────────────────────────────────────────────────────

create table if not exists ndiho_patient_profiles (
  user_id                  uuid primary key references ndiho_users (id) on delete cascade,
  date_of_birth            date,
  gender                   text,
  preferred_language       text,
  country                  text check (country is null or char_length(country) = 2),
  city                     text,
  emergency_contact_name   text,
  emergency_contact_phone  text,
  consent_accepted_at      timestamptz not null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- ─── Sessions ───────────────────────────────────────────────────────────────
-- Opaque session tokens: only the SHA-256 hash is stored, so a database leak
-- does not leak usable session cookies.

create table if not exists ndiho_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references ndiho_users (id) on delete cascade,
  token_hash    text not null,
  user_agent    text,
  ip_address    text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz
);

create unique index if not exists ndiho_sessions_token_key on ndiho_sessions (token_hash);
create index if not exists ndiho_sessions_user_idx on ndiho_sessions (user_id);

-- ─── Video calls ────────────────────────────────────────────────────────────
-- ringing → accepted → ended
-- ringing → rejected | cancelled | missed

create table if not exists ndiho_calls (
  id                 uuid primary key default gen_random_uuid(),
  therapist_id       uuid not null references ndiho_users (id) on delete cascade,
  patient_id         uuid not null references ndiho_users (id) on delete cascade,
  caller_id          uuid not null references ndiho_users (id) on delete cascade,
  status             text not null default 'ringing'
                       check (status in ('ringing', 'accepted', 'rejected', 'cancelled', 'missed', 'ended')),
  created_at         timestamptz not null default now(),
  answered_at        timestamptz,
  ended_at           timestamptz,
  ended_by           uuid references ndiho_users (id) on delete set null,
  end_reason         text,
  last_heartbeat_at  timestamptz,
  constraint ndiho_calls_caller_is_participant check (caller_id in (therapist_id, patient_id)),
  constraint ndiho_calls_distinct_participants check (therapist_id <> patient_id)
);

create index if not exists ndiho_calls_therapist_idx on ndiho_calls (therapist_id, created_at desc);
create index if not exists ndiho_calls_patient_idx on ndiho_calls (patient_id, created_at desc);
create index if not exists ndiho_calls_active_idx on ndiho_calls (status)
  where status in ('ringing', 'accepted');

-- ─── Lock down PostgREST access ─────────────────────────────────────────────

alter table ndiho_users              enable row level security;
alter table ndiho_therapist_profiles enable row level security;
alter table ndiho_patient_profiles   enable row level security;
alter table ndiho_sessions           enable row level security;
alter table ndiho_calls              enable row level security;
