import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as login from "@/app/api/auth/login/route";
import * as me from "@/app/api/auth/me/route";
import * as registerTherapist from "@/app/api/auth/register/therapist/route";
import * as registerPatient from "@/app/api/auth/register/patient/route";
import * as overview from "@/app/api/admin/overview/route";
import * as therapists from "@/app/api/admin/therapists/route";
import * as decision from "@/app/api/admin/therapists/[id]/[decision]/route";
import * as users from "@/app/api/admin/users/route";
import * as userAction from "@/app/api/admin/users/[id]/[action]/route";
import * as directory from "@/app/api/therapists/route";
import * as calls from "@/app/api/calls/route";
import { getPool } from "@/lib/db";
import { call, patientPayload, therapistPayload, uniqueEmail } from "./helpers";

let admin: { id: string; cookie: string };

beforeAll(async () => {
  const email = uniqueEmail("admin");
  const password = "Adm1nPassword!";
  const { rows } = await getPool().query<{ id: string }>(
    "insert into ndiho_users (email, password_hash, role, full_name) values ($1, $2, 'admin', 'Ops Admin') returning id",
    [email, await bcrypt.hash(password, 4)],
  );
  const res = await call(login.POST, "POST", "/l", { body: { email, password } });
  expect(res.status).toBe(200);
  admin = { id: rows[0].id, cookie: res.cookie! };
});

afterAll(async () => {
  await getPool().end();
});

describe("admin access", () => {
  it("is admin-only", async () => {
    const p = await call(registerPatient.POST, "POST", "/r", { body: patientPayload() });
    expect((await call(overview.GET, "GET", "/o", { cookie: p.cookie })).status).toBe(403);
    expect((await call(overview.GET, "GET", "/o")).status).toBe(401);
    const who = await call(me.GET, "GET", "/me", { cookie: admin.cookie });
    expect(who.json.user).toMatchObject({ role: "admin", fullName: "Ops Admin" });
    expect(who.json.user.therapist).toBeUndefined();
  });

  it("can't make calls", async () => {
    const t = await call(registerTherapist.POST, "POST", "/r", { body: therapistPayload() });
    const res = await call(calls.POST, "POST", "/c", { cookie: admin.cookie, body: { calleeId: t.json.user.id } });
    expect(res.status).toBe(403);
  });
});

describe("therapist verification", () => {
  it("verifies a pending therapist, who then appears in the directory", async () => {
    const t = await call(registerTherapist.POST, "POST", "/r", { body: therapistPayload() });
    const id = t.json.user.id;
    const pending = await call(therapists.GET, "GET", "/t?status=pending", { cookie: admin.cookie });
    const row = pending.json.therapists.find((x: { id: string }) => x.id === id);
    expect(row).toMatchObject({ verificationStatus: "pending", licenseNumber: expect.any(String), email: expect.any(String) });

    const res = await call(decision.POST, "POST", "/d", { cookie: admin.cookie, params: { id, decision: "verify" }, body: {} });
    expect(res.status).toBe(200);
    const list = await call(directory.GET, "GET", "/api/therapists");
    expect(list.json.therapists.map((x: { id: string }) => x.id)).toContain(id);
  });

  it("rejects with a reason the therapist can read", async () => {
    const t = await call(registerTherapist.POST, "POST", "/r", { body: therapistPayload() });
    const id = t.json.user.id;
    const noReason = await call(decision.POST, "POST", "/d", { cookie: admin.cookie, params: { id, decision: "reject" }, body: {} });
    expect(noReason.status).toBe(400);
    await call(decision.POST, "POST", "/d", {
      cookie: admin.cookie,
      params: { id, decision: "reject" },
      body: { reason: "License number not found in the RAHPC register" },
    });
    const who = await call(me.GET, "GET", "/me", { cookie: t.cookie });
    expect(who.json.user.therapist).toMatchObject({
      verificationStatus: "rejected",
      verificationNotes: "License number not found in the RAHPC register",
    });
  });
});

describe("users and overview", () => {
  it("searches, suspends (signing the user out) and reactivates", async () => {
    const p = await call(registerPatient.POST, "POST", "/r", { body: patientPayload({ fullName: "Searchable Person" }) });
    const found = await call(users.GET, "GET", "/u?q=searchable%20person", { cookie: admin.cookie });
    expect(found.json.users.map((u: { id: string }) => u.id)).toContain(p.json.user.id);
    const wildcard = await call(users.GET, "GET", "/u?q=%25", { cookie: admin.cookie });
    expect(wildcard.json.users).toEqual([]);

    await call(userAction.POST, "POST", "/a", { cookie: admin.cookie, params: { id: p.json.user.id, action: "suspend" }, body: {} });
    expect((await call(me.GET, "GET", "/me", { cookie: p.cookie })).json.user).toBeNull();
    await call(userAction.POST, "POST", "/a", { cookie: admin.cookie, params: { id: p.json.user.id, action: "activate" }, body: {} });
    const relogin = await call(login.POST, "POST", "/l", { body: { email: p.json.user.email, password: "Str0ngPassw0rd" } });
    expect(relogin.status).toBe(200);

    const self = await call(userAction.POST, "POST", "/a", { cookie: admin.cookie, params: { id: admin.id, action: "suspend" }, body: {} });
    expect(self.status).toBe(400);
  });

  it("reports platform numbers", async () => {
    const res = await call(overview.GET, "GET", "/o", { cookie: admin.cookie });
    expect(res.json.overview).toMatchObject({
      patients: expect.any(Number),
      therapists: { pending: expect.any(Number), verified: expect.any(Number), rejected: expect.any(Number) },
      sessionsLast7Days: expect.any(Number),
    });
    expect(res.json.overview.therapists.rejected).toBeGreaterThanOrEqual(1);
  });
});
