import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as registerTherapist from "@/app/api/auth/register/therapist/route";
import * as registerPatient from "@/app/api/auth/register/patient/route";
import * as calls from "@/app/api/calls/route";
import * as callById from "@/app/api/calls/[id]/route";
import * as callAction from "@/app/api/calls/[id]/[action]/route";
import * as signal from "@/app/api/calls/[id]/signal/route";
import * as realtimeRoute from "@/app/api/realtime/route";
import { getPool } from "@/lib/db";
import { subscribe, type RealtimeEvent } from "@/lib/realtime";
import { call, patientPayload, therapistPayload, verifyTherapist } from "./helpers";

interface Actor {
  id: string;
  cookie: string;
  events: RealtimeEvent[];
  stop: () => void;
}

const actors: Actor[] = [];

async function makeActor(kind: "therapist" | "patient", verified = true): Promise<Actor> {
  const res =
    kind === "therapist"
      ? await call(registerTherapist.POST, "POST", "/r", { body: therapistPayload() })
      : await call(registerPatient.POST, "POST", "/r", { body: patientPayload() });
  expect(res.status).toBe(201);
  if (kind === "therapist" && verified) await verifyTherapist(res.json.user.id);
  const events: RealtimeEvent[] = [];
  const stop = subscribe(res.json.user.id, (e) => events.push(e));
  const actor = { id: res.json.user.id, cookie: res.cookie!, events, stop };
  actors.push(actor);
  return actor;
}

const act = (actor: Actor, id: string, action: string) =>
  call(callAction.POST, "POST", `/api/calls/${id}/${action}`, {
    cookie: actor.cookie,
    params: { id, action },
    body: {},
  });

const start = (from: Actor, to: Actor) =>
  call(calls.POST, "POST", "/api/calls", { cookie: from.cookie, body: { calleeId: to.id } });

let therapist: Actor;
let patient: Actor;
let outsider: Actor;

beforeAll(async () => {
  therapist = await makeActor("therapist");
  patient = await makeActor("patient");
  outsider = await makeActor("patient");
});

afterAll(async () => {
  actors.forEach((a) => a.stop());
  await getPool().end();
});

describe("call lifecycle", () => {
  it("rings, is accepted, relays signaling, and ends", async () => {
    const started = await start(patient, therapist);
    expect(started.status).toBe(201);
    const id = started.json.call.id;
    expect(started.json.call).toMatchObject({ status: "ringing", callerId: patient.id });
    expect(therapist.events.at(-1)).toMatchObject({ type: "call.incoming", call: { id } });

    // Outsiders can't see, accept or signal on someone else's call.
    expect((await call(callById.GET, "GET", "/c", { cookie: outsider.cookie, params: { id } })).status).toBe(404);
    expect((await act(outsider, id, "accept")).status).toBe(404);
    // The caller can't accept their own call.
    expect((await act(patient, id, "accept")).status).toBe(403);
    // No signaling before the call is accepted.
    const early = await call(signal.POST, "POST", "/s", {
      cookie: patient.cookie,
      params: { id },
      body: { kind: "offer", data: { sdp: "x" } },
    });
    expect(early.status).toBe(409);

    const accepted = await act(therapist, id, "accept");
    expect(accepted.status).toBe(200);
    expect(accepted.json.call.status).toBe("accepted");
    expect(patient.events.at(-1)).toMatchObject({ type: "call.updated", call: { id, status: "accepted" } });

    const offer = { type: "offer", sdp: "v=0..." };
    const sent = await call(signal.POST, "POST", "/s", {
      cookie: patient.cookie,
      params: { id },
      body: { kind: "offer", data: offer },
    });
    expect(sent.json).toEqual({ delivered: true });
    expect(therapist.events.at(-1)).toEqual({ type: "call.signal", callId: id, from: patient.id, kind: "offer", data: offer });
    // Signals are never echoed back to the sender or leaked to others.
    expect(patient.events.some((e) => e.type === "call.signal")).toBe(false);
    expect(outsider.events.some((e) => e.type === "call.signal")).toBe(false);

    const outsiderSignal = await call(signal.POST, "POST", "/s", {
      cookie: outsider.cookie,
      params: { id },
      body: { kind: "offer", data: offer },
    });
    expect(outsiderSignal.status).toBe(404);

    expect((await act(therapist, id, "heartbeat")).status).toBe(200);

    const ended = await act(therapist, id, "end");
    expect(ended.json.call).toMatchObject({ status: "ended", endReason: "hung_up" });
    expect(patient.events.at(-1)).toMatchObject({ type: "call.updated", call: { status: "ended" } });
    // Hanging up twice is a no-op.
    expect((await act(patient, id, "end")).json.call.status).toBe("ended");

    const history = await call(calls.GET, "GET", "/api/calls", { cookie: patient.cookie });
    expect(history.json.calls[0]).toMatchObject({ id, status: "ended", therapist: { id: therapist.id } });
  });

  it("supports declining and cancelling", async () => {
    const a = await start(patient, therapist);
    // The callee declines rather than "ends" a ringing call.
    expect((await act(therapist, a.json.call.id, "end")).status).toBe(409);
    const rejected = await act(therapist, a.json.call.id, "reject");
    expect(rejected.json.call).toMatchObject({ status: "rejected", endReason: "declined" });
    expect((await act(therapist, a.json.call.id, "accept")).status).toBe(409);

    const b = await start(patient, therapist);
    const cancelled = await act(patient, b.json.call.id, "end");
    expect(cancelled.json.call).toMatchObject({ status: "cancelled" });
    expect(therapist.events.at(-1)).toMatchObject({ type: "call.updated", call: { status: "cancelled" } });
  });

  it("marks unanswered calls as missed after the ring timeout", async () => {
    const a = await start(patient, therapist);
    await getPool().query("update ndiho_calls set created_at = now() - interval '2 minutes' where id = $1", [
      a.json.call.id,
    ]);
    const late = await act(therapist, a.json.call.id, "accept");
    expect(late.status).toBe(409);
    expect(late.json.error.details.status).toBe("missed");
  });

  it("ends accepted calls whose participants stopped sending heartbeats", async () => {
    const a = await start(patient, therapist);
    await act(therapist, a.json.call.id, "accept");
    await getPool().query(
      "update ndiho_calls set last_heartbeat_at = now() - interval '5 minutes' where id = $1",
      [a.json.call.id],
    );
    // Starting a new call sweeps the stale one instead of reporting "busy".
    const next = await start(patient, therapist);
    expect(next.status).toBe(201);
    const old = await call(callById.GET, "GET", "/c", { cookie: patient.cookie, params: { id: a.json.call.id } });
    expect(old.json.call).toMatchObject({ status: "ended", endReason: "connection_lost" });
    await act(patient, next.json.call.id, "end");
  });
});

describe("call authorization", () => {
  it("prevents calling unverified therapists, patients calling patients, and cold calls", async () => {
    const pending = await makeActor("therapist", false);
    expect((await start(patient, pending)).status).toBe(404);
    expect((await start(patient, outsider)).status).toBe(404);
    expect((await start(patient, patient)).status).toBe(400);

    // A therapist cannot cold-call a patient who never contacted them...
    const cold = await start(therapist, outsider);
    expect(cold.status).toBe(403);
    expect(cold.json.error.code).toBe("NO_RELATIONSHIP");
    // ...nor call anyone while unverified.
    expect((await start(pending, patient)).status).toBe(403);

    // ...but may call back a patient who called them (even a missed call).
    const back = await start(therapist, patient);
    expect(back.status).toBe(201);
    expect(patient.events.at(-1)).toMatchObject({ type: "call.incoming", call: { callerId: therapist.id } });
    await act(therapist, back.json.call.id, "end");

    const list = await call(calls.GET, "GET", "/api/calls", { cookie: therapist.cookie });
    expect(list.json.callablePatients.map((p: { id: string }) => p.id)).toEqual([patient.id]);
    const unauth = await call(calls.GET, "GET", "/api/calls");
    expect(unauth.status).toBe(401);
  });

  it("rejects concurrent calls with busy errors, even when raced", async () => {
    const t2 = await makeActor("therapist");
    const p2 = await makeActor("patient");
    const p3 = await makeActor("patient");

    const results = await Promise.all([start(p2, t2), start(p3, t2)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.json.error.code).toBe("CALLEE_BUSY");

    const winner = results.find((r) => r.status === 201)!;
    const winnerActor = winner.json.call.patient.id === p2.id ? p2 : p3;
    expect((await start(winnerActor, therapist)).json.error.code).toBe("ALREADY_IN_CALL");
    await act(winnerActor, winner.json.call.id, "end");
    expect((await start(p3, t2)).status).toBe(201);
  });
});

describe("realtime stream", () => {
  it("requires a session and streams the user's own events", async () => {
    const unauth = await call(realtimeRoute.GET, "GET", "/api/realtime");
    expect(unauth.status).toBe(401);

    const { NextRequest } = await import("next/server");
    const controller = new AbortController();
    const req = new NextRequest("http://localhost:3000/api/realtime", {
      headers: { cookie: therapist.cookie, host: "localhost:3000" },
      signal: controller.signal,
    });
    const res = await realtimeRoute.GET(req);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    expect(first).toContain("event: ready");
    // ICE credentials are fetched per call, never pushed over the long-lived stream.
    expect(first).not.toContain("credential");

    const p = await makeActor("patient");
    const started = await start(p, therapist);
    const next = decoder.decode((await reader.read()).value);
    expect(next).toContain("event: call.incoming");
    expect(next).toContain(started.json.call.id);
    await act(p, started.json.call.id, "end");
    controller.abort();
    await reader.cancel();
  });
});
