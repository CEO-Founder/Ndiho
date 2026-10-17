import { limitRegistrations, signInResponse } from "@/lib/auth-routes";
import { handler, readJson } from "@/lib/http";
import { patientRegistrationSchema } from "@/lib/schemas";
import { registerPatient } from "@/lib/users";

export const POST = handler(async (req) => {
  limitRegistrations(req);
  const data = await readJson(req, patientRegistrationSchema);
  const userId = await registerPatient(data);
  return signInResponse(req, userId, 201);
});
