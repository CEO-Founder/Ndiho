import { HomeNav } from "@/components/HomeNav";
import type { PublicTherapist } from "@/components/types";
import { Avatar, LinkButton, Pill, SectionHeading } from "@/components/ui";
import { currentUser } from "@/lib/server-session";
import { listVerifiedTherapists } from "@/lib/users";

export const dynamic = "force-dynamic";

const SERVICES = [
  { label: "Individual Therapy", icon: "🧘", desc: "One-on-one confidential sessions tailored to your journey", color: "bg-nd-primary-fixed" },
  { label: "Couples Therapy", icon: "💞", desc: "Strengthen bonds and navigate challenges together", color: "bg-nd-tertiary" },
  { label: "Family Therapy", icon: "🏡", desc: "Healing dynamics and building healthier family systems", color: "bg-nd-secondary" },
  { label: "Group Sessions", icon: "🌿", desc: "Shared healing in a safe, facilitated community space", color: "bg-nd-lavender" },
  { label: "Institute Programs", icon: "🏛️", desc: "Structured mental health programs for organizations", color: "bg-nd-mint" },
  { label: "Psycho-Education", icon: "📚", desc: "Learn about mental health to empower your daily life", color: "bg-nd-peach" },
];

const STEPS = [
  { n: "01", title: "Create your free account", body: "Sign up in a minute. Only your name is shared with the therapists you choose to speak with." },
  { n: "02", title: "Choose a verified therapist", body: "Browse by specialty and language. Every license is checked by our team before a therapist appears." },
  { n: "03", title: "Meet over secure video", body: "Start an encrypted video consultation from your phone, tablet or computer — no app to install." },
];

const TESTIMONIALS = [
  { quote: "For the first time I spoke about my anxiety without shame. Ndiho made me feel safe.", name: "A.M., Kigali", type: "Individual Therapy" },
  { quote: "My husband and I were going through a rough patch. Three sessions changed everything for us.", name: "M.K., Huye", type: "Couples Therapy" },
  { quote: "As a university student, I couldn't afford traditional therapy. This platform saved me.", name: "J.N., Musanze", type: "Group Session" },
];

async function loadTherapists(): Promise<PublicTherapist[]> {
  try {
    return await listVerifiedTherapists({ limit: 8 });
  } catch (err) {
    // The marketing page should still render if the database is unreachable.
    console.error("[ndiho] could not load therapists for the homepage", err);
    return [];
  }
}

export default async function NdihoHome() {
  const [user, therapists] = await Promise.all([currentUser(), loadTherapists()]);
  const signedIn = !!user;
  const consultHref = signedIn ? "/dashboard" : "/register?role=patient";

  return (
    <>
      <HomeNav signedIn={signedIn} />

      <main>
        {/* HERO */}
        <section className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute right-[-10%] top-[5%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,var(--color-nd-primary-fixed)_0%,transparent_70%)] opacity-60" />
          <div aria-hidden className="pointer-events-none absolute bottom-[5%] left-[55%] h-[260px] w-[260px] rounded-full bg-[radial-gradient(circle,var(--color-nd-tertiary)_0%,transparent_70%)] opacity-40" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-12 sm:px-6 md:pt-20 lg:min-h-[86vh] lg:grid-cols-[1.15fr_0.85fr] lg:pb-24">
            <div className="animate-[nd-fade-up_0.8s_ease_both]">
              <Pill className="mb-6 px-4 py-1.5 text-[13px]">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Mental health is normal · Kuvura ni bwiza
              </Pill>
              <h1 className="font-nd-serif text-[clamp(42px,6.5vw,76px)] font-black leading-[1.05] tracking-[-0.03em] text-nd-primary">
                Your healing
                <br />
                <span className="italic text-nd-primary-light">begins here.</span>
              </h1>
              <p className="mt-6 max-w-[540px] text-lg leading-relaxed text-nd-muted">
                Ndiho Space connects you with verified therapists over secure video — confidentially, conveniently, and compassionately. Because everyone deserves to feel well.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <LinkButton href={consultHref} size="lg">
                  {signedIn ? "Start a video consultation →" : "Find a therapist →"}
                </LinkButton>
                {!signedIn && (
                  <LinkButton href="/register?role=therapist" variant="outline" size="lg">I&apos;m a therapist</LinkButton>
                )}
              </div>
              <ul className="mt-10 grid max-w-xl grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                {[
                  ["🔒", "100% confidential"],
                  ["✓", "License-verified"],
                  ["📹", "Encrypted video"],
                  ["🌍", "Kinyarwanda · EN · FR"],
                ].map(([icon, label]) => (
                  <li key={label} className="flex items-center gap-2 text-sm font-semibold text-nd-primary">
                    <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-nd-surface-lowest shadow-sm">{icon}</span>
                    {label}
                  </li>
                ))}
              </ul>
            </div>

            {/* Consultation preview */}
            <div className="relative mx-auto w-full max-w-sm animate-[nd-fade-up_1s_ease_0.3s_both] lg:max-w-none">
              <div className="overflow-hidden rounded-[28px] bg-[#0f1b2b] shadow-[0_32px_64px_rgba(36,66,103,0.25)]">
                <div className="relative flex aspect-[4/5] items-center justify-center bg-gradient-to-br from-nd-primary to-[#0f1b2b]">
                  <Avatar name={therapists[0]?.fullName ?? "Ndiho Therapist"} size={120} className="ring-8 ring-white/10" />
                  <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" /> Live · 12:48
                  </div>
                  <div className="absolute bottom-4 right-4 flex h-24 w-20 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20 backdrop-blur">
                    <span className="text-2xl" aria-hidden>🙂</span>
                  </div>
                  <div className="absolute bottom-4 left-4 flex gap-2">
                    {["🎙️", "📹"].map((i) => (
                      <span key={i} aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-base">{i}</span>
                    ))}
                    <span aria-hidden className="flex h-10 items-center rounded-full bg-red-600 px-4 text-sm">📞</span>
                  </div>
                </div>
              </div>
              <div className="absolute -left-4 top-10 hidden w-64 items-center gap-3 rounded-2xl bg-white/95 p-4 shadow-[0_16px_48px_rgba(36,66,103,0.12)] backdrop-blur sm:flex lg:-left-12">
                <Avatar name={therapists[0]?.fullName ?? "Amara Nkosi"} size={44} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-nd-primary">{therapists[0]?.fullName ?? "Your therapist"}</p>
                  <p className="truncate text-xs text-nd-muted">{therapists[0]?.specialties[0] ?? "Trauma & PTSD"}</p>
                  <span className="mt-1 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">✓ Verified</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CHOOSE YOUR PATH */}
        <section aria-label="Get started" className="mx-auto -mt-6 max-w-6xl px-4 pb-20 sm:px-6">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="flex flex-col rounded-3xl bg-nd-primary p-8 text-white sm:p-10">
              <span className="mb-4 text-3xl" aria-hidden>🤝</span>
              <h2 className="font-nd-serif text-3xl font-bold">Looking for support?</h2>
              <p className="mt-3 flex-1 text-white/75">Create a free patient account, choose a therapist who speaks your language, and start a private video session.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <LinkButton href={consultHref} variant="light">{signedIn ? "Open my dashboard" : "Register as a patient"}</LinkButton>
              </div>
            </div>
            <div className="flex flex-col rounded-3xl bg-nd-tertiary/70 p-8 sm:p-10">
              <span className="mb-4 text-3xl" aria-hidden>🎓</span>
              <h2 className="font-nd-serif text-3xl font-bold text-nd-primary">Are you a therapist?</h2>
              <p className="mt-3 flex-1 text-nd-primary/75">Reach clients across Rwanda and Africa. Register with your license details — we verify every practitioner before they go live.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <LinkButton href={signedIn ? "/dashboard" : "/register?role=therapist"}>{signedIn ? "Open my dashboard" : "Register as a therapist"}</LinkButton>
              </div>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how-it-works" className="scroll-mt-20 bg-nd-surface-low px-4 py-20 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-6xl">
            <SectionHeading eyebrow="How it works" title="Support in three" accent="simple steps." />
            <ol className="grid gap-5 md:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.n} className="rounded-3xl bg-nd-surface-lowest p-8">
                  <span className="font-nd-serif text-4xl font-black text-nd-primary-fixed">{s.n}</span>
                  <h3 className="mt-3 text-lg font-bold text-nd-primary">{s.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-nd-muted">{s.body}</p>
                </li>
              ))}
            </ol>
            <div className="mt-10 text-center">
              <LinkButton href={consultHref} size="lg">Start your first consultation →</LinkButton>
            </div>
          </div>
        </section>

        {/* SERVICES */}
        <section id="services" className="scroll-mt-20 px-4 py-20 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-6xl">
            <SectionHeading
              eyebrow="Our services"
              tone="tertiary"
              title="Every path to healing"
              accent="looks different."
              description="We offer a full spectrum of therapeutic services — all available online, from anywhere."
            />
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {SERVICES.map((s) => (
                <div key={s.label} className="group rounded-3xl bg-nd-surface-lowest p-8 shadow-[0_8px_32px_rgba(36,66,103,0.04)] transition hover:-translate-y-1 hover:shadow-[0_16px_48px_rgba(36,66,103,0.10)]">
                  <div className={`mb-5 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl ${s.color}`} aria-hidden>{s.icon}</div>
                  <h3 className="text-lg font-bold text-nd-primary">{s.label}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-nd-muted">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* THERAPISTS */}
        <section id="therapists" className="scroll-mt-20 bg-nd-surface-low px-4 py-20 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-6xl">
            <SectionHeading eyebrow="Our therapists" title="Meet your guides" accent="to wellbeing." description="Licensed professionals, verified by our team, offering sessions in the languages you speak." />
            {therapists.length > 0 ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {therapists.slice(0, 8).map((t) => (
                  <div key={t.id} className="flex flex-col items-center rounded-3xl bg-nd-surface-lowest p-7 text-center">
                    <Avatar name={t.fullName} size={80} />
                    <p className="mt-4 text-[17px] font-bold text-nd-primary">{t.fullName}</p>
                    <p className="text-sm text-nd-muted">{t.professionalTitle}</p>
                    <Pill tone="fixed" className="mt-3">{t.specialties[0]}</Pill>
                    <p className="mt-3 text-xs text-nd-muted">{t.languages.join(" · ")}</p>
                    <LinkButton href={signedIn ? "/dashboard" : "/register?role=patient"} variant="secondary" size="sm" className="mt-5 w-full">
                      Consult {t.fullName.replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, "").split(" ")[0]}
                    </LinkButton>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mx-auto max-w-xl rounded-3xl bg-nd-surface-lowest p-10 text-center">
                <p className="text-4xl" aria-hidden>🌱</p>
                <p className="mt-3 font-bold text-nd-primary">Our first therapists are being verified.</p>
                <p className="mt-2 text-sm text-nd-muted">Create your account now and you&apos;ll be able to consult them as soon as they go live.</p>
                <LinkButton href="/register?role=therapist" variant="outline" size="sm" className="mt-6">Join as a therapist</LinkButton>
              </div>
            )}
          </div>
        </section>

        {/* MISSION */}
        <section id="about" className="scroll-mt-20 px-4 py-20 sm:px-6 sm:py-24">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
            <div>
              <Pill className="mb-4 px-4 text-[13px]">Our mission</Pill>
              <h2 className="font-nd-serif text-[clamp(30px,3.5vw,46px)] font-black leading-[1.15] tracking-tight text-nd-primary">
                Breaking the silence
                <br />
                <span className="italic">around mental health.</span>
              </h2>
              <p className="mt-6 text-base leading-[1.8] text-nd-muted">
                In Rwanda and across Africa, mental health conversations are still stigmatized. Ndiho Space exists to change that. We make professional psychological support accessible, affordable, and completely confidential — because your mental health matters, wherever you are.
              </p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2">
              {[
                { icon: "🛡️", title: "Private by design", text: "Encrypted video sessions; your details are shared only with your care team.", bg: "bg-nd-primary-fixed" },
                { icon: "🎓", title: "Verified professionals", text: "Every therapist's license is reviewed before they can take calls.", bg: "bg-nd-tertiary" },
                { icon: "📱", title: "Any device", text: "Works in the browser on phone, tablet or computer.", bg: "bg-nd-secondary" },
                { icon: "🌍", title: "Local languages", text: "Sessions in Kinyarwanda, English, French and more.", bg: "bg-nd-lavender" },
              ].map((f) => (
                <li key={f.title} className={`rounded-3xl p-6 ${f.bg}`}>
                  <span className="text-2xl" aria-hidden>{f.icon}</span>
                  <p className="mt-3 font-bold text-nd-primary">{f.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-nd-primary/70">{f.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* TESTIMONIALS */}
        <section className="bg-nd-surface-low px-4 py-20 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-6xl">
            <h2 className="mb-12 text-center font-nd-serif text-[clamp(28px,4vw,48px)] font-black tracking-tight text-nd-primary">
              Stories of <span className="italic">transformation.</span>
            </h2>
            <div className="grid gap-5 md:grid-cols-3">
              {TESTIMONIALS.map((t, i) => (
                <figure key={t.name} className={`rounded-3xl p-8 ${i % 2 === 1 ? "bg-nd-primary-fixed" : "bg-nd-surface-lowest"}`}>
                  <span aria-hidden className="font-nd-serif text-4xl text-nd-primary-light">&ldquo;</span>
                  <blockquote className="mb-6 mt-2 text-[15px] italic leading-relaxed">{t.quote}</blockquote>
                  <figcaption>
                    <p className="text-sm font-bold text-nd-primary">{t.name}</p>
                    <p className="text-xs text-nd-muted">{t.type}</p>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="px-4 py-16 sm:px-6">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[32px] bg-gradient-to-br from-nd-primary to-nd-primary-light px-6 py-16 text-center sm:px-12 sm:py-20">
            <div aria-hidden className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/5" />
            <div aria-hidden className="absolute -bottom-16 -left-16 h-52 w-52 rounded-full bg-white/5" />
            <h2 className="relative font-nd-serif text-[clamp(28px,4vw,52px)] font-black leading-tight tracking-tight text-white">
              Your first step is
              <br />
              <span className="italic">the hardest one.</span>
            </h2>
            <p className="relative mx-auto mb-10 mt-4 max-w-lg text-[17px] text-white/75">
              You don&apos;t have to figure this out alone. Our therapists are ready to listen — securely, privately, and with full compassion.
            </p>
            <div className="relative flex flex-col justify-center gap-3 sm:flex-row">
              <LinkButton href={consultHref} variant="light" size="lg">{signedIn ? "Start a consultation →" : "Create my free account →"}</LinkButton>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-nd-surface-highest px-4 py-12 text-center sm:px-6">
        <p className="font-nd-serif text-2xl font-bold text-nd-primary">
          NDIHO<span className="italic text-nd-primary-light">.</span>SPACE
        </p>
        <p className="mx-auto mb-6 mt-2 max-w-md text-sm text-nd-muted">Confidential mental health support, accessible to everyone in Rwanda and beyond.</p>
        <nav aria-label="Footer" className="mb-6 flex flex-wrap justify-center gap-x-6 gap-y-2">
          {[
            ["Privacy Policy", "/privacy"],
            ["Test your camera & connection", "/check"],
            ["Therapist Portal", "/register?role=therapist"],
          ].map(([label, href]) => (
            <a key={label} href={href} className="text-[13px] font-medium text-nd-muted hover:text-nd-primary">{label}</a>
          ))}
        </nav>
        <p className="text-xs text-nd-muted">© {new Date().getFullYear()} Ndiho Space · Built with care for your wellbeing 🌿</p>
        <p className="mt-2 text-xs text-nd-muted">
          {/* TODO: add Ndiho's verified 24/7 crisis helpline here. */}
          In immediate danger? Call emergency services on <strong className="text-nd-primary">112</strong>.
        </p>
      </footer>
    </>
  );
}
