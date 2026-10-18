import { listCallablePatients, listCalls, startCall } from "@/lib/calls";
import { handler, json, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { startCallSchema } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export const GET = handler(async (req) => {
  const user = await requireUser(req);
  const [calls, callablePatients] = await Promise.all([
    listCalls(user, Number(req.nextUrl.searchParams.get("limit")) || 20),
    user.role === "therapist" ? listCallablePatients(user) : Promise.resolve(undefined),
  ]);
  return json({ calls, callablePatients });
});

export const POST = handler(async (req) => {
  const user = await requireUser(req);
  rateLimit(`call:${user.id}`, 20, 10 * 60 * 1000);
  const { calleeId, appointmentId } = await readJson(req, startCallSchema);
  const call = await startCall(user, calleeId, appointmentId);
  return json({ call }, 201);
});
