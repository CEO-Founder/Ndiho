"use client";

import Link from "next/link";
import { useState } from "react";
import { LinkButton, Logo } from "./ui";

const LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#services", label: "Services" },
  { href: "#therapists", label: "Therapists" },
  { href: "#about", label: "About" },
];

export function HomeNav({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 border-b border-nd-primary/[0.07] bg-nd-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-8 lg:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-[15px] font-medium text-nd-muted transition hover:text-nd-primary">{l.label}</a>
          ))}
        </nav>
        <div className="hidden items-center gap-3 sm:flex">
          {signedIn ? (
            <LinkButton href="/dashboard">Go to dashboard</LinkButton>
          ) : (
            <>
              <LinkButton href="/login" variant="outline">Log in</LinkButton>
              <LinkButton href="/register">Get started</LinkButton>
            </>
          )}
        </div>
        <button
          className="flex h-10 w-10 items-center justify-center rounded-full text-nd-primary hover:bg-nd-surface-low sm:hidden lg:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="nd-mobile-menu"
          onClick={() => setOpen((o) => !o)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>
      {open && (
        <div id="nd-mobile-menu" className="border-t border-nd-primary/[0.07] bg-nd-background px-4 pb-6 pt-2 sm:hidden">
          <nav aria-label="Mobile" className="flex flex-col">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-xl px-3 py-3 font-medium text-nd-primary hover:bg-nd-surface-low">{l.label}</a>
            ))}
          </nav>
          <div className="mt-3 grid gap-2">
            {signedIn ? (
              <LinkButton href="/dashboard">Go to dashboard</LinkButton>
            ) : (
              <>
                <LinkButton href="/register">Get started</LinkButton>
                <LinkButton href="/login" variant="outline">Log in</LinkButton>
                <Link href="/register?role=therapist" className="mt-1 text-center text-sm font-semibold text-nd-primary-light">Are you a therapist? Join us →</Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
