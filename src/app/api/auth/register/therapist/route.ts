import { limitRegistrations, signInResponse } from "@/lib/auth-routes";
import { handler, readJson } from "@/lib/http";
import { therapistRegistrationSchema } from "@/lib/schemas";
import { registerTherapist } from "@/lib/users";

// New therapists start with verification_status = 'pending': they can sign in
// and manage their profile, but are not listed or callable until verified.
export const POST = handler(async (req) => {
  limitRegistrations(req);
  const data = await readJson(req, therapistRegistrationSchema);
  const userId = await registerTherapist(data);
  return signInResponse(req, userId, 201);
});
