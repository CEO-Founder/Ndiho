import "server-only";
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { isUniqueViolation, query, queryOne, transaction } from "./db";
import { ApiError } from "./http";
import type {
  PatientProfileUpdate,
  PatientRegistration,
  TherapistProfileUpdate,
  TherapistRegistration,
} from "./schemas";
import type { Role } from "./session";

const BCRYPT_COST = 12;
// Compared against when the email is unknown so login timing does not reveal
// which emails are registered.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash("ndiho-timing-equaliser", BCRYPT_COST));

export type VerificationStatus = "pending" | "verified" | "rejected";

export interface TherapistProfile {
  professionalTitle: string;
  licenseNumber: string;
  licensingBody: string;
  licenseCountry: string;
  yearsExperience: number;
  specialties: string[];
  languages: string[];
  bio: string;
  sessionFeeRwf: number | null;
  verificationStatus: VerificationStatus;
  verifiedAt: string | null;
}

export interface PatientProfile {
  dateOfBirth: string | null;
  gender: string | null;
  preferredLanguage: string | null;
  country: string | null;
  city: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

export interface Account {
  id: string;
  email: string;
  role: Role;
  fullName: string;
  phone: string | null;
  createdAt: string;
  therapist?: TherapistProfile;
  patient?: PatientProfile;
}

/** What anyone (including signed-out visitors) may see about a therapist. */
export interface PublicTherapist {
  id: string;
  fullName: string;
  professionalTitle: string;
  yearsExperience: number;
  specialties: string[];
  languages: string[];
  bio: string;
  sessionFeeRwf: number | null;
  licensingBody: string;
  licenseCountry: string;
}

// ─── Registration ────────────────────────────────────────────────────────────

async function insertUser(
  client: PoolClient,
  data: { email: string; password: string; role: Role; fullName: string; phone?: string },
): Promise<string> {
  const passwordHash = await bcrypt.hash(data.password, BCRYPT_COST);
  try {
    const { rows } = await client.query<{ id: string }>(
      `insert into ndiho_users (email, password_hash, role, full_name, phone)
       values ($1, $2, $3, $4, $5) returning id`,
      [data.email, passwordHash, data.role, data.fullName, data.phone ?? null],
    );
    return rows[0].id;
  } catch (err) {
    if (isUniqueViolation(err, "ndiho_users_email_key")) {
      throw new ApiError(409, "EMAIL_TAKEN", "An account with this email already exists");
    }
    throw err;
  }
}

export async function registerTherapist(data: TherapistRegistration): Promise<string> {
  return transaction(async (client) => {
    const id = await insertUser(client, { ...data, role: "therapist" });
    try {
      await client.query(
        `insert into ndiho_therapist_profiles
           (user_id, professional_title, license_number, licensing_body, license_country,
            years_experience, specialties, languages, bio, session_fee_rwf)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          data.professionalTitle,
          data.licenseNumber,
          data.licensingBody,
          data.licenseCountry,
          data.yearsExperience,
          data.specialties,
          data.languages,
          data.bio ?? "",
          data.sessionFeeRwf ?? null,
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err, "ndiho_therapist_license_key")) {
        throw new ApiError(
          409,
          "LICENSE_TAKEN",
          "This license is already registered. Contact support if you believe this is a mistake.",
        );
      }
      throw err;
    }
    return id;
  });
}

export async function registerPatient(data: PatientRegistration): Promise<string> {
  return transaction(async (client) => {
    const id = await insertUser(client, { ...data, role: "patient" });
    await client.query(
      `insert into ndiho_patient_profiles
         (user_id, date_of_birth, gender, preferred_language, country, city,
          emergency_contact_name, emergency_contact_phone, consent_accepted_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
      [
        id,
        data.dateOfBirth ?? null,
        data.gender ?? null,
        data.preferredLanguage ?? null,
        data.country ?? null,
        data.city ?? null,
        data.emergencyContactName ?? null,
        data.emergencyContactPhone ?? null,
      ],
    );
    return id;
  });
}

// ─── Login ───────────────────────────────────────────────────────────────────

export async function verifyCredentials(email: string, password: string): Promise<string> {
  const user = await queryOne<{ id: string; password_hash: string; account_status: string }>(
    "select id, password_hash, account_status from ndiho_users where email = $1",
    [email],
  );
  const ok = await bcrypt.compare(password, user?.password_hash ?? (await getDummyHash()));
  if (!user || !ok) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Incorrect email or password");
  }
  if (user.account_status !== "active") {
    throw new ApiError(403, "ACCOUNT_SUSPENDED", "This account is suspended. Please contact support.");
  }
  await query("update ndiho_users set last_login_at = now() where id = $1", [user.id]);
  return user.id;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

type AccountRow = {
  id: string;
  email: string;
  role: Role;
  full_name: string;
  phone: string | null;
  created_at: Date;
  t_title: string | null;
  t_license_number: string | null;
  t_licensing_body: string | null;
  t_license_country: string | null;
  t_years: number | null;
  t_specialties: string[] | null;
  t_languages: string[] | null;
  t_bio: string | null;
  t_fee: number | null;
  t_status: VerificationStatus | null;
  t_verified_at: Date | null;
  p_dob: string | null;
  p_gender: string | null;
  p_language: string | null;
  p_country: string | null;
  p_city: string | null;
  p_ec_name: string | null;
  p_ec_phone: string | null;
};

export async function getAccount(userId: string): Promise<Account | null> {
  const r = await queryOne<AccountRow>(
    `select u.id, u.email, u.role, u.full_name, u.phone, u.created_at,
            t.professional_title as t_title, t.license_number as t_license_number,
            t.licensing_body as t_licensing_body, t.license_country as t_license_country,
            t.years_experience as t_years, t.specialties as t_specialties,
            t.languages as t_languages, t.bio as t_bio, t.session_fee_rwf as t_fee,
            t.verification_status as t_status, t.verified_at as t_verified_at,
            to_char(p.date_of_birth, 'YYYY-MM-DD') as p_dob, p.gender as p_gender,
            p.preferred_language as p_language, p.country as p_country, p.city as p_city,
            p.emergency_contact_name as p_ec_name, p.emergency_contact_phone as p_ec_phone
       from ndiho_users u
       left join ndiho_therapist_profiles t on t.user_id = u.id
       left join ndiho_patient_profiles p on p.user_id = u.id
      where u.id = $1`,
    [userId],
  );
  if (!r) return null;
  const account: Account = {
    id: r.id,
    email: r.email,
    role: r.role,
    fullName: r.full_name,
    phone: r.phone,
    createdAt: r.created_at.toISOString(),
  };
  if (r.role === "therapist" && r.t_title !== null) {
    account.therapist = {
      professionalTitle: r.t_title,
      licenseNumber: r.t_license_number!,
      licensingBody: r.t_licensing_body!,
      licenseCountry: r.t_license_country!,
      yearsExperience: r.t_years!,
      specialties: r.t_specialties ?? [],
      languages: r.t_languages ?? [],
      bio: r.t_bio ?? "",
      sessionFeeRwf: r.t_fee,
      verificationStatus: r.t_status!,
      verifiedAt: r.t_verified_at?.toISOString() ?? null,
    };
  }
  if (r.role === "patient") {
    account.patient = {
      dateOfBirth: r.p_dob,
      gender: r.p_gender,
      preferredLanguage: r.p_language,
      country: r.p_country,
      city: r.p_city,
      emergencyContactName: r.p_ec_name,
      emergencyContactPhone: r.p_ec_phone,
    };
  }
  return account;
}

const PUBLIC_THERAPIST_SELECT = `
  select u.id, u.full_name, t.professional_title, t.years_experience, t.specialties,
         t.languages, t.bio, t.session_fee_rwf, t.licensing_body, t.license_country
    from ndiho_therapist_profiles t
    join ndiho_users u on u.id = t.user_id
   where t.verification_status = 'verified' and u.account_status = 'active'`;

type PublicTherapistRow = {
  id: string;
  full_name: string;
  professional_title: string;
  years_experience: number;
  specialties: string[];
  languages: string[];
  bio: string;
  session_fee_rwf: number | null;
  licensing_body: string;
  license_country: string;
};

function toPublicTherapist(r: PublicTherapistRow): PublicTherapist {
  return {
    id: r.id,
    fullName: r.full_name,
    professionalTitle: r.professional_title,
    yearsExperience: r.years_experience,
    specialties: r.specialties,
    languages: r.languages,
    bio: r.bio,
    sessionFeeRwf: r.session_fee_rwf,
    licensingBody: r.licensing_body,
    licenseCountry: r.license_country,
  };
}

export async function listVerifiedTherapists(filters: {
  specialty?: string;
  language?: string;
  limit?: number;
}): Promise<PublicTherapist[]> {
  const params: unknown[] = [];
  let sql = PUBLIC_THERAPIST_SELECT;
  if (filters.specialty) {
    params.push(filters.specialty);
    sql += ` and $${params.length} = any(t.specialties)`;
  }
  if (filters.language) {
    params.push(filters.language);
    sql += ` and $${params.length} = any(t.languages)`;
  }
  params.push(Math.min(Math.max(filters.limit ?? 50, 1), 100));
  sql += ` order by t.verified_at desc nulls last, u.full_name limit $${params.length}`;
  const rows = await query<PublicTherapistRow>(sql, params);
  return rows.map(toPublicTherapist);
}

export async function getVerifiedTherapist(id: string): Promise<PublicTherapist | null> {
  const row = await queryOne<PublicTherapistRow>(`${PUBLIC_THERAPIST_SELECT} and u.id = $1`, [id]);
  return row ? toPublicTherapist(row) : null;
}

// ─── Profile updates ─────────────────────────────────────────────────────────

const LICENSE_FIELDS = ["licenseNumber", "licensingBody", "licenseCountry"] as const;

export async function updateTherapistProfile(userId: string, data: TherapistProfileUpdate) {
  await transaction(async (client) => {
    if (data.fullName !== undefined || data.phone !== undefined) {
      await client.query(
        `update ndiho_users
            set full_name = coalesce($2, full_name), phone = coalesce($3, phone), updated_at = now()
          where id = $1`,
        [userId, data.fullName ?? null, data.phone ?? null],
      );
    }
    const columns: Record<string, string> = {
      professionalTitle: "professional_title",
      licenseNumber: "license_number",
      licensingBody: "licensing_body",
      licenseCountry: "license_country",
      yearsExperience: "years_experience",
      specialties: "specialties",
      languages: "languages",
      bio: "bio",
      sessionFeeRwf: "session_fee_rwf",
    };
    const sets: string[] = [];
    const params: unknown[] = [userId];
    for (const [key, column] of Object.entries(columns)) {
      const value = data[key as keyof TherapistProfileUpdate];
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    // Changing licence details invalidates any previous verification.
    if (LICENSE_FIELDS.some((f) => data[f] !== undefined)) {
      sets.push("verification_status = 'pending'", "verified_at = null");
    }
    if (sets.length === 0) return;
    sets.push("updated_at = now()");
    try {
      await client.query(
        `update ndiho_therapist_profiles set ${sets.join(", ")} where user_id = $1`,
        params,
      );
    } catch (err) {
      if (isUniqueViolation(err, "ndiho_therapist_license_key")) {
        throw new ApiError(409, "LICENSE_TAKEN", "This license is already registered");
      }
      throw err;
    }
  });
}

export async function updatePatientProfile(userId: string, data: PatientProfileUpdate) {
  await transaction(async (client) => {
    if (data.fullName !== undefined || data.phone !== undefined) {
      await client.query(
        `update ndiho_users
            set full_name = coalesce($2, full_name), phone = coalesce($3, phone), updated_at = now()
          where id = $1`,
        [userId, data.fullName ?? null, data.phone ?? null],
      );
    }
    const columns: Record<string, string> = {
      dateOfBirth: "date_of_birth",
      gender: "gender",
      preferredLanguage: "preferred_language",
      country: "country",
      city: "city",
      emergencyContactName: "emergency_contact_name",
      emergencyContactPhone: "emergency_contact_phone",
    };
    const sets: string[] = [];
    const params: unknown[] = [userId];
    for (const [key, column] of Object.entries(columns)) {
      const value = data[key as keyof PatientProfileUpdate];
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    if (sets.length === 0) return;
    sets.push("updated_at = now()");
    await client.query(`update ndiho_patient_profiles set ${sets.join(", ")} where user_id = $1`, params);
  });
}
