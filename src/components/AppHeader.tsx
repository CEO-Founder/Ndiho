"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";
import { useRealtime } from "./RealtimeProvider";
import { Avatar, Logo } from "./ui";

export function AppHeader({ user }: { user: { fullName: string; role: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const { connected } = useRealtime();
  const [open, setOpen] = useState(false);

  async function logout() {
    await api("/auth/logout", { body: {} }).catch(() => {});
    router.replace("/");
    router.refresh();
  }

  const links =
    user.role === "admin"
      ? [{ href: "/admin", label: "Admin" }]
      : user.role === "therapist"
        ? [
            { href: "/dashboard", label: "Dashboard" },
            { href: "/patients", label: "Patients" },
            { href: "/availability", label: "Availability" },
            { href: "/profile", label: "Profile" },
            { href: "/check", label: "Test setup" },
          ]
        : [
            { href: "/dashboard", label: "Dashboard" },
            { href: "/book", label: "Book a session" },
            { href: "/profile", label: "Profile" },
            { href: "/check", label: "Test setup" },
          ];
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-50 border-b border-nd-primary/[0.07] bg-nd-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo href={user.role === "admin" ? "/admin" : "/dashboard"} />
        <nav className="hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={`rounded-full px-3 py-2 text-sm font-semibold transition ${isActive(l.href) ? "bg-nd-primary-fixed text-nd-primary" : "text-nd-muted hover:text-nd-primary"}`}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="relative">
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" className="flex items-center gap-2 rounded-full p-1 pr-3 transition hover:bg-nd-surface-low">
            <span className="relative">
              <Avatar name={user.fullName} size={36} />
              <span title={connected ? "Online — you can receive calls" : "Reconnecting…"} className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-nd-background ${connected ? "bg-emerald-500" : "bg-amber-400"}`} />
            </span>
            <span className="hidden max-w-40 truncate text-sm font-semibold text-nd-primary md:block">{user.fullName}</span>
          </button>
          {open && (
            <div role="menu" className="absolute right-0 mt-2 w-56 rounded-2xl bg-nd-surface-lowest p-2 shadow-[0_16px_48px_rgba(36,66,103,0.15)]" onClick={() => setOpen(false)}>
              <p className="px-3 py-2 text-xs capitalize text-nd-muted">Signed in as {user.role}</p>
              {links.map((l) => (
                <Link key={l.href} role="menuitem" href={l.href} className="block rounded-xl px-3 py-2 text-sm font-medium text-nd-primary hover:bg-nd-surface-low lg:hidden">{l.label}</Link>
              ))}
              <button role="menuitem" onClick={logout} className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50">Log out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
