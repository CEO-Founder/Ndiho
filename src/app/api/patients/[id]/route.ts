import { z } from "zod";
import { listAppointments } from "@/lib/appointments";
import { ApiError, handler, json } from "@/lib/http";
import { assertPatientOf, listNotes } from "@/lib/patients";
import { requireUser } from "@/lib/session";

export const GET = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(req, "therapist");
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "PATIENT_NOT_FOUND", "Patient not found");
  const patient = await assertPatientOf(user, id);
  const [appointments, notes] = await Promise.all([
    listAppointments(user, { scope: "all", withUser: id, limit: 100 }),
    listNotes(user, id),
  ]);
  return json({ patient, appointments, notes });
});
