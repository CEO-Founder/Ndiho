import "server-only";
import { query, queryOne } from "./db";
import { ApiError } from "./http";
import type { SessionUser } from "./session";

export interface PatientSummary {
  id: string;
  fullName: string;
  sessionsHeld: number;
  lastSessionAt: string | null;
  nextAppointmentAt: string | null;
}

export interface SessionNote {
  id: string;
  body: string;
  appointmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

// A therapist's patients: anyone who booked them or called them.
const RELATIONSHIP = `
  exists (select 1 from ndiho_appointments a where a.therapist_id = $1 and a.patient_id = u.id)
  or exists (select 1 from ndiho_calls c where c.therapist_id = $1 and c.patient_id = u.id and c.caller_id = u.id)`;

function requireTherapist(user: SessionUser) {
  if (user.role !== "therapist") throw new ApiError(403, "FORBIDDEN", "Only therapists can view patients");
}

export async function listPatients(therapist: SessionUser): Promise<PatientSummary[]> {
  requireTherapist(therapist);
  const rows = await query<{
    id: string;
    full_name: string;
    sessions_held: string;
    last_session_at: Date | null;
    next_appointment_at: Date | null;
  }>(
    `select u.id, u.full_name,
            (select count(*) from ndiho_calls c where c.therapist_id = $1 and c.patient_id = u.id and c.answered_at is not null) as sessions_held,
            (select max(c.answered_at) from ndiho_calls c where c.therapist_id = $1 and c.patient_id = u.id) as last_session_at,
            (select min(a.starts_at) from ndiho_appointments a
              where a.therapist_id = $1 and a.patient_id = u.id and a.status = 'booked' and a.starts_at > now()) as next_appointment_at
       from ndiho_users u
      where u.role = 'patient' and (${RELATIONSHIP})
      order by next_appointment_at asc nulls last, last_session_at desc nulls last, u.full_name`,
    [therapist.id],
  );
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    sessionsHeld: Number(r.sessions_held),
    lastSessionAt: r.last_session_at?.toISOString() ?? null,
    nextAppointmentAt: r.next_appointment_at?.toISOString() ?? null,
  }));
}

/** Throws 404 unless this patient is one of the therapist's patients. */
export async function assertPatientOf(therapist: SessionUser, patientId: string) {
  requireTherapist(therapist);
  const row = await queryOne<{ id: string; full_name: string }>(
    `select u.id, u.full_name from ndiho_users u where u.id = $2 and u.role = 'patient' and (${RELATIONSHIP})`,
    [therapist.id, patientId],
  );
  if (!row) throw new ApiError(404, "PATIENT_NOT_FOUND", "Patient not found");
  return { id: row.id, fullName: row.full_name };
}

// ─── Private session notes ───────────────────────────────────────────────────

type NoteRow = { id: string; body: string; appointment_id: string | null; created_at: Date; updated_at: Date };
const toNote = (r: NoteRow): SessionNote => ({
  id: r.id,
  body: r.body,
  appointmentId: r.appointment_id,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

export async function listNotes(therapist: SessionUser, patientId: string): Promise<SessionNote[]> {
  await assertPatientOf(therapist, patientId);
  const rows = await query<NoteRow>(
    `select id, body, appointment_id, created_at, updated_at from ndiho_session_notes
      where therapist_id = $1 and patient_id = $2 order by created_at desc`,
    [therapist.id, patientId],
  );
  return rows.map(toNote);
}

export async function addNote(therapist: SessionUser, patientId: string, body: string, appointmentId?: string) {
  await assertPatientOf(therapist, patientId);
  if (appointmentId) {
    const ok = await queryOne(
      "select 1 from ndiho_appointments where id = $1 and therapist_id = $2 and patient_id = $3",
      [appointmentId, therapist.id, patientId],
    );
    if (!ok) throw new ApiError(400, "INVALID_APPOINTMENT", "That appointment isn't with this patient");
  }
  const row = await queryOne<NoteRow>(
    `insert into ndiho_session_notes (therapist_id, patient_id, appointment_id, body)
     values ($1, $2, $3, $4) returning id, body, appointment_id, created_at, updated_at`,
    [therapist.id, patientId, appointmentId ?? null, body],
  );
  return toNote(row!);
}

export async function updateNote(therapist: SessionUser, noteId: string, body: string) {
  requireTherapist(therapist);
  const row = await queryOne<NoteRow>(
    `update ndiho_session_notes set body = $3, updated_at = now()
      where id = $1 and therapist_id = $2 returning id, body, appointment_id, created_at, updated_at`,
    [noteId, therapist.id, body],
  );
  if (!row) throw new ApiError(404, "NOTE_NOT_FOUND", "Note not found");
  return toNote(row);
}

export async function deleteNote(therapist: SessionUser, noteId: string) {
  requireTherapist(therapist);
  const rows = await query("delete from ndiho_session_notes where id = $1 and therapist_id = $2 returning id", [noteId, therapist.id]);
  if (!rows.length) throw new ApiError(404, "NOTE_NOT_FOUND", "Note not found");
}

// ─── Dashboard numbers ───────────────────────────────────────────────────────

export interface DashboardStats {
  upcomingSessions: number;
  sessionsThisWeek: number;
  minutesThisMonth: number;
  patients?: number;
}

export async function dashboardStats(user: SessionUser): Promise<DashboardStats> {
  const col = user.role === "therapist" ? "therapist_id" : "patient_id";
  const row = await queryOne<{ upcoming: string; week: string; minutes: string | null; patients: string }>(
    `select
       (select count(*) from ndiho_appointments where ${col} = $1 and status = 'booked' and starts_at > now()) as upcoming,
       (select count(*) from ndiho_calls where ${col} = $1 and answered_at > now() - interval '7 days') as week,
       (select coalesce(sum(extract(epoch from (coalesce(ended_at, now()) - answered_at)) / 60), 0)
          from ndiho_calls where ${col} = $1 and answered_at > date_trunc('month', now())) as minutes,
       (select count(distinct patient_id) from (
          select patient_id from ndiho_appointments where therapist_id = $1
          union select patient_id from ndiho_calls where therapist_id = $1 and caller_id = patient_id) p) as patients`,
    [user.id],
  );
  return {
    upcomingSessions: Number(row!.upcoming),
    sessionsThisWeek: Number(row!.week),
    minutesThisMonth: Math.round(Number(row!.minutes ?? 0)),
    ...(user.role === "therapist" ? { patients: Number(row!.patients) } : {}),
  };
}
