import { ApiError, handler, json, readJson } from "@/lib/http";
import { patientProfileUpdateSchema, therapistProfileUpdateSchema } from "@/lib/schemas";
import { requireUser } from "@/lib/session";
import { getAccount, updatePatientProfile, updateTherapistProfile } from "@/lib/users";

export const GET = handler(async (req) => {
  const user = await requireUser(req);
  const account = await getAccount(user.id);
  if (!account) throw new ApiError(404, "NOT_FOUND", "Account not found");
  return json({ user: account });
});

export const PATCH = handler(async (req) => {
  const user = await requireUser(req);
  if (user.role === "therapist") {
    await updateTherapistProfile(user.id, await readJson(req, therapistProfileUpdateSchema));
  } else {
    await updatePatientProfile(user.id, await readJson(req, patientProfileUpdateSchema));
  }
  return json({ user: await getAccount(user.id) });
});
