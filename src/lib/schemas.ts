// Validation shared by the Ndiho API and its forms. Safe to import client-side.
import { z } from "zod";

export const SPECIALTIES = [
  "Anxiety & Depression",
  "Trauma & PTSD",
  "Couples & Family",
  "Youth & Adolescents",
  "Grief & Loss",
  "Addiction",
  "Stress & Burnout",
  "Relationships",
  "Group Therapy",
  "Psycho-Education",
] as const;

export const LANGUAGES = ["English", "Kinyarwanda", "French", "Swahili", "Luganda"] as const;

export const COUNTRIES = ["RW", "KE", "UG", "TZ", "BI", "CD", "SS", "ET"] as const;

const trimmed = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);

export const emailSchema = z
  .string({ error: "Email is required" })
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address").max(254));

// bcrypt only uses the first 72 bytes, so longer passwords are rejected rather
// than silently truncated.
export const passwordSchema = z
  .string({ error: "Password is required" })
  .min(10, "Password must be at least 10 characters")
  .refine((p) => new TextEncoder().encode(p).length <= 72, "Password is too long")
  .refine((p) => /[a-z]/.test(p), "Password needs a lowercase letter")
  .refine((p) => /[A-Z]/.test(p), "Password needs an uppercase letter")
  .refine((p) => /[0-9]/.test(p), "Password needs a number");

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ]{8,16}$/, "Enter a valid phone number, e.g. +250 788 000 000")
  .transform((p) => p.replace(/\s+/g, ""));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

// Form inputs send "" for blank numbers; z.coerce would turn that into 0.
const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

const countrySchema = z.enum(COUNTRIES, { error: "Select a supported country" });

// ─── Therapist ───────────────────────────────────────────────────────────────

export const therapistProfileFields = {
  professionalTitle: trimmed(2, 100, "Professional title"),
  licenseNumber: trimmed(3, 60, "License number"),
  licensingBody: trimmed(2, 120, "Licensing body"),
  licenseCountry: countrySchema,
  yearsExperience: z.preprocess(
    emptyToUndefined,
    z.coerce.number({ error: "Years of experience is required" }).int().min(0).max(70),
  ),
  specialties: z
    .array(z.enum(SPECIALTIES))
    .min(1, "Select at least one specialty")
    .max(SPECIALTIES.length)
    .transform((s) => [...new Set(s)]),
  languages: z
    .array(z.enum(LANGUAGES))
    .min(1, "Select at least one language")
    .transform((s) => [...new Set(s)]),
  // No .default() here: these fields are reused by the partial update schema,
  // where a default would overwrite the stored value on unrelated updates.
  bio: z.string().trim().max(2000).optional(),
  sessionFeeRwf: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(10_000_000).optional()),
};

export const therapistRegistrationSchema = z.object({
  fullName: trimmed(2, 120, "Full name"),
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema,
  ...therapistProfileFields,
});
export type TherapistRegistration = z.infer<typeof therapistRegistrationSchema>;

export const therapistProfileUpdateSchema = z
  .object({
    fullName: trimmed(2, 120, "Full name"),
    phone: phoneSchema,
    ...therapistProfileFields,
  })
  .partial()
  .strict();
export type TherapistProfileUpdate = z.infer<typeof therapistProfileUpdateSchema>;

// ─── Patient ─────────────────────────────────────────────────────────────────

const dateOfBirthSchema = z.iso
  .date("Enter a valid date (YYYY-MM-DD)")
  .refine((d) => {
    const dob = new Date(`${d}T00:00:00Z`);
    const now = new Date();
    const age = (now.getTime() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
    return age >= 13 && age <= 120;
  }, "Patients must be at least 13 years old");

export const patientProfileFields = {
  dateOfBirth: dateOfBirthSchema.optional(),
  gender: z.enum(["female", "male", "non_binary", "prefer_not_to_say"]).optional(),
  preferredLanguage: z.enum(LANGUAGES).optional(),
  country: countrySchema.optional(),
  city: optionalText(100),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: phoneSchema.optional(),
};

export const patientRegistrationSchema = z.object({
  fullName: trimmed(2, 120, "Full name"),
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema.optional(),
  ...patientProfileFields,
  consent: z.literal(true, {
    error: "You must accept the privacy policy and terms to continue",
  }),
});
export type PatientRegistration = z.infer<typeof patientRegistrationSchema>;

export const patientProfileUpdateSchema = z
  .object({
    fullName: trimmed(2, 120, "Full name"),
    phone: phoneSchema,
    ...patientProfileFields,
  })
  .partial()
  .strict();
export type PatientProfileUpdate = z.infer<typeof patientProfileUpdateSchema>;

// ─── Auth & calls ────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(200),
});

export const startCallSchema = z.object({
  calleeId: z.uuid("Invalid user id"),
});

export const signalSchema = z.object({
  kind: z.enum(["ready", "offer", "answer", "ice"]),
  // SDP/ICE payloads are opaque to the server; size is capped by readJson.
  data: z.unknown().optional(),
});
