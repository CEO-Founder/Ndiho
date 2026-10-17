import { z } from "zod";
import { ApiError, handler, json } from "@/lib/http";
import { getVerifiedTherapist } from "@/lib/users";

export const GET = handler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const therapist = z.uuid().safeParse(id).success ? await getVerifiedTherapist(id) : null;
  if (!therapist) throw new ApiError(404, "NOT_FOUND", "Therapist not found");
  return json({ therapist });
});
