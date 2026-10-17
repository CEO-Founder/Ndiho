import "server-only";
import type { PoolClient } from "pg";
import { getPool, query, queryOne, transaction, type Queryable } from "./db";
import { ApiError } from "./http";
import { publish } from "./realtime";
import type { SessionUser } from "./session";

export const RING_TIMEOUT_SECONDS = 45;
// An accepted call with no heartbeat from either side for this long is treated
// as dropped (both browsers closed without hanging up). Generous because
// browsers throttle timers in background tabs to about once a minute.
export const HEARTBEAT_TIMEOUT_SECONDS = 150;

export type CallStatus = "ringing" | "accepted" | "rejected" | "cancelled" | "missed" | "ended";

export interface CallParticipant {
  id: string;
  fullName: string;
  role: "therapist" | "patient";
}

export interface CallView {
  id: string;
  status: CallStatus;
  callerId: string;
  therapist: CallParticipant;
  patient: CallParticipant;
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  ringTimeoutSeconds: number;
}

type CallRow = {
  id: string;
  status: CallStatus;
  caller_id: string;
  therapist_id: string;
  therapist_name: string;
  patient_id: string;
  patient_name: string;
  created_at: Date;
  answered_at: Date | null;
  ended_at: Date | null;
  end_reason: string | null;
};

const CALL_SELECT = `
  select c.id, c.status, c.caller_id, c.created_at, c.answered_at, c.ended_at, c.end_reason,
         c.therapist_id, t.full_name as therapist_name,
         c.patient_id, p.full_name as patient_name
    from ndiho_calls c
    join ndiho_users t on t.id = c.therapist_id
    join ndiho_users p on p.id = c.patient_id`;

function toView(r: CallRow): CallView {
  return {
    id: r.id,
    status: r.status,
    callerId: r.caller_id,
    therapist: { id: r.therapist_id, fullName: r.therapist_name, role: "therapist" },
    patient: { id: r.patient_id, fullName: r.patient_name, role: "patient" },
    createdAt: r.created_at.toISOString(),
    answeredAt: r.answered_at?.toISOString() ?? null,
    endedAt: r.ended_at?.toISOString() ?? null,
    endReason: r.end_reason,
    ringTimeoutSeconds: RING_TIMEOUT_SECONDS,
  };
}

const otherParty = (call: CallView, userId: string) =>
  call.therapist.id === userId ? call.patient.id : call.therapist.id;

const isParticipant = (call: CallView, userId: string) =>
  call.therapist.id === userId || call.patient.id === userId;

/**
 * Closes calls that have gone stale: unanswered past the ring timeout, or
 * accepted but with no heartbeat. Runs lazily before any state transition so
 * correctness does not depend on a background job. Returns the calls it closed.
 */
async function expireStaleCalls(db: Queryable, userIds?: string[]): Promise<CallView[]> {
  const scope = userIds ? "and (therapist_id = any($1) or patient_id = any($1))" : "";
  const rows = await query<{ id: string }>(
    `update ndiho_calls
        set status = case when status = 'ringing' then 'missed' else 'ended' end,
            ended_at = now(),
            end_reason = case when status = 'ringing' then 'no_answer' else 'connection_lost' end
      where ((status = 'ringing' and created_at < now() - interval '${RING_TIMEOUT_SECONDS} seconds')
          or (status = 'accepted'
              and coalesce(last_heartbeat_at, answered_at) < now() - interval '${HEARTBEAT_TIMEOUT_SECONDS} seconds'))
        ${scope}
      returning id`,
    userIds ? [userIds] : [],
    db,
  );
  if (rows.length === 0) return [];
  const calls = await query<CallRow>(`${CALL_SELECT} where c.id = any($1)`, [rows.map((r) => r.id)], db);
  return calls.map(toView);
}

function notifyBoth(call: CallView) {
  publish(call.therapist.id, { type: "call.updated", call });
  publish(call.patient.id, { type: "call.updated", call });
}

async function loadCall(db: Queryable, callId: string, forUpdate = false): Promise<CallView | null> {
  const row = await queryOne<CallRow>(
    `${CALL_SELECT} where c.id = $1 ${forUpdate ? "for update of c" : ""}`,
    [callId],
    db,
  );
  return row ? toView(row) : null;
}

/** Loads a call the user participates in; 404 otherwise, so ids don't leak. */
async function loadOwnCall(db: Queryable, user: SessionUser, callId: string, forUpdate = false) {
  const call = await loadCall(db, callId, forUpdate);
  if (!call || !isParticipant(call, user.id)) {
    throw new ApiError(404, "CALL_NOT_FOUND", "Call not found");
  }
  return call;
}

/** Serialises call setup per user so two calls can't race past the busy check. */
async function lockUsers(client: PoolClient, ...userIds: string[]) {
  for (const id of [...userIds].sort()) {
    await client.query("select pg_advisory_xact_lock(hashtext('ndiho_call:' || $1))", [id]);
  }
}

// ─── Starting a call ─────────────────────────────────────────────────────────

/**
 * Who may call whom:
 * - A call is always between one therapist and one patient.
 * - Patients may call any verified, active therapist.
 * - Therapists may call a patient only if that patient has called them before
 *   (a call-back), so therapists cannot cold-call arbitrary patients.
 */
async function assertMayCall(db: Queryable, caller: SessionUser, calleeId: string) {
  const callee = await queryOne<{
    id: string;
    role: string;
    account_status: string;
    verification_status: string | null;
  }>(
    `select u.id, u.role, u.account_status, t.verification_status
       from ndiho_users u left join ndiho_therapist_profiles t on t.user_id = u.id
      where u.id = $1`,
    [calleeId],
    db,
  );
  if (!callee || callee.account_status !== "active" || callee.role === caller.role) {
    throw new ApiError(404, "CALLEE_NOT_FOUND", "This person is not available for calls");
  }
  if (caller.role === "patient") {
    if (callee.verification_status !== "verified") {
      throw new ApiError(404, "CALLEE_NOT_FOUND", "This person is not available for calls");
    }
    return;
  }
  const self = await queryOne<{ verification_status: string }>(
    "select verification_status from ndiho_therapist_profiles where user_id = $1",
    [caller.id],
    db,
  );
  if (self?.verification_status !== "verified") {
    throw new ApiError(403, "THERAPIST_NOT_VERIFIED", "Your profile must be verified before you can make calls");
  }
  const priorContact = await queryOne(
    "select 1 from ndiho_calls where therapist_id = $1 and patient_id = $2 and caller_id = $2 limit 1",
    [caller.id, calleeId],
    db,
  );
  if (!priorContact) {
    throw new ApiError(403, "NO_RELATIONSHIP", "You can only call patients who have contacted you");
  }
}

export async function startCall(caller: SessionUser, calleeId: string): Promise<CallView> {
  if (calleeId === caller.id) throw new ApiError(400, "INVALID_CALLEE", "You cannot call yourself");

  const { call, expired } = await transaction(async (client) => {
    await assertMayCall(client, caller, calleeId);
    await lockUsers(client, caller.id, calleeId);
    const expired = await expireStaleCalls(client, [caller.id, calleeId]);

    const busy = await query<{ therapist_id: string; patient_id: string }>(
      `select therapist_id, patient_id from ndiho_calls
        where status in ('ringing', 'accepted')
          and (therapist_id = any($1) or patient_id = any($1))`,
      [[caller.id, calleeId]],
      client,
    );
    if (busy.some((b) => b.therapist_id === caller.id || b.patient_id === caller.id)) {
      throw new ApiError(409, "ALREADY_IN_CALL", "You are already in a call");
    }
    if (busy.length > 0) {
      throw new ApiError(409, "CALLEE_BUSY", "They are on another call. Please try again shortly.");
    }

    const [therapistId, patientId] =
      caller.role === "therapist" ? [caller.id, calleeId] : [calleeId, caller.id];
    const { rows } = await client.query<{ id: string }>(
      `insert into ndiho_calls (therapist_id, patient_id, caller_id) values ($1, $2, $3) returning id`,
      [therapistId, patientId, caller.id],
    );
    return { call: (await loadCall(client, rows[0].id))!, expired };
  });

  expired.forEach(notifyBoth);
  publish(calleeId, { type: "call.incoming", call });
  return call;
}

// ─── Transitions ─────────────────────────────────────────────────────────────

export async function getCall(user: SessionUser, callId: string): Promise<CallView> {
  const expired = await expireStaleCalls(getPool(), [user.id]);
  expired.forEach(notifyBoth);
  return loadOwnCall(getPool(), user, callId);
}

export async function acceptCall(user: SessionUser, callId: string): Promise<CallView> {
  return transition(user, callId, (call) => {
    if (call.callerId === user.id) {
      throw new ApiError(403, "NOT_CALLEE", "Only the person being called can accept");
    }
    requireStatus(call, ["ringing"]);
    return { sql: "status = 'accepted', answered_at = now(), last_heartbeat_at = now()" };
  });
}

export async function rejectCall(user: SessionUser, callId: string): Promise<CallView> {
  return transition(user, callId, (call) => {
    if (call.callerId === user.id) {
      throw new ApiError(403, "NOT_CALLEE", "Only the person being called can decline");
    }
    requireStatus(call, ["ringing"]);
    return { sql: "status = 'rejected', ended_at = now(), ended_by = $2, end_reason = 'declined'" };
  });
}

/** Hang up: cancels an outgoing ringing call, or ends an accepted one. */
export async function endCall(user: SessionUser, callId: string): Promise<CallView> {
  return transition(user, callId, (call) => {
    if (call.status === "ringing") {
      if (call.callerId !== user.id) {
        throw new ApiError(409, "USE_REJECT", "Decline the call instead");
      }
      return { sql: "status = 'cancelled', ended_at = now(), ended_by = $2, end_reason = 'cancelled'" };
    }
    if (call.status === "accepted") {
      return { sql: "status = 'ended', ended_at = now(), ended_by = $2, end_reason = 'hung_up'" };
    }
    // Already over: hanging up again is a harmless no-op.
    return null;
  });
}

export async function heartbeat(user: SessionUser, callId: string): Promise<CallView> {
  return transition(
    user,
    callId,
    (call) => {
      requireStatus(call, ["accepted"]);
      return { sql: "last_heartbeat_at = now()" };
    },
    { notify: false },
  );
}

function requireStatus(call: CallView, allowed: CallStatus[]) {
  if (!allowed.includes(call.status)) {
    throw new ApiError(409, "INVALID_CALL_STATE", `This call is ${call.status}`, { status: call.status });
  }
}

async function transition(
  user: SessionUser,
  callId: string,
  decide: (call: CallView) => { sql: string } | null,
  opts: { notify?: boolean } = {},
): Promise<CallView> {
  let changed = false;
  const { call, expired } = await transaction(async (client) => {
    const expired = await expireStaleCalls(client, [user.id]);
    const current = await loadOwnCall(client, user, callId, true);
    const update = decide(current);
    if (!update) return { call: current, expired };
    // $1 is the call id; updates that record who acted reference $2.
    const params = update.sql.includes("$2") ? [callId, user.id] : [callId];
    await client.query(`update ndiho_calls set ${update.sql} where id = $1`, params);
    changed = true;
    return { call: (await loadCall(client, callId))!, expired };
  });
  expired.forEach(notifyBoth);
  if (changed && opts.notify !== false) notifyBoth(call);
  return call;
}

// ─── Signaling relay ─────────────────────────────────────────────────────────

/**
 * Relays WebRTC signaling (SDP offers/answers, ICE candidates) to the other
 * participant. Only allowed while the call is accepted and only between its
 * two participants; the payload is opaque to the server.
 */
export async function relaySignal(
  user: SessionUser,
  callId: string,
  kind: string,
  data: unknown,
): Promise<{ delivered: boolean }> {
  const call = await loadOwnCall(getPool(), user, callId);
  requireStatus(call, ["accepted"]);
  const delivered = publish(otherParty(call, user.id), {
    type: "call.signal",
    callId,
    from: user.id,
    kind,
    data,
  });
  return { delivered: delivered > 0 };
}

// ─── History ─────────────────────────────────────────────────────────────────

export async function listCalls(user: SessionUser, limit = 20): Promise<CallView[]> {
  const expired = await expireStaleCalls(getPool(), [user.id]);
  expired.forEach(notifyBoth);
  const rows = await query<CallRow>(
    `${CALL_SELECT} where c.therapist_id = $1 or c.patient_id = $1 order by c.created_at desc limit $2`,
    [user.id, Math.min(Math.max(limit, 1), 100)],
  );
  return rows.map(toView);
}

/** Patients who have reached out to this therapist, and so may be called back. */
export async function listCallablePatients(therapist: SessionUser): Promise<CallParticipant[]> {
  const rows = await query<{ id: string; full_name: string }>(
    `select u.id, u.full_name
       from ndiho_users u
      where u.account_status = 'active'
        and exists (select 1 from ndiho_calls c
                     where c.therapist_id = $1 and c.patient_id = u.id and c.caller_id = u.id)
      order by u.full_name`,
    [therapist.id],
  );
  return rows.map((r) => ({ id: r.id, fullName: r.full_name, role: "patient" as const }));
}

