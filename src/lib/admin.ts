import "server-only";
import { query, queryOne, transaction } from "./db";
import { ApiError } from "./http";
import type { SessionUser } from "./session";

export function requireAdmin(user: SessionUser) {
  if (user.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Admins only");
}

export interface AdminOverview {
  patients: number;
  therapists: { pending: number; verified: number; rejected: number };
  sessionsToday: number;
  sessionsLast7Days: number;
  minutesLast30Days: number;
  upcomingAppointments: number;
  activeCalls: number;
}

export async function overview(): Promise<AdminOverview> {
  const r = await queryOne<Record<string, string>>(
    `select
      (select count(*) from ndiho_users where role = 'patient') as patients,
      (select count(*) from ndiho_therapist_profiles where verification_status = 'pending') as pending,
      (select count(*) from ndiho_therapist_profiles where verification_status = 'verified') as verified,
      (select count(*) from ndiho_therapist_profiles where verification_status = 'rejected') as rejected,
      (select count(*) from ndiho_calls where answered_at >= date_trunc('day', now())) as today,
      (select count(*) from ndiho_calls where answered_at > now() - interval '7 days') as week,
      (select coalesce(sum(extract(epoch from (coalesce(ended_at, now()) - answered_at)) / 60), 0)
         from ndiho_calls where answered_at > now() - interval '30 days') as minutes,
      (select count(*) from ndiho_appointments where status = 'booked' and starts_at > now()) as upcoming,
      (select count(*) from ndiho_calls where status = 'accepted') as active`,
  );
  return {
    patients: Number(r!.patients),
    therapists: { pending: Number(r!.pending), verified: Number(r!.verified), rejected: Number(r!.rejected) },
    sessionsToday: Number(r!.today),
    sessionsLast7Days: Number(r!.week),
    minutesLast30Days: Math.round(Number(r!.minutes)),
    upcomingAppointments: Number(r!.upcoming),
    activeCalls: Number(r!.active),
  };
}

export interface AdminTherapist {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  accountStatus: string;
  professionalTitle: string;
  licenseNumber: string;
  licensingBody: string;
  licenseCountry: string;
  yearsExperience: number;
  specialties: string[];
  languages: string[];
  bio: string;
  verificationStatus: "pending" | "verified" | "rejected";
  verificationNotes: string | null;
  createdAt: string;
}

export async function listTherapists(status?: string): Promise<AdminTherapist[]> {
  const params: unknown[] = [];
  let where = "";
  if (status && ["pending", "verified", "rejected"].includes(status)) {
    params.push(status);
    where = "where t.verification_status = $1";
  }
  const rows = await query<Record<string, unknown>>(
    `select u.id, u.full_name, u.email, u.phone, u.account_status, u.created_at,
            t.professional_title, t.license_number, t.licensing_body, t.license_country, t.years_experience,
            t.specialties, t.languages, t.bio, t.verification_status, t.verification_notes
       from ndiho_therapist_profiles t join ndiho_users u on u.id = t.user_id
       ${where}
      order by (t.verification_status = 'pending') desc, u.created_at desc
      limit 200`,
    params,
  );
  return rows.map((r) => ({
    id: r.id as string,
    fullName: r.full_name as string,
    email: r.email as string,
    phone: r.phone as string | null,
    accountStatus: r.account_status as string,
    professionalTitle: r.professional_title as string,
    licenseNumber: r.license_number as string,
    licensingBody: r.licensing_body as string,
    licenseCountry: r.license_country as string,
    yearsExperience: r.years_experience as number,
    specialties: r.specialties as string[],
    languages: r.languages as string[],
    bio: r.bio as string,
    verificationStatus: r.verification_status as AdminTherapist["verificationStatus"],
    verificationNotes: r.verification_notes as string | null,
    createdAt: (r.created_at as Date).toISOString(),
  }));
}

export async function setVerification(therapistId: string, decision: "verified" | "rejected", reason?: string) {
  const rows = await query(
    `update ndiho_therapist_profiles
        set verification_status = $2,
            verified_at = case when $2 = 'verified' then now() else null end,
            verification_notes = $3,
            updated_at = now()
      where user_id = $1 returning user_id`,
    [therapistId, decision, decision === "rejected" ? reason ?? null : null],
  );
  if (!rows.length) throw new ApiError(404, "THERAPIST_NOT_FOUND", "Therapist not found");
}

export interface AdminUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
  accountStatus: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export async function searchUsers(q?: string): Promise<AdminUser[]> {
  const params: unknown[] = [];
  let where = "";
  if (q?.trim()) {
    params.push(`%${q.trim().toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    where = "where lower(u.full_name) like $1 or u.email like $1";
  }
  const rows = await query<Record<string, unknown>>(
    `select id, full_name, email, role, account_status, created_at, last_login_at from ndiho_users u
      ${where} order by created_at desc limit 100`,
    params,
  );
  return rows.map((r) => ({
    id: r.id as string,
    fullName: r.full_name as string,
    email: r.email as string,
    role: r.role as string,
    accountStatus: r.account_status as string,
    createdAt: (r.created_at as Date).toISOString(),
    lastLoginAt: (r.last_login_at as Date | null)?.toISOString() ?? null,
  }));
}

export async function setAccountStatus(admin: SessionUser, userId: string, status: "active" | "suspended") {
  if (userId === admin.id) throw new ApiError(400, "CANNOT_SUSPEND_SELF", "You can't change your own account status");
  await transaction(async (client) => {
    const { rowCount } = await client.query(
      "update ndiho_users set account_status = $2, updated_at = now() where id = $1",
      [userId, status],
    );
    if (!rowCount) throw new ApiError(404, "USER_NOT_FOUND", "User not found");
    // Suspension signs the user out everywhere immediately.
    if (status === "suspended") {
      await client.query("update ndiho_sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [userId]);
    }
  });
}
