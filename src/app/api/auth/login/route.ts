import { signInResponse } from "@/lib/auth-routes";
import { clientIp, handler, readJson } from "@/lib/http";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/schemas";
import { verifyCredentials } from "@/lib/users";

export const POST = handler(async (req) => {
  const { email, password } = await readJson(req, loginSchema);
  const key = `login:${clientIp(req)}:${email}`;
  rateLimit(key, 10, 15 * 60 * 1000);
  const userId = await verifyCredentials(email, password);
  resetRateLimit(key);
  return signInResponse(req, userId);
});
