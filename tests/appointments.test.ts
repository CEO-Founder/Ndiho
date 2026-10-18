import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as registerTherapist from "@/app/api/auth/register/therapist/route";
import * as registerPatient from "@/app/api/auth/register/patient/route";
import * as availability from "@/app/api/availability/route";
import * as slots from "@/app/api/therapists/[id]/slots/route";
import * as appointments from "@/app/api/appointments/route";
import * as cancel from "@/app/api/appointments/[id]/cancel/route";
import * as calls from "@/app/api/calls/route";
import * as callAction from "@/app/api/calls/[id]/[action]/route";
import * as patients from "@/app/api/patients/route";
import * as patientDetail from "@/app/api/patients/[id]/route";
import * as notes from "@/app/api/patients/[id]/notes/route";
import * as noteById from "@/app/api/notes/[id]/route";
import * as dashboard from "@/app/api/dashboard/route";
import { getPool } from "@/lib/db";
import { subscribe, type RealtimeEvent } from "@/lib/realtime";
import { call, patientPayload, therapistPayload, verifyTherapist } from "./helpers";

interface Actor {
  id: string;
  cookie: string;
  events: RealtimeEvent[];
}
const stops: (() => void)[] = [];

async function actor(kind: "therapist" | "patient", verified = true): Promise<Actor> {
  const res =
    kind === "therapist"
      ? await call(registerTherapist.POST, "POST", "/r", { body: therapistPayload() })
      : await call(registerPatient.POST, "POST", "/r", { body: patientPayload() });
  expect(res.status).toBe(201);
  if (kind === "therapist" && verified) await verifyTherapist(res.json.user.id);
  const events: RealtimeEvent[] = [];
  stops.push(subscribe(res.json.user.id, (e) => events.push(e)));
  return { id: res.json.user.id, cookie: res.cookie!, events };
}

const ALL_WEEK_MORNINGS = Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 9 * 60, endMinute: 12 * 60 }));

async function openSlots(who: Actor, therapistId: string) {
  const res = await call(slots.GET, "GET", "/s", { cookie: who.cookie, params: { id: therapistId } });
  expect(res.status).toBe(200);
  return res.json.days.flatMap((d: { slots: { startsAt: string; label: string }[] }) => d.slots) as {
    startsAt: string;
    label: string;
  }[];
}

const book = (who: Actor, therapistId: string, startsAt: string, service = "individual") =>
  call(appointments.POST, "POST", "/a", { cookie: who.cookie, body: { therapistId, service, startsAt, note: "First session" } });

let therapist: Actor;
let patient: Actor;
let other: Actor;

beforeAll(async () => {
  therapist = await actor("therapist");
  patient = await actor("patient");
  other = await actor("patient");
  const res = await call(availability.PUT, "PUT", "/av", { cookie: therapist.cookie, body: { windows: ALL_WEEK_MORNINGS } });
  expect(res.status).toBe(200);
});

afterAll(async () => {
  stops.forEach((s) => s());
  await getPool().end();
});

describe("availability", () => {
  it("rejects overlapping or too-short windows, and is therapist-only", async () => {
    const overlap = await call(availability.PUT, "PUT", "/av", {
      cookie: therapist.cookie,
      body: { windows: [{ weekday: 1, startMinute: 540, endMinute: 720 }, { weekday: 1, startMinute: 660, endMinute: 780 }] },
    });
    expect(overlap.status).toBe(400);
    const short = await call(availability.PUT, "PUT", "/av", {
      cookie: therapist.cookie,
      body: { windows: [{ weekday: 1, startMinute: 540, endMinute: 560 }] },
    });
    expect(short.status).toBe(400);
    const asPatient = await call(availability.PUT, "PUT", "/av", { cookie: patient.cookie, body: { windows: [] } });
    expect(asPatient.status).toBe(403);
    const mine = await call(availability.GET, "GET", "/av", { cookie: therapist.cookie });
    expect(mine.json.windows).toHaveLength(7);
  });

  it("offers hourly slots in Kigali time over the next 14 days", async () => {
    const list = await openSlots(patient, therapist.id);
    expect(list.length).toBeGreaterThan(30);
    for (const s of list) {
      expect(["09:00", "10:00", "11:00"]).toContain(s.label);
      // Kigali is UTC+2 all year: 09:00 local = 07:00Z.
      const utcHour = new Date(s.startsAt).getUTCHours();
      expect(utcHour).toBe(Number(s.label.slice(0, 2)) - 2);
      expect(new Date(s.startsAt).getTime()).toBeGreaterThan(Date.now() + 59 * 60000);
    }
    const unverified = await actor("therapist", false);
    const res = await call(slots.GET, "GET", "/s", { cookie: patient.cookie, params: { id: unverified.id } });
    expect(res.status).toBe(404);
  });
});

describe("booking", () => {
  it("books an open slot, notifies the therapist, and blocks double-booking", async () => {
    const [slot] = await openSlots(patient, therapist.id);
    const res = await book(patient, therapist.id, slot.startsAt);
    expect(res.status).toBe(201);
    expect(res.json.appointment).toMatchObject({
      status: "booked",
      service: "individual",
      startsAt: slot.startsAt,
      durationMinutes: 50,
      patientNote: "First session",
      therapist: { id: therapist.id },
      patient: { id: patient.id },
    });
    expect(therapist.events.at(-1)).toMatchObject({ type: "appointment.updated" });

    const again = await book(other, therapist.id, slot.startsAt);
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("SLOT_UNAVAILABLE");
    expect((await openSlots(patient, therapist.id)).map((s) => s.startsAt)).not.toContain(slot.startsAt);
  });

  it("lets only one of two simultaneous bookings win", async () => {
    const t2 = await actor("therapist");
    await call(availability.PUT, "PUT", "/av", { cookie: t2.cookie, body: { windows: ALL_WEEK_MORNINGS } });
    const [slot] = await openSlots(patient, t2.id);
    const results = await Promise.all([book(patient, t2.id, slot.startsAt), book(other, t2.id, slot.startsAt)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it("rejects times outside availability, wrong roles and invalid input", async () => {
    const offGrid = new Date(Date.now() + 3 * 86400000);
    offGrid.setUTCHours(7, 30, 0, 0);
    expect((await book(patient, therapist.id, offGrid.toISOString())).json.error.code).toBe("SLOT_UNAVAILABLE");
    const night = new Date(Date.now() + 3 * 86400000);
    night.setUTCHours(20, 0, 0, 0);
    expect((await book(patient, therapist.id, night.toISOString())).status).toBe(409);
    const [slot] = await openSlots(patient, therapist.id);
    expect((await book(therapist, therapist.id, slot.startsAt)).status).toBe(403);
    expect((await book(patient, therapist.id, slot.startsAt, "group")).status).toBe(400);
  });

  it("lists upcoming sessions for both sides and lets either cancel before the start", async () => {
    const mine = await call(appointments.GET, "GET", "/a", { cookie: patient.cookie });
    const theirs = await call(appointments.GET, "GET", "/a", { cookie: therapist.cookie });
    expect(mine.json.appointments).toHaveLength(1);
    expect(theirs.json.appointments.map((a: { id: string }) => a.id)).toEqual(mine.json.appointments.map((a: { id: string }) => a.id));
    const appt = mine.json.appointments[0];

    const stranger = await call(cancel.POST, "POST", "/c", { cookie: other.cookie, params: { id: appt.id }, body: {} });
    expect(stranger.status).toBe(404);
    const done = await call(cancel.POST, "POST", "/c", {
      cookie: therapist.cookie,
      params: { id: appt.id },
      body: { reason: "Unwell today" },
    });
    expect(done.json.appointment).toMatchObject({ status: "cancelled", cancelReason: "Unwell today", cancelledBy: therapist.id });
    expect(patient.events.at(-1)).toMatchObject({ type: "appointment.updated" });
    // The slot is bookable again, and the cancelled session moves to "past".
    expect((await openSlots(other, therapist.id)).map((s) => s.startsAt)).toContain(appt.startsAt);
    const past = await call(appointments.GET, "GET", "/a?scope=past", { cookie: patient.cookie });
    expect(past.json.appointments[0]).toMatchObject({ id: appt.id, status: "cancelled" });
    const twice = await call(cancel.POST, "POST", "/c", { cookie: patient.cookie, params: { id: appt.id }, body: {} });
    expect(twice.status).toBe(409);
  });
});

describe("joining a booked session", () => {
  it("allows the call only inside the join window and marks the session held", async () => {
    const t = await actor("therapist");
    const p = await actor("patient");
    const insert = (minutesFromNow: number) =>
      getPool()
        .query<{ id: string }>(
          `insert into ndiho_appointments (therapist_id, patient_id, service, starts_at)
           values ($1, $2, 'individual', now() + $3 * interval '1 minute') returning id`,
          [t.id, p.id, minutesFromNow],
        )
        .then((r) => r.rows[0].id);

    // Without a booking (or prior call) the therapist can't call this patient.
    const cold = await call(calls.POST, "POST", "/calls", { cookie: t.cookie, body: { calleeId: p.id } });
    expect(cold.json.error.code).toBe("NO_RELATIONSHIP");

    const later = await insert(120);
    const early = await call(calls.POST, "POST", "/calls", { cookie: t.cookie, body: { calleeId: p.id, appointmentId: later } });
    expect(early.json.error.code).toBe("TOO_EARLY");

    const soon = await insert(5);
    const wrongPerson = await call(calls.POST, "POST", "/calls", { cookie: t.cookie, body: { calleeId: patient.id, appointmentId: soon } });
    expect(wrongPerson.status).toBe(400);

    const started = await call(calls.POST, "POST", "/calls", { cookie: t.cookie, body: { calleeId: p.id, appointmentId: soon } });
    expect(started.status).toBe(201);
    expect(started.json.call.appointmentId).toBe(soon);
    const id = started.json.call.id;
    await call(callAction.POST, "POST", "/x", { cookie: p.cookie, params: { id, action: "accept" }, body: {} });
    await call(callAction.POST, "POST", "/x", { cookie: p.cookie, params: { id, action: "end" }, body: {} });

    const list = await call(appointments.GET, "GET", "/a", { cookie: p.cookie });
    expect(list.json.appointments.find((a: { id: string }) => a.id === soon)).toMatchObject({ status: "completed", sessionHeld: true });
    const stats = await call(dashboard.GET, "GET", "/d", { cookie: t.cookie });
    expect(stats.json.stats).toMatchObject({ sessionsThisWeek: 1, upcomingSessions: 1, patients: 1 });
  });
});

describe("patients and private notes", () => {
  it("shows a therapist only their own patients, with private notes", async () => {
    const t = await actor("therapist");
    await call(availability.PUT, "PUT", "/av", { cookie: t.cookie, body: { windows: ALL_WEEK_MORNINGS } });
    const p = await actor("patient");
    const [slot] = await openSlots(p, t.id);
    await book(p, t.id, slot.startsAt);

    const list = await call(patients.GET, "GET", "/p", { cookie: t.cookie });
    expect(list.json.patients).toEqual([expect.objectContaining({ id: p.id, nextAppointmentAt: slot.startsAt, sessionsHeld: 0 })]);
    expect((await call(patients.GET, "GET", "/p", { cookie: p.cookie })).status).toBe(403);

    const added = await call(notes.POST, "POST", "/n", { cookie: t.cookie, params: { id: p.id }, body: { body: "Discussed sleep." } });
    expect(added.status).toBe(201);
    const detail = await call(patientDetail.GET, "GET", "/pd", { cookie: t.cookie, params: { id: p.id } });
    expect(detail.json.patient.id).toBe(p.id);
    expect(detail.json.appointments).toHaveLength(1);
    expect(detail.json.notes.map((n: { body: string }) => n.body)).toEqual(["Discussed sleep."]);

    // Another therapist can't see this patient or touch the note.
    const stranger = therapist;
    expect((await call(patientDetail.GET, "GET", "/pd", { cookie: stranger.cookie, params: { id: p.id } })).status).toBe(404);
    expect((await call(notes.POST, "POST", "/n", { cookie: stranger.cookie, params: { id: p.id }, body: { body: "x" } })).status).toBe(404);
    const noteId = added.json.note.id;
    expect((await call(noteById.PATCH, "PATCH", "/n", { cookie: stranger.cookie, params: { id: noteId }, body: { body: "hacked" } })).status).toBe(404);

    const edited = await call(noteById.PATCH, "PATCH", "/n", { cookie: t.cookie, params: { id: noteId }, body: { body: "Discussed sleep and work." } });
    expect(edited.json.note.body).toBe("Discussed sleep and work.");
    const del = await call(noteById.DELETE, "DELETE", "/n", { cookie: t.cookie, params: { id: noteId } });
    expect(del.status).toBe(200);
    const after = await call(patientDetail.GET, "GET", "/pd", { cookie: t.cookie, params: { id: p.id } });
    expect(after.json.notes).toEqual([]);
  });
});
