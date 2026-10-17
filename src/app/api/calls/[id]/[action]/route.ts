import { z } from "zod";
import { acceptCall, endCall, heartbeat, rejectCall } from "@/lib/calls";
import { ApiError, handler, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/session";

const ACTIONS = { accept: acceptCall, reject: rejectCall, end: endCall, heartbeat } as const;

// POST /api/calls/:id/{accept|reject|end|heartbeat}
export const POST = handler(async (req, ctx: { params: Promise<{ id: string; action: string }> }) => {
  const { id, action } = await ctx.params;
  if (!Object.hasOwn(ACTIONS, action)) throw new ApiError(404, "NOT_FOUND", "Unknown call action");
  const fn = ACTIONS[action as keyof typeof ACTIONS];
  const user = await requireUser(req);
  await readJson(req, z.looseObject({}));
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "CALL_NOT_FOUND", "Call not found");
  return json({ call: await fn(user, id) });
});
