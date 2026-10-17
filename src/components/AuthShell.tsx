import type { ReactNode } from "react";
import { Logo } from "./ui";

/** Centered card layout used by the login and registration pages. */
export function AuthShell({ title, subtitle, children, wide = false }: {
  title: string;
  subtitle: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,var(--color-nd-primary-fixed)_0%,transparent_70%)] opacity-60" />
      <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-20 h-[300px] w-[300px] rounded-full bg-[radial-gradient(circle,var(--color-nd-tertiary)_0%,transparent_70%)] opacity-40" />
      <header className="relative px-4 py-5 sm:px-8">
        <Logo />
      </header>
      <main className="relative flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center sm:px-6">
        <div className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-3xl bg-nd-surface-lowest p-6 shadow-[0_32px_64px_rgba(36,66,103,0.12)] sm:p-10`}>
          <div className="mb-6 text-center">
            <h1 className="font-nd-serif text-3xl font-bold text-nd-primary">{title}</h1>
            <p className="mt-1.5 text-[15px] text-nd-muted">{subtitle}</p>
          </div>
          {children}
          <p className="mt-6 text-center text-xs text-nd-muted">🔒 Your information is confidential and only shared with your care team.</p>
        </div>
      </main>
    </div>
  );
}
