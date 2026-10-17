import { afterAll, describe, expect, it } from "vitest";
import * as registerTherapist from "@/app/api/auth/register/therapist/route";
import * as registerPatient from "@/app/api/auth/register/patient/route";
import * as login from "@/app/api/auth/login/route";
import * as logout from "@/app/api/auth/logout/route";
import * as me from "@/app/api/auth/me/route";
import * as profile from "@/app/api/profile/route";
import * as therapists from "@/app/api/therapists/route";
import * as therapistById from "@/app/api/therapists/[id]/route";
import { getPool } from "@/lib/db";
import { call, patientPayload, therapistPayload, verifyTherapist } from "./helpers";

afterAll(async () => {
  await getPool().end();
});

describe("therapist registration", () => {
  it("creates a pending therapist, signs them in and hides them from the directory", async () => {
    const payload = therapistPayload();
    const res = await call(registerTherapist.POST, "POST", "/api/auth/register/therapist", {
      body: payload,
    });
    expect(res.status).toBe(201);
    expect(res.cookie).toBeDefined();
    expect(res.json.user).toMatchObject({
      role: "therapist",
      email: payload.email,
      phone: "+250788123456",
      therapist: { verificationStatus: "pending", specialties: payload.specialties },
    });
    expect(JSON.stringify(res.json)).not.toContain("password");

    const stored = await getPool().query("select password_hash from ndiho_users where email = $1", [
      payload.email,
    ]);
    expect(stored.rows[0].password_hash).toMatch(/^\$2[aby]\$12\$/);

    const list = await call(therapists.GET, "GET", "/api/therapists");
    expect(list.json.therapists.map((t: { id: string }) => t.id)).not.toContain(res.json.user.id);
    const one = await call(therapistById.GET, "GET", "/x", { params: { id: res.json.user.id } });
    expect(one.status).toBe(404);
  });

  it("lists verified therapists with public fields only", async () => {
    const res = await call(registerTherapist.POST, "POST", "/r", { body: therapistPayload() });
    await verifyTherapist(res.json.user.id);

    const list = await call(therapists.GET, "GET", "/api/therapists?specialty=Trauma%20%26%20PTSD");
    const entry = list.json.therapists.find((t: { id: string }) => t.id === res.json.user.id);
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty("email");
    expect(entry).not.toHaveProperty("phone");
    expect(entry).not.toHaveProperty("licenseNumber");

    const filtered = await call(therapists.GET, "GET", "/api/therapists?language=Swahili");
    expect(filtered.json.therapists.map((t: { id: string }) => t.id)).not.toContain(res.json.user.id);
  });

  it("rejects duplicate emails case-insensitively", async () => {
    const payload = therapistPayload();
    await call(registerTherapist.POST, "POST", "/r", { body: payload });
    const dup = await call(registerTherapist.POST, "POST", "/r", {
      body: therapistPayload({ email: payload.email.toUpperCase() }),
    });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("EMAIL_TAKEN");
  });

  it("rejects a licence already claimed by another account", async () => {
    const payload = therapistPayload();
    await call(registerTherapist.POST, "POST", "/r", { body: payload });
    const dupPayload = therapistPayload({ licenseNumber: payload.licenseNumber.toLowerCase() });
    const dup = await call(registerTherapist.POST, "POST", "/r", { body: dupPayload });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("LICENSE_TAKEN");
    // The transaction rolled back, so the user row was not left behind.
    const users = await getPool().query("select 1 from ndiho_users where email = $1", [dupPayload.email]);
    expect(users.rowCount).toBe(0);
  });

  it("validates professional fields and password strength", async () => {
    const res = await call(registerTherapist.POST, "POST", "/r", {
      body: therapistPayload({ password: "short", specialties: [], licenseCountry: "US", yearsExperience: -1 }),
    });
    expect(res.status).toBe(400);
    const paths = res.json.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["password", "specialties", "licenseCountry", "yearsExperience"]));
  });
});

describe("patient registration", () => {
  it("creates a patient with a profile and requires consent", async () => {
    const noConsent = await call(registerPatient.POST, "POST", "/r", {
      body: patientPayload({ consent: false }),
    });
    expect(noConsent.status).toBe(400);

    const payload = patientPayload();
    const res = await call(registerPatient.POST, "POST", "/r", { body: payload });
    expect(res.status).toBe(201);
    expect(res.json.user).toMatchObject({
      role: "patient",
      patient: { dateOfBirth: "1995-04-12", preferredLanguage: "Kinyarwanda", city: "Kigali" },
    });
    expect(res.json.user.therapist).toBeUndefined();
  });

  it("rejects under-13 patients", async () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 10);
    const res = await call(registerPatient.POST, "POST", "/r", {
      body: patientPayload({ dateOfBirth: dob.toISOString().slice(0, 10) }),
    });
    expect(res.status).toBe(400);
  });
});

describe("login, session and logout", () => {
  it("logs in, resolves the session, and revokes it on logout", async () => {
    const payload = patientPayload();
    await call(registerPatient.POST, "POST", "/r", { body: payload });

    const bad = await call(login.POST, "POST", "/l", { body: { email: payload.email, password: "Wrong1234567" } });
    expect(bad.status).toBe(401);
    const unknown = await call(login.POST, "POST", "/l", {
      body: { email: "nobody@example.com", password: "Wrong1234567" },
    });
    expect(unknown.status).toBe(401);
    expect(unknown.json.error.message).toBe(bad.json.error.message);

    const ok = await call(login.POST, "POST", "/l", {
      body: { email: `  ${payload.email.toUpperCase()} `, password: payload.password },
    });
    expect(ok.status).toBe(200);
    const cookieHeader = ok.res.headers.get("set-cookie")!;
    expect(cookieHeader).toMatch(/HttpOnly/i);
    expect(cookieHeader).toMatch(/SameSite=lax/i);

    const who = await call(me.GET, "GET", "/me", { cookie: ok.cookie });
    expect(who.json.user.email).toBe(payload.email);

    const out = await call(logout.POST, "POST", "/o", { cookie: ok.cookie, body: {} });
    expect(out.status).toBe(200);
    const after = await call(me.GET, "GET", "/me", { cookie: ok.cookie });
    expect(after.json.user).toBeNull();
    const prof = await call(profile.GET, "GET", "/p", { cookie: ok.cookie });
    expect(prof.status).toBe(401);
  });

  it("rate-limits repeated failed logins", async () => {
    const payload = patientPayload();
    await call(registerPatient.POST, "POST", "/r", { body: payload });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await call(login.POST, "POST", "/l", {
        body: { email: payload.email, password: "Wrong1234567" },
        ip: "203.0.113.9",
      });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("rejects suspended accounts and their existing sessions", async () => {
    const reg = await call(registerPatient.POST, "POST", "/r", { body: patientPayload() });
    await getPool().query("update ndiho_users set account_status = 'suspended' where id = $1", [reg.json.user.id]);
    const who = await call(me.GET, "GET", "/me", { cookie: reg.cookie });
    expect(who.json.user).toBeNull();
  });

  it("rejects cross-site and non-JSON mutations", async () => {
    const crossSite = await call(registerPatient.POST, "POST", "/r", {
      body: patientPayload(),
      headers: { origin: "https://evil.example" },
    });
    expect(crossSite.status).toBe(403);

    const form = await call(registerPatient.POST, "POST", "/r", {
      body: patientPayload(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(form.status).toBe(415);

    const sameSite = await call(registerPatient.POST, "POST", "/r", {
      body: patientPayload(),
      headers: { origin: "http://localhost:3000" },
    });
    expect(sameSite.status).toBe(201);
  });
});

describe("profile management", () => {
  it("updates therapist profile and resets verification when licence changes", async () => {
    const reg = await call(registerTherapist.POST, "POST", "/r", { body: therapistPayload() });
    await verifyTherapist(reg.json.user.id);

    const bio = await call(profile.PATCH, "PATCH", "/p", {
      cookie: reg.cookie,
      body: { bio: "Updated bio", yearsExperience: 9 },
    });
    expect(bio.status).toBe(200);
    expect(bio.json.user.therapist).toMatchObject({
      bio: "Updated bio",
      yearsExperience: 9,
      verificationStatus: "verified",
      // Omitted fields are untouched.
      specialties: ["Trauma & PTSD", "Anxiety & Depression"],
      sessionFeeRwf: 25000,
    });

    const lic = await call(profile.PATCH, "PATCH", "/p", {
      cookie: reg.cookie,
      body: { licenseNumber: "NEW-12345" },
    });
    expect(lic.json.user.therapist.verificationStatus).toBe("pending");
    expect(lic.json.user.therapist.bio).toBe("Updated bio");
  });

  it("does not let users change role-protected fields", async () => {
    const reg = await call(registerPatient.POST, "POST", "/r", { body: patientPayload() });
    const res = await call(profile.PATCH, "PATCH", "/p", {
      cookie: reg.cookie,
      body: { role: "therapist" },
    });
    expect(res.status).toBe(400);
    const patientTryingTherapistField = await call(profile.PATCH, "PATCH", "/p", {
      cookie: reg.cookie,
      body: { licenseNumber: "X-1" },
    });
    expect(patientTryingTherapistField.status).toBe(400);

    const ok = await call(profile.PATCH, "PATCH", "/p", {
      cookie: reg.cookie,
      body: { city: "Huye", emergencyContactName: "Jean", emergencyContactPhone: "+250788000111" },
    });
    expect(ok.json.user.patient).toMatchObject({
      city: "Huye",
      emergencyContactPhone: "+250788000111",
      dateOfBirth: "1995-04-12",
    });
  });
});
