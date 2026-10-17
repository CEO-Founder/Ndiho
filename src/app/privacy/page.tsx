import type { Metadata } from "next";
import { Logo } from "@/components/ui";

export const metadata: Metadata = { title: "Privacy policy" };

// Describes what this codebase actually does. Have it reviewed for your
// jurisdiction (e.g. Rwanda's Law N° 058/2021 on personal data) and add your
// contact address before launch.
const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "What we store",
    body: [
      "Account details: your name, email address, phone number and a one-way hash of your password (we never store the password itself).",
      "Therapists: professional title, licensing body, license number and country, experience, specialties, languages, bio and session fee.",
      "Patients: only what you choose to give — date of birth, gender, preferred language, country, city and an emergency contact — plus the time you gave consent.",
      "Calls: who called whom, when, how long the call lasted and how it ended.",
    ],
  },
  {
    title: "Your sessions are never recorded",
    body: [
      "Audio and video travel directly between your device and your therapist's, encrypted end to end (DTLS-SRTP). When a direct connection isn't possible, the encrypted stream passes through our relay server, which cannot decrypt it. We do not record, store or listen to sessions.",
    ],
  },
  {
    title: "Who can see your information",
    body: [
      "Patients: therapists you are in contact with see your name only. Your other details are visible to you alone.",
      "Therapists: once verified, your name, title, experience, specialties, languages, bio and fee are shown to visitors so patients can choose you. Your email, phone and license number are not shown.",
      "Our administrators can access stored data to run and secure the service, for example to verify therapist licenses.",
    ],
  },
  {
    title: "Cookies",
    body: [
      "We use a single cookie to keep you signed in. We do not use advertising or analytics cookies, and we do not sell or share your data with advertisers.",
    ],
  },
  {
    title: "Security",
    body: [
      "All traffic is encrypted with HTTPS. Passwords are hashed with bcrypt, sign-in sessions can be revoked at any time, and patient data is only reachable through our access-controlled application.",
    ],
  },
  {
    title: "Your rights",
    body: [
      "You can view and correct your details on your profile page at any time. To request a copy of your data or the deletion of your account, contact Ndiho Space support.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="px-4 py-5 sm:px-8">
        <Logo />
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-6 sm:px-6">
        <h1 className="font-nd-serif text-4xl font-black tracking-tight text-nd-primary">Privacy policy</h1>
        <p className="mt-2 text-nd-muted">How Ndiho Space handles your information.</p>
        <div className="mt-10 flex flex-col gap-8">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="text-lg font-bold text-nd-primary">{s.title}</h2>
              {s.body.length > 1 ? (
                <ul className="mt-2 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-nd-on-background/85">
                  {s.body.map((b) => <li key={b}>{b}</li>)}
                </ul>
              ) : (
                <p className="mt-2 text-[15px] leading-relaxed text-nd-on-background/85">{s.body[0]}</p>
              )}
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
