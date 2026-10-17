"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { COUNTRIES, LANGUAGES, SPECIALTIES } from "@/lib/schemas";
import { api, ApiClientError, errorMessage } from "./api";
import { Button, ChipToggle, Field, inputClass } from "./ui";

type Role = "patient" | "therapist";

const COUNTRY_NAMES: Record<string, string> = {
  RW: "Rwanda", KE: "Kenya", UG: "Uganda", TZ: "Tanzania", BI: "Burundi", CD: "DR Congo", SS: "South Sudan", ET: "Ethiopia",
};

export function RegisterForm({ initialRole }: { initialRole: Role }) {
  const router = useRouter();
  const [role, setRole] = useState<Role>(initialRole);
  const [values, setValues] = useState<Record<string, string>>({ licenseCountry: "RW", country: "RW" });
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const set = (name: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));
  const input = (name: string, props: React.ComponentProps<"input"> = {}) => (
    <input {...props} name={name} className={inputClass} value={values[name] ?? ""} onChange={set(name)} aria-invalid={!!errors[name]} />
  );

  function switchRole(next: Role) {
    setRole(next);
    setErrors({});
    setFormError(null);
    router.replace(`/register?role=${next}`, { scroll: false });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrors({});
    setFormError(null);
    const opt = (k: string) => values[k]?.trim() || undefined;
    const common = { fullName: values.fullName ?? "", email: values.email ?? "", password: values.password ?? "" };
    const body =
      role === "therapist"
        ? {
            ...common,
            phone: values.phone ?? "",
            professionalTitle: values.professionalTitle ?? "",
            licenseNumber: values.licenseNumber ?? "",
            licensingBody: values.licensingBody ?? "",
            licenseCountry: values.licenseCountry,
            yearsExperience: opt("yearsExperience"),
            specialties,
            languages,
            bio: opt("bio"),
            sessionFeeRwf: opt("sessionFeeRwf"),
          }
        : {
            ...common,
            phone: opt("phone"),
            dateOfBirth: opt("dateOfBirth"),
            preferredLanguage: opt("preferredLanguage"),
            country: opt("country"),
            city: opt("city"),
            consent,
          };
    try {
      await api(`/auth/register/${role}`, { body });
      router.replace("/dashboard?welcome=1");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "VALIDATION_ERROR") {
        setErrors(err.fieldErrors());
        setFormError("Please check the highlighted fields.");
      } else if (err instanceof ApiClientError && err.code === "EMAIL_TAKEN") {
        setErrors({ email: err.message });
      } else if (err instanceof ApiClientError && err.code === "LICENSE_TAKEN") {
        setErrors({ licenseNumber: err.message });
      } else {
        setFormError(errorMessage(err));
      }
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div role="tablist" aria-label="Account type" className="flex rounded-full bg-nd-surface-low p-1">
        {(["patient", "therapist"] as const).map((r) => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={role === r}
            onClick={() => switchRole(r)}
            className={`flex-1 rounded-full py-2.5 text-sm font-semibold transition ${role === r ? "bg-nd-primary text-white" : "text-nd-muted hover:text-nd-primary"}`}
          >
            {r === "patient" ? "I'm seeking support" : "I'm a therapist"}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={errors.fullName} className="sm:col-span-2">
          {input("fullName", { autoComplete: "name", placeholder: role === "therapist" ? "Dr. Amara Nkosi" : "Your name" })}
        </Field>
        <Field label="Email address" error={errors.email}>
          {input("email", { type: "email", autoComplete: "email", placeholder: "you@example.com" })}
        </Field>
        <Field label={role === "therapist" ? "Phone number" : "Phone number (optional)"} error={errors.phone}>
          {input("phone", { type: "tel", autoComplete: "tel", placeholder: "+250 788 000 000" })}
        </Field>
        <Field label="Password" error={errors.password} hint="At least 10 characters with upper & lower case and a number" className="sm:col-span-2">
          {input("password", { type: "password", autoComplete: "new-password" })}
        </Field>
      </div>

      {role === "therapist" ? (
        <fieldset className="flex flex-col gap-4 rounded-2xl bg-nd-surface-low/60 p-4 sm:p-5">
          <legend className="sr-only">Professional details</legend>
          <p className="text-sm font-bold text-nd-primary">Professional details</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Professional title" error={errors.professionalTitle}>
              {input("professionalTitle", { placeholder: "Clinical Psychologist" })}
            </Field>
            <Field label="Years of experience" error={errors.yearsExperience}>
              {input("yearsExperience", { type: "number", min: 0, max: 70, inputMode: "numeric" })}
            </Field>
            <Field label="Licensing body" error={errors.licensingBody}>
              {input("licensingBody", { placeholder: "e.g. Rwanda Allied Health Professions Council" })}
            </Field>
            <Field label="License number" error={errors.licenseNumber}>
              {input("licenseNumber")}
            </Field>
            <Field label="License country" error={errors.licenseCountry}>
              <select className={inputClass} value={values.licenseCountry} onChange={set("licenseCountry")}>
                {COUNTRIES.map((c) => <option key={c} value={c}>{COUNTRY_NAMES[c]}</option>)}
              </select>
            </Field>
            <Field label="Session fee in RWF (optional)" error={errors.sessionFeeRwf}>
              {input("sessionFeeRwf", { type: "number", min: 0, inputMode: "numeric", placeholder: "25000" })}
            </Field>
          </div>
          <Field label="Specialties" error={errors.specialties} group>
            <ChipToggle name="Specialties" options={SPECIALTIES} value={specialties} onChange={setSpecialties} />
          </Field>
          <Field label="Languages you offer sessions in" error={errors.languages} group>
            <ChipToggle name="Languages" options={LANGUAGES} value={languages} onChange={setLanguages} />
          </Field>
          <Field label="Short bio (optional)" error={errors.bio}>
            <textarea className={`${inputClass} min-h-24`} maxLength={2000} value={values.bio ?? ""} onChange={set("bio")} placeholder="Your approach and who you help" />
          </Field>
          <p className="text-xs leading-relaxed text-nd-muted">
            Our team verifies every license before your profile becomes visible to patients. You can sign in and complete your profile in the meantime.
          </p>
        </fieldset>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date of birth (optional)" error={errors.dateOfBirth}>
            {input("dateOfBirth", { type: "date", max: new Date().toISOString().slice(0, 10) })}
          </Field>
          <Field label="Preferred language (optional)" error={errors.preferredLanguage}>
            <select className={inputClass} value={values.preferredLanguage ?? ""} onChange={set("preferredLanguage")}>
              <option value="">No preference</option>
              {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Country" error={errors.country}>
            <select className={inputClass} value={values.country} onChange={set("country")}>
              {COUNTRIES.map((c) => <option key={c} value={c}>{COUNTRY_NAMES[c]}</option>)}
            </select>
          </Field>
          <Field label="City (optional)" error={errors.city}>
            {input("city", { autoComplete: "address-level2", placeholder: "Kigali" })}
          </Field>
          <label className="flex items-start gap-3 text-sm text-nd-on-background sm:col-span-2">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-nd-primary" aria-invalid={!!errors.consent} />
            <span>
              I have read the{" "}
              <Link href="/privacy" target="_blank" className="font-semibold text-nd-primary underline">privacy policy</Link> and consent to Ndiho Space storing my information to provide care.
              {errors.consent && <span role="alert" className="mt-1 block text-xs font-medium text-red-600">{errors.consent}</span>}
            </span>
          </label>
        </div>
      )}

      {formError && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{formError}</p>}
      <Button type="submit" size="lg" disabled={loading} className="w-full">
        {loading ? "Creating your account…" : role === "therapist" ? "Create therapist account →" : "Create my account →"}
      </Button>
      <p className="text-center text-sm text-nd-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-nd-primary underline-offset-4 hover:underline">Log in</Link>
      </p>
    </form>
  );
}
