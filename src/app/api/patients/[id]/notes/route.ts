import { z } from "zod";
import { ApiError, handler, json, readJson } from "@/lib/http";
import { addNote } from "@/lib/patients";
import { noteSchema } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(req, "therapist");
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "PATIENT_NOT_FOUND", "Patient not found");
  const { body, appointmentId } = await readJson(req, noteSchema);
  return json({ note: await addNote(user, id, body, appointmentId) }, 201);
});
