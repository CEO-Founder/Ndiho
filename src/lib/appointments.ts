import "server-only";
import type { PoolClient } from "pg";
import { isUniqueViolation, query, queryOne, transaction, type Queryable } from "./db";
import { ApiError } from "./http";
import { publish } from "./realtime";
import { SESSION_MINUTES, SLOT_STEP_MINUTES, type ServiceId } from "./schemas";
import type { SessionUser } from "./session";
import { addDays, minuteLabel, platformTimezone, weekdayOf, zonedDate, zonedToUtc } from "./time";

/** Booking opens this far ahead of a slot and closes this long before it. */
export const BOOKING_DAYS = 14;
export const MIN_LEAD_MINUTES = 60;
/** Participants can join from 10 min before the start until 15 min after the end. */
export const JOIN_EARLY_MINUTES = 10;
export const JOIN_GRACE_MINUTES = 15;

export interface AvailabilityWindow {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface Slot {
  startsAt: string;
  label: string;
}

export interface DaySlots {
  date: string;
  weekday: number;
  slots: Slot[];
}

export type AppointmentStatus = "booked" | "cancelled" | "completed";

export interface AppointmentView {
  id: string;
  service: ServiceId;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: AppointmentStatus;
  therapist: { id: string; fullName: string };
  patient: { id: string; fullName: string };
  patientNote: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
  sessionHeld: boolean;
  joinOpensAt: string;
  joinClosesAt: string;
}

// ─── Availability ────────────────────────────────────────────────────────────

export async function getAvailability(therapistId: string, db?: Queryable): Promise<AvailabilityWindow[]> {
  const rows = await query<{ weekday: number; start_minute: number; end_minute: number }>(
    `select weekday, start_minute, end_minute from ndiho_availability
      where therapist_id = $1 order by weekday, start_minute`,
    [therapistId],
    db,
  );
  return rows.map((r) => ({ weekday: r.weekday, startMinute: r.start_minute, endMinute: r.end_minute }));
}

/** Replaces the therapist's weekly availability. Existing bookings are kept. */
export async function setAvailability(therapist: SessionUser, windows: AvailabilityWindow[]) {
  if (therapist.role !== "therapist") throw new ApiError(403, "FORBIDDEN", "Only therapists have availability");
  await transaction(async (client) => {
    await client.query("delete from ndiho_availability where therapist_id = $1", [therapist.id]);
    for (const w of windows) {
      await client.query(
        `insert into ndiho_availability (therapist_id, weekday, start_minute, end_minute) values ($1, $2, $3, $4)`,
        [therapist.id, w.weekday, w.startMinute, w.endMinute],
      );
    }
  });
  return getAvailability(therapist.id);
}

// ─── Slots ───────────────────────────────────────────────────────────────────

async function assertBookableTherapist(therapistId: string, db?: Queryable) {
  const row = await queryOne(
    `select 1 from ndiho_users u join ndiho_therapist_profiles t on t.user_id = u.id
      where u.id = $1 and u.account_status = 'active' and t.verification_status = 'verified'`,
    [therapistId],
    db,
  );
  if (!row) throw new ApiError(404, "THERAPIST_NOT_FOUND", "This therapist is not available for booking");
}

/** Open slots for the next BOOKING_DAYS days (platform time zone). */
export async function getSlots(therapistId: string, now = new Date(), db?: Queryable): Promise<DaySlots[]> {
  await assertBookableTherapist(therapistId, db);
  const tz = platformTimezone();
  const windows = await getAvailability(therapistId, db);
  const today = zonedDate(now, tz);
  const horizon = new Date(now.getTime() + (BOOKING_DAYS + 1) * 86400000);
  const taken = new Set(
    (
      await query<{ starts_at: Date }>(
        `select starts_at from ndiho_appointments
          where therapist_id = $1 and status = 'booked' and starts_at between $2 and $3`,
        [therapistId, now, horizon],
        db,
      )
    ).map((r) => r.starts_at.getTime()),
  );
  const earliest = now.getTime() + MIN_LEAD_MINUTES * 60000;

  const days: DaySlots[] = [];
  for (let i = 0; i < BOOKING_DAYS; i++) {
    const date = addDays(today, i);
    const weekday = weekdayOf(date);
    const slots: Slot[] = [];
    for (const w of windows.filter((x) => x.weekday === weekday)) {
      for (let m = w.startMinute; m + SESSION_MINUTES <= w.endMinute; m += SLOT_STEP_MINUTES) {
        const at = zonedToUtc(date, m, tz);
        if (at.getTime() < earliest || taken.has(at.getTime())) continue;
        slots.push({ startsAt: at.toISOString(), label: minuteLabel(m) });
      }
    }
    slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    days.push({ date, weekday, slots });
  }
  return days;
}

// ─── Appointments ────────────────────────────────────────────────────────────

type AppointmentRow = {
  id: string;
  service: ServiceId;
  starts_at: Date;
  duration_minutes: number;
  status: AppointmentStatus;
  therapist_id: string;
  therapist_name: string;
  patient_id: string;
  patient_name: string;
  patient_note: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  created_at: Date;
  session_held: boolean;
};

const APPOINTMENT_SELECT = `
  select a.id, a.service, a.starts_at, a.duration_minutes, a.status, a.patient_note,
         a.cancelled_by, a.cancel_reason, a.created_at,
         a.therapist_id, t.full_name as therapist_name,
         a.patient_id, p.full_name as patient_name,
         exists (select 1 from ndiho_calls c where c.appointment_id = a.id and c.answered_at is not null) as session_held
    from ndiho_appointments a
    join ndiho_users t on t.id = a.therapist_id
    join ndiho_users p on p.id = a.patient_id`;

function toView(r: AppointmentRow): AppointmentView {
  const start = r.starts_at.getTime();
  const end = start + r.duration_minutes * 60000;
  return {
    id: r.id,
    service: r.service,
    startsAt: r.starts_at.toISOString(),
    endsAt: new Date(end).toISOString(),
    durationMinutes: r.duration_minutes,
    status: r.status,
    therapist: { id: r.therapist_id, fullName: r.therapist_name },
    patient: { id: r.patient_id, fullName: r.patient_name },
    patientNote: r.patient_note,
    cancelledBy: r.cancelled_by,
    cancelReason: r.cancel_reason,
    createdAt: r.created_at.toISOString(),
    sessionHeld: r.session_held,
    joinOpensAt: new Date(start - JOIN_EARLY_MINUTES * 60000).toISOString(),
    joinClosesAt: new Date(end + JOIN_GRACE_MINUTES * 60000).toISOString(),
  };
}

async function loadAppointment(id: string, db?: Queryable, forUpdate = false): Promise<AppointmentView | null> {
  const row = await queryOne<AppointmentRow>(`${APPOINTMENT_SELECT} where a.id = $1 ${forUpdate ? "for update of a" : ""}`, [id], db);
  return row ? toView(row) : null;
}

const isParticipant = (a: AppointmentView, userId: string) => a.therapist.id === userId || a.patient.id === userId;

function notify(a: AppointmentView) {
  publish(a.therapist.id, { type: "appointment.updated", appointment: a });
  publish(a.patient.id, { type: "appointment.updated", appointment: a });
}

export async function bookAppointment(
  patient: SessionUser,
  input: { therapistId: string; service: ServiceId; startsAt: string; note?: string },
  now = new Date(),
): Promise<AppointmentView> {
  if (patient.role !== "patient") throw new ApiError(403, "FORBIDDEN", "Only patients can book sessions");
  const startsAt = new Date(input.startsAt);

  const appointment = await transaction(async (client: PoolClient) => {
    // The requested time must be one of the therapist's currently open slots:
    // that checks the hourly grid, their availability, lead time and horizon.
    const days = await getSlots(input.therapistId, now, client);
    const open = days.some((d) => d.slots.some((s) => s.startsAt === startsAt.toISOString()));
    if (!open) {
      throw new ApiError(409, "SLOT_UNAVAILABLE", "That time is no longer available. Please choose another.");
    }
    try {
      const { rows } = await client.query<{ id: string }>(
        `insert into ndiho_appointments (therapist_id, patient_id, service, starts_at, duration_minutes, patient_note)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [input.therapistId, patient.id, input.service, startsAt, SESSION_MINUTES, input.note ?? null],
      );
      return (await loadAppointment(rows[0].id, client))!;
    } catch (err) {
      if (isUniqueViolation(err, "ndiho_appointments_therapist_slot_key")) {
        throw new ApiError(409, "SLOT_UNAVAILABLE", "That time was just booked by someone else. Please choose another.");
      }
      if (isUniqueViolation(err, "ndiho_appointments_patient_slot_key")) {
        throw new ApiError(409, "PATIENT_BUSY", "You already have a session at that time.");
      }
      throw err;
    }
  });
  notify(appointment);
  return appointment;
}

export async function listAppointments(
  user: SessionUser,
  opts: { scope: "upcoming" | "past" | "all"; limit?: number; withUser?: string } = { scope: "upcoming" },
): Promise<AppointmentView[]> {
  const params: unknown[] = [user.id];
  let where = "(a.therapist_id = $1 or a.patient_id = $1)";
  if (opts.withUser) {
    params.push(opts.withUser);
    where += ` and (a.therapist_id = $${params.length} or a.patient_id = $${params.length})`;
  }
  // "Upcoming" includes sessions still joinable (started less than duration + grace ago).
  const live = `a.starts_at + (a.duration_minutes + ${JOIN_GRACE_MINUTES}) * interval '1 minute' > now()`;
  if (opts.scope === "upcoming") where += ` and a.status <> 'cancelled' and ${live}`;
  if (opts.scope === "past") where += ` and (a.status = 'cancelled' or not (${live}))`;
  params.push(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  const order = opts.scope === "upcoming" ? "a.starts_at asc" : "a.starts_at desc";
  const rows = await query<AppointmentRow>(`${APPOINTMENT_SELECT} where ${where} order by ${order} limit $${params.length}`, params);
  return rows.map(toView);
}

export async function getAppointment(user: SessionUser, id: string): Promise<AppointmentView> {
  const a = await loadAppointment(id);
  if (!a || (!isParticipant(a, user.id) && user.role !== "admin")) {
    throw new ApiError(404, "APPOINTMENT_NOT_FOUND", "Appointment not found");
  }
  return a;
}

export async function cancelAppointment(user: SessionUser, id: string, reason?: string, now = new Date()) {
  const appointment = await transaction(async (client) => {
    const a = await loadAppointment(id, client, true);
    if (!a || !isParticipant(a, user.id)) throw new ApiError(404, "APPOINTMENT_NOT_FOUND", "Appointment not found");
    if (a.status !== "booked") throw new ApiError(409, "INVALID_APPOINTMENT_STATE", `This session is already ${a.status}`);
    if (new Date(a.startsAt).getTime() <= now.getTime()) {
      throw new ApiError(409, "ALREADY_STARTED", "Sessions can't be cancelled after they start");
    }
    await client.query(
      `update ndiho_appointments
          set status = 'cancelled', cancelled_by = $2, cancel_reason = $3, cancelled_at = now()
        where id = $1`,
      [id, user.id, reason ?? null],
    );
    return (await loadAppointment(id, client))!;
  });
  notify(appointment);
  return appointment;
}

/**
 * Checks that `caller` may start the video call for an appointment now, and
 * returns it. Used by the call service; the other participant is the callee.
 */
export async function appointmentForCall(
  db: Queryable,
  caller: SessionUser,
  appointmentId: string,
  calleeId: string,
  now = new Date(),
): Promise<AppointmentView> {
  const a = await loadAppointment(appointmentId, db);
  if (!a || !isParticipant(a, caller.id)) throw new ApiError(404, "APPOINTMENT_NOT_FOUND", "Appointment not found");
  const other = a.therapist.id === caller.id ? a.patient.id : a.therapist.id;
  if (other !== calleeId) throw new ApiError(400, "WRONG_PARTICIPANT", "This appointment is with someone else");
  if (a.status === "cancelled") throw new ApiError(409, "APPOINTMENT_CANCELLED", "This session was cancelled");
  const t = now.getTime();
  if (t < new Date(a.joinOpensAt).getTime()) {
    throw new ApiError(409, "TOO_EARLY", `You can join from ${JOIN_EARLY_MINUTES} minutes before the session starts`);
  }
  if (t > new Date(a.joinClosesAt).getTime()) throw new ApiError(409, "SESSION_OVER", "This session has ended");
  return a;
}

/** Marks an appointment completed once its call is answered. */
export async function markAppointmentHeld(db: Queryable, appointmentId: string) {
  await query(`update ndiho_appointments set status = 'completed' where id = $1 and status = 'booked'`, [appointmentId], db);
}

export async function reloadAndNotify(appointmentId: string) {
  const a = await loadAppointment(appointmentId);
  if (a) notify(a);
}
