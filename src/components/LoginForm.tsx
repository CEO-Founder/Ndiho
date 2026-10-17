"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiClientError, errorMessage } from "./api";
import { Button, Field, inputClass } from "./ui";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api("/auth/login", { body: { email, password } });
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError && err.code === "VALIDATION_ERROR" ? "Enter your email and password" : errorMessage(err));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Email address">
        <input className={inputClass} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </Field>
      <Field label="Password">
        <input className={inputClass} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
      <Button type="submit" disabled={loading} className="mt-2 w-full" size="lg">
        {loading ? "Signing in…" : "Sign in →"}
      </Button>
      <p className="text-center text-sm text-nd-muted">
        New to Ndiho Space?{" "}
        <Link href="/register" className="font-semibold text-nd-primary underline-offset-4 hover:underline">Create an account</Link>
      </p>
    </form>
  );
}
