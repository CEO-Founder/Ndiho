"use client";

import { useState } from "react";
import { COUNTRIES, LANGUAGES, SPECIALTIES } from "@/lib/schemas";
import { api, ApiClientError, errorMessage } from "./api";
import type { Account } from "./types";
import { Button, ChipToggle, Field, inputClass, Pill } from "./ui";

type Values = Record<string, string>;

function initialValues(a: Account): Values {
  const v: Values = { fullName: a.fullName, phone: a.phone ?? "" };
  const src = a.therapist ?? a.patient ?? {};
  for (const [k, val] of Object.entries(src)) if (typeof val === "string" || typeof val === "number") v[k] = String(val);
  return v;
}

export function ProfileForm({ account: initial }: { account: Account }) {
  const [account, setAccount] = useState(initial);
  const [values, setValues] = useState<Values>(() => initialValues(initial));
  const [specialties, setSpecialties] = useState(initial.therapist?.specialties ?? []);
  const [languages, setLanguages] = useState(initial.therapist?.languages ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const isTherapist = account.role === "therapist";

  const set = (name: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));
  const input = (name: string, props: React.ComponentProps<"input"> = {}) => (
    <input {...props} className={inputClass} value={values[name] ?? ""} onChange={set(name)} aria-invalid={!!errors[name]} />
  );
  const select = (name: string, options: readonly string[], empty?: string) => (
    <select className={inputClass} value={values[name] ?? ""} onChange={set(name)}>
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
    </select>
  );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setMessage(null);
    // Only send what changed, so untouched optional fields stay as they are.
    const before = initialValues(account);
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) if (v !== before[k] && v !== "") body[k] = v;
    if (isTherapist) {
      if (specialties.join() !== account.therapist!.specialties.join()) body.specialties = specialties;
      if (languages.join() !== account.therapist!.languages.join()) body.languages = languages;
    }
    if (Object.keys(body).length === 0) {
      setMessage({ ok: true, text: "Nothing to save." });
      setSaving(false);
      return;
    }
    try {
      const { user } = await api<{ user: Account }>("/profile", { method: "PATCH", body });
      setAccount(user);
      setValues(initialValues(user));
      setMessage({
        ok: true,
        text:
          isTherapist && account.therapist?.verificationStatus === "verified" && user.therapist?.verificationStatus === "pending"
            ? "Saved. Because your license details changed, your profile is back under review."
            : "Your profile has been saved.",
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "VALIDATION_ERROR") setErrors(err.fieldErrors());
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-6">
      <section className="rounded-3xl bg-nd-surface-lowest p-5 shadow-[0_8px_32px_rgba(36,66,103,0.05)] sm:p-7">
        <h2 className="mb-4 text-lg font-bold text-nd-primary">Account</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={errors.fullName}>{input("fullName", { autoComplete: "name" })}</Field>
          <Field label="Email" hint="Contact support to change your email">
            <input className={`${inputClass} opacity-70`} value={account.email} disabled />
          </Field>
          <Field label="Phone" error={errors.phone}>{input("phone", { type: "tel", autoComplete: "tel" })}</Field>
        </div>
      </section>

      {isTherapist ? (
        <section className="rounded-3xl bg-nd-surface-lowest p-5 shadow-[0_8px_32px_rgba(36,66,103,0.05)] sm:p-7">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-nd-primary">Professional profile</h2>
            <Pill tone={account.therapist!.verificationStatus === "verified" ? "secondary" : "tertiary"} className="capitalize">
              {account.therapist!.verificationStatus}
            </Pill>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Professional title" error={errors.professionalTitle}>{input("professionalTitle")}</Field>
            <Field label="Years of experience" error={errors.yearsExperience}>{input("yearsExperience", { type: "number", min: 0, max: 70 })}</Field>
            <Field label="Licensing body" error={errors.licensingBody}>{input("licensingBody")}</Field>
            <Field label="License number" error={errors.licenseNumber}>{input("licenseNumber")}</Field>
            <Field label="License country" error={errors.licenseCountry}>{select("licenseCountry", COUNTRIES)}</Field>
            <Field label="Session fee (RWF)" error={errors.sessionFeeRwf}>{input("sessionFeeRwf", { type: "number", min: 0 })}</Field>
          </div>
          <p className="mt-3 text-xs text-nd-muted">Changing license details sends your profile back for verification.</p>
          <div className="mt-5 flex flex-col gap-5">
            <Field label="Specialties" error={errors.specialties} group>
              <ChipToggle name="Specialties" options={SPECIALTIES} value={specialties} onChange={setSpecialties} />
            </Field>
            <Field label="Languages" error={errors.languages} group>
              <ChipToggle name="Languages" options={LANGUAGES} value={languages} onChange={setLanguages} />
            </Field>
            <Field label="Bio" error={errors.bio}>
              <textarea className={`${inputClass} min-h-32`} maxLength={2000} value={values.bio ?? ""} onChange={set("bio")} />
            </Field>
          </div>
        </section>
      ) : (
        <section className="rounded-3xl bg-nd-surface-lowest p-5 shadow-[0_8px_32px_rgba(36,66,103,0.05)] sm:p-7">
          <h2 className="mb-4 text-lg font-bold text-nd-primary">Personal details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date of birth" error={errors.dateOfBirth}>{input("dateOfBirth", { type: "date" })}</Field>
            <Field label="Gender" error={errors.gender}>{select("gender", ["female", "male", "non_binary", "prefer_not_to_say"], "Not specified")}</Field>
            <Field label="Preferred language" error={errors.preferredLanguage}>{select("preferredLanguage", LANGUAGES, "No preference")}</Field>
            <Field label="Country" error={errors.country}>{select("country", COUNTRIES, "Not specified")}</Field>
            <Field label="City" error={errors.city}>{input("city")}</Field>
          </div>
          <h3 className="mb-3 mt-6 text-sm font-bold text-nd-primary">Emergency contact</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={errors.emergencyContactName}>{input("emergencyContactName")}</Field>
            <Field label="Phone" error={errors.emergencyContactPhone}>{input("emergencyContactPhone", { type: "tel" })}</Field>
          </div>
        </section>
      )}

      {message && (
        <p role="status" className={`rounded-xl px-4 py-3 text-sm font-medium ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          {message.text}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={saving} size="lg">{saving ? "Saving…" : "Save changes"}</Button>
      </div>
    </form>
  );
}
