import { z } from "zod";
import { ApiError, assertSameOrigin, handler, json, readJson } from "@/lib/http";
import { deleteNote, updateNote } from "@/lib/patients";
import { noteSchema } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

async function noteId(ctx: Ctx) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "NOTE_NOT_FOUND", "Note not found");
  return id;
}

export const PATCH = handler(async (req, ctx: Ctx) => {
  const user = await requireUser(req, "therapist");
  const { body } = await readJson(req, noteSchema.pick({ body: true }));
  return json({ note: await updateNote(user, await noteId(ctx), body) });
});

export const DELETE = handler(async (req, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser(req, "therapist");
  await deleteNote(user, await noteId(ctx));
  return json({ ok: true });
});
