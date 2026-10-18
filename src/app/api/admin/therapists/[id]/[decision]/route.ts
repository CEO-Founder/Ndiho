import { z } from "zod";
import { setVerification } from "@/lib/admin";
import { ApiError, handler, json, readJson } from "@/lib/http";
import { adminRejectSchema } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

// POST /api/admin/therapists/:id/{verify|reject}
export const POST = handler(async (req, ctx: { params: Promise<{ id: string; decision: string }> }) => {
  await requireUser(req, "admin");
  const { id, decision } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "THERAPIST_NOT_FOUND", "Therapist not found");
  if (decision === "verify") {
    await readJson(req, z.looseObject({}));
    await setVerification(id, "verified");
  } else if (decision === "reject") {
    const { reason } = await readJson(req, adminRejectSchema);
    await setVerification(id, "rejected", reason);
  } else {
    throw new ApiError(404, "NOT_FOUND", "Unknown action");
  }
  return json({ ok: true });
});
