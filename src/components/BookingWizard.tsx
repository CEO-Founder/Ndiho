"use client";

import { useEffect, useState } from "react";
import { BOOKABLE_SERVICES, SESSION_MINUTES } from "@/lib/schemas";
import { WEEKDAYS } from "@/lib/time";
import { api, errorMessage } from "./api";
import { Card, formatWhen, PLATFORM_TIMEZONE_LABEL } from "./sessions";
import type { AppointmentView, PublicTherapist } from "./types";
import { Avatar, Button, inputClass, LinkButton, Pill } from "./ui";

type DaySlots = { date: string; weekday: number; slots: { startsAt: string; label: string }[] };

const STEPS = ["Service", "Therapist", "Date & time", "Confirm"];

export function BookingWizard({ initialTherapistId }: { initialTherapistId?: string }) {
  const [step, setStep] = useState(0);
  const [service, setService] = useState<string | null>(null);
  const [therapists, setTherapists] = useState<PublicTherapist[] | null>(null);
  const [therapist, setTherapist] = useState<PublicTherapist | null>(null);
  const [days, setDays] = useState<DaySlots[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<{ startsAt: string; label: string } | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [booked, setBooked] = useState<AppointmentView | null>(null);

  useEffect(() => {
    api<{ therapists: PublicTherapist[] }>("/therapists")
      .then((d) => {
        setTherapists(d.therapists);
        const pre = d.therapists.find((t) => t.id === initialTherapistId);
        if (pre) setTherapist(pre);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [initialTherapistId]);

  // Load the chosen therapist's open slots.
  useEffect(() => {
    if (!therapist) return;
    let cancelled = false;
    api<{ days: DaySlots[] }>(`/therapists/${therapist.id}/slots`)
      .then((d) => {
        if (cancelled) return;
        setDays(d.days);
        setDate(d.days.find((x) => x.slots.length > 0)?.date ?? null);
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [therapist]);

  function chooseTherapist(t: PublicTherapist) {
    if (t.id !== therapist?.id) {
      setDays(null);
      setSlot(null);
    }
    setTherapist(t);
    setStep(2);
  }

  async function confirm() {
    if (!service || !therapist || !slot) return;
    setSubmitting(true);
    setError(null);
    try {
      const { appointment } = await api<{ appointment: AppointmentView }>("/appointments", {
        body: { therapistId: therapist.id, service, startsAt: slot.startsAt, note: note.trim() || undefined },
      });
      setBooked(appointment);
    } catch (err) {
      setError(errorMessage(err));
      // The slot may have just been taken: refresh the times.
      setDays(null);
      setSlot(null);
      api<{ days: DaySlots[] }>(`/therapists/${therapist.id}/slots`).then((d) => setDays(d.days)).catch(() => {});
      setStep(2);
    } finally {
      setSubmitting(false);
    }
  }

  if (booked) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
        <p className="text-6xl" aria-hidden>✅</p>
        <h1 className="mt-4 font-nd-serif text-4xl font-black text-nd-primary">Session booked</h1>
        <p className="mt-3 text-nd-muted">
          Your {BOOKABLE_SERVICES.find((s) => s.id === booked.service)?.label.toLowerCase()} session with{" "}
          <strong className="text-nd-primary">{booked.therapist.fullName}</strong> is on{" "}
          <strong className="text-nd-primary">{formatWhen(booked.startsAt)}</strong> ({PLATFORM_TIMEZONE_LABEL}).
        </p>
        <p className="mt-2 text-sm text-nd-muted">
          Open your dashboard a few minutes before the start and press <strong>Join session</strong>. Your journey to wellness begins now. 🌿
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <LinkButton href="/dashboard">Go to my dashboard</LinkButton>
          <LinkButton href="/check" variant="outline">Test camera & mic</LinkButton>
        </div>
      </div>
    );
  }

  const selectedDay = days?.find((d) => d.date === date);
  const svc = BOOKABLE_SERVICES.find((s) => s.id === service);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Progress */}
      <ol className="mb-10 flex items-center justify-center" aria-label="Booking steps">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <span aria-current={i === step ? "step" : undefined} className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold transition sm:h-10 sm:w-10 ${i <= step ? "bg-nd-primary text-white" : "bg-nd-surface-highest text-nd-muted"}`}>
                {i < step ? "✓" : i + 1}
              </span>
              <span className={`hidden text-[11px] sm:block ${i === step ? "font-semibold text-nd-primary" : "text-nd-muted"}`}>{label}</span>
            </div>
            {i < STEPS.length - 1 && <span className={`mx-1 mb-0 h-0.5 w-8 sm:mb-5 sm:w-16 ${i < step ? "bg-nd-primary" : "bg-nd-surface-highest"}`} />}
          </li>
        ))}
      </ol>

      {error && <p role="alert" className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}

      {step === 0 && (
        <section>
          <h1 className="font-nd-serif text-3xl font-black text-nd-primary sm:text-4xl">What kind of support are you looking for?</h1>
          <p className="mb-8 mt-2 text-nd-muted">Choose the therapy type that feels right for you.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {BOOKABLE_SERVICES.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={service === s.id}
                onClick={() => setService(s.id)}
                className={`rounded-3xl p-6 text-left transition ${service === s.id ? "-translate-y-0.5 bg-nd-primary-fixed ring-2 ring-nd-primary" : "bg-nd-surface-lowest hover:-translate-y-0.5"}`}
              >
                <span className="text-3xl" aria-hidden>{s.icon}</span>
                <p className="mt-3 font-bold text-nd-primary">{s.label}</p>
                <p className="mt-1 text-sm text-nd-muted">{s.desc}</p>
                <Pill tone="secondary" className="mt-3">Online · {SESSION_MINUTES} min</Pill>
              </button>
            ))}
          </div>
          <div className="mt-8 flex justify-end">
            <Button disabled={!service} onClick={() => setStep(therapist ? 2 : 1)}>
              {therapist ? "Next: Pick a time →" : "Next: Choose therapist →"}
            </Button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section>
          <h1 className="font-nd-serif text-3xl font-black text-nd-primary sm:text-4xl">Meet your therapists</h1>
          <p className="mb-8 mt-2 text-nd-muted">All therapists are license-verified by our team.</p>
          {therapists === null && <p className="text-sm text-nd-muted">Loading…</p>}
          {therapists?.length === 0 && <p className="rounded-2xl bg-nd-surface-lowest p-8 text-center text-sm text-nd-muted">No therapists are available yet. Please check back soon.</p>}
          <ul className="flex flex-col gap-3">
            {therapists?.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => chooseTherapist(t)}
                  className={`flex w-full flex-col gap-4 rounded-3xl p-5 text-left transition sm:flex-row sm:items-start ${therapist?.id === t.id ? "bg-nd-primary-fixed ring-2 ring-nd-primary" : "bg-nd-surface-lowest hover:bg-nd-primary-fixed/40"}`}
                >
                  <Avatar name={t.fullName} size={64} />
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-bold text-nd-primary">{t.fullName}</p>
                    <p className="text-sm text-nd-muted">
                      {t.professionalTitle} · {t.yearsExperience} yrs experience
                      {t.sessionFeeRwf != null && ` · RWF ${t.sessionFeeRwf.toLocaleString()}`}
                    </p>
                    {t.bio && <p className="mt-2 line-clamp-2 text-sm text-nd-on-background/80">{t.bio}</p>}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {t.specialties.map((s) => <Pill key={s} tone="fixed">{s}</Pill>)}
                      {t.languages.map((l) => <Pill key={l} tone="muted">{l}</Pill>)}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <Button variant="outline" onClick={() => setStep(0)}>← Back</Button>
          </div>
        </section>
      )}

      {step === 2 && therapist && (
        <section>
          <h1 className="font-nd-serif text-3xl font-black text-nd-primary sm:text-4xl">Choose your session time</h1>
          <p className="mb-8 mt-2 text-nd-muted">
            With <strong className="text-nd-primary">{therapist.fullName}</strong>. Times are in {PLATFORM_TIMEZONE_LABEL}.{" "}
            <button type="button" className="font-semibold text-nd-primary-light underline" onClick={() => setStep(1)}>Change therapist</button>
          </p>
          {days === null ? (
            <p className="text-sm text-nd-muted">Loading available times…</p>
          ) : days.every((d) => d.slots.length === 0) ? (
            <Card className="text-center">
              <p className="font-semibold text-nd-primary">{therapist.fullName} has no open times in the next two weeks.</p>
              <p className="mt-1 text-sm text-nd-muted">Please choose another therapist, or check back later.</p>
            </Card>
          ) : (
            <>
              <p className="mb-3 text-sm font-semibold text-nd-primary">Date</p>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2" role="listbox" aria-label="Date">
                {days.map((d) => {
                  const [, m, day] = d.date.split("-");
                  const disabled = d.slots.length === 0;
                  return (
                    <button
                      key={d.date}
                      type="button"
                      role="option"
                      aria-selected={date === d.date}
                      disabled={disabled}
                      onClick={() => {
                        setDate(d.date);
                        setSlot(null);
                      }}
                      className={`w-[72px] shrink-0 rounded-2xl py-3 text-center transition ${date === d.date ? "bg-nd-primary text-white" : disabled ? "cursor-not-allowed bg-nd-surface-highest/60 text-nd-muted opacity-50" : "bg-nd-surface-lowest text-nd-on-background hover:bg-nd-primary-fixed"}`}
                    >
                      <span className="block text-xs font-medium">{WEEKDAYS[d.weekday].slice(0, 3)}</span>
                      <span className="block text-xl font-bold">{Number(day)}</span>
                      <span className="block text-[11px]">{new Date(Date.UTC(2000, Number(m) - 1, 1)).toLocaleString("en", { month: "short", timeZone: "UTC" })}</span>
                      {disabled && <span className="block text-[9px]">Full</span>}
                    </button>
                  );
                })}
              </div>
              {selectedDay && (
                <>
                  <p className="mb-3 mt-6 text-sm font-semibold text-nd-primary">Time</p>
                  <div className="flex flex-wrap gap-2" role="listbox" aria-label="Time">
                    {selectedDay.slots.map((s) => (
                      <button
                        key={s.startsAt}
                        type="button"
                        role="option"
                        aria-selected={slot?.startsAt === s.startsAt}
                        onClick={() => setSlot(s)}
                        className={`rounded-full px-5 py-2.5 text-sm font-semibold transition ${slot?.startsAt === s.startsAt ? "bg-nd-primary text-white" : "bg-nd-surface-lowest text-nd-primary hover:bg-nd-primary-fixed"}`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          <div className="mt-8 flex justify-between">
            <Button variant="outline" onClick={() => setStep(therapists && therapists.length > 1 ? 1 : 0)}>← Back</Button>
            <Button disabled={!slot} onClick={() => setStep(3)}>Next: Confirm →</Button>
          </div>
        </section>
      )}

      {step === 3 && therapist && slot && svc && (
        <section>
          <h1 className="font-nd-serif text-3xl font-black text-nd-primary sm:text-4xl">Confirm your session</h1>
          <p className="mb-8 mt-2 text-nd-muted">Your session is confidential and takes place over encrypted video.</p>
          <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
            <Card className="bg-nd-surface-low">
              <p className="mb-4 font-bold text-nd-primary">Booking summary</p>
              <dl className="flex flex-col gap-2 text-sm">
                {[
                  ["Service", svc.label],
                  ["Therapist", therapist.fullName],
                  ["When", `${formatWhen(slot.startsAt)} (${PLATFORM_TIMEZONE_LABEL})`],
                  ["Duration", `${SESSION_MINUTES} minutes`],
                  ["Where", "Video session on Ndiho Space"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <dt className="text-nd-muted">{k}</dt>
                    <dd className="text-right font-semibold text-nd-primary">{v}</dd>
                  </div>
                ))}
                {therapist.sessionFeeRwf != null && (
                  <div className="mt-2 flex justify-between gap-4 border-t border-nd-surface-highest pt-3">
                    <dt className="font-bold">Session fee</dt>
                    <dd className="font-bold text-nd-primary">RWF {therapist.sessionFeeRwf.toLocaleString()}</dd>
                  </div>
                )}
              </dl>
              {therapist.sessionFeeRwf != null && (
                <p className="mt-3 text-xs text-nd-muted">Online payment is coming soon. For now, your therapist will arrange payment with you directly.</p>
              )}
            </Card>
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold text-nd-primary">Anything you&apos;d like your therapist to know? (optional)</span>
                <textarea className={`${inputClass} min-h-32`} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Only your therapist will see this." />
              </label>
              <Button size="lg" disabled={submitting} onClick={confirm} data-testid="confirm-booking">
                {submitting ? "Booking…" : "Confirm booking →"}
              </Button>
              <p className="text-center text-xs text-nd-muted">🔒 You can cancel any time before the session starts.</p>
            </div>
          </div>
          <div className="mt-8">
            <Button variant="outline" onClick={() => setStep(2)}>← Back</Button>
          </div>
        </section>
      )}
    </div>
  );
}
