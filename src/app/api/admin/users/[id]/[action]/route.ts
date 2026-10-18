import { z } from "zod";
import { setAccountStatus } from "@/lib/admin";
import { ApiError, handler, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/session";

// POST /api/admin/users/:id/{suspend|activate}
export const POST = handler(async (req, ctx: { params: Promise<{ id: string; action: string }> }) => {
  const admin = await requireUser(req, "admin");
  const { id, action } = await ctx.params;
  if (action !== "suspend" && action !== "activate") throw new ApiError(404, "NOT_FOUND", "Unknown action");
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "USER_NOT_FOUND", "User not found");
  await readJson(req, z.looseObject({}));
  await setAccountStatus(admin, id, action === "suspend" ? "suspended" : "active");
  return json({ ok: true });
});
