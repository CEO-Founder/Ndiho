import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";

process.env.NDIHO_DATABASE_URL ??= process.env.NDIHO_TEST_DATABASE_URL;

const BASE = "http://localhost:3000";
let ipCounter = 0;

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export interface CallOptions {
  body?: unknown;
  cookie?: string;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  ip?: string;
}

/** Invokes a Next.js route handler in-process with a real NextRequest. */
export async function call(
  handler: unknown,
  method: string,
  path: string,
  opts: CallOptions = {},
) {
  const headers: Record<string, string> = {
    host: "localhost:3000",
    // Each request gets its own IP unless pinned, so rate limits don't bleed across tests.
    "x-forwarded-for": opts.ip ?? `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`,
    ...opts.headers,
  };
  if (opts.cookie) headers.cookie = opts.cookie;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["content-type"] ??= "application/json";
    body = JSON.stringify(opts.body);
  }
  const req = new NextRequest(new URL(path, BASE), { method, headers, body });
  const res = await (handler as Handler)(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  const setCookie = res.headers.get("set-cookie");
  const cookie = setCookie?.match(/ndiho_session=([^;]*)/)?.[1];
  return { status: res.status, json, cookie: cookie ? `ndiho_session=${cookie}` : undefined, res };
}

let seq = 0;
export const uniqueEmail = (prefix: string) => `${prefix}.${Date.now()}.${++seq}@example.com`;
export const uniqueLicense = () => `RPC-${Date.now()}-${++seq}`;

export function therapistPayload(overrides: Record<string, unknown> = {}) {
  return {
    fullName: "Dr. Amara Nkosi",
    email: uniqueEmail("therapist"),
    password: "Str0ngPassw0rd",
    phone: "+250 788 123 456",
    professionalTitle: "Clinical Psychologist",
    licenseNumber: uniqueLicense(),
    licensingBody: "Rwanda Allied Health Professions Council",
    licenseCountry: "RW",
    yearsExperience: 8,
    specialties: ["Trauma & PTSD", "Anxiety & Depression"],
    languages: ["English", "Kinyarwanda"],
    bio: "I help people recover from trauma.",
    sessionFeeRwf: 25000,
    ...overrides,
  };
}

export function patientPayload(overrides: Record<string, unknown> = {}) {
  return {
    fullName: "Aline Uwase",
    email: uniqueEmail("patient"),
    password: "Str0ngPassw0rd",
    dateOfBirth: "1995-04-12",
    preferredLanguage: "Kinyarwanda",
    country: "RW",
    city: "Kigali",
    consent: true,
    ...overrides,
  };
}

export async function verifyTherapist(userId: string) {
  await getPool().query(
    "update ndiho_therapist_profiles set verification_status = 'verified', verified_at = now() where user_id = $1",
    [userId],
  );
}

export async function db() {
  return getPool();
}
