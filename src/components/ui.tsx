// Small presentational building blocks shared by the Ndiho pages.
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const AVATAR_COLORS = ["#3d5a80", "#5a7a6a", "#7a5a6a", "#5a6a7a", "#6a5a7a", "#7a6a5a"];

export function initials(name: string): string {
  const parts = name.replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, "").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function Avatar({ name, size = 48, className = "" }: { name: string; size?: number; className?: string }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return (
    <div
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.34, background: AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] }}
    >
      {initials(name)}
    </div>
  );
}

export function Logo({ href = "/", light = false }: { href?: string; light?: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-2" aria-label="Ndiho Space home">
      <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-nd-primary to-nd-primary-light text-lg text-white">
        ✦
      </span>
      <span className={`font-nd-serif text-xl font-bold tracking-tight ${light ? "text-white" : "text-nd-primary"}`}>
        NDIHO<span className={`italic ${light ? "text-nd-secondary" : "text-nd-primary-light"}`}>.</span>SPACE
      </span>
    </Link>
  );
}

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "light";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-nd-primary text-white hover:bg-nd-primary-light",
  secondary: "bg-nd-secondary text-nd-primary hover:brightness-95",
  outline: "border-[1.5px] border-nd-primary text-nd-primary hover:bg-nd-primary-fixed/50",
  ghost: "text-nd-primary hover:bg-nd-surface-low",
  danger: "bg-red-600 text-white hover:bg-red-700",
  light: "bg-white text-nd-primary hover:bg-nd-primary-fixed",
};

const SIZES = { sm: "px-4 py-2 text-sm", md: "px-6 py-3 text-[15px]", lg: "px-8 py-3.5 text-base" };

export function buttonClass(variant: Variant = "primary", size: keyof typeof SIZES = "md", extra = "") {
  return `inline-flex items-center justify-center gap-2 rounded-full font-semibold tracking-tight transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nd-primary disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: keyof typeof SIZES }) {
  return <button {...props} className={buttonClass(variant, size, className)} />;
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: keyof typeof SIZES }) {
  return <Link {...props} className={buttonClass(variant, size, className)} />;
}

export function Pill({ children, tone = "secondary", className = "" }: { children: ReactNode; tone?: "secondary" | "tertiary" | "fixed" | "muted"; className?: string }) {
  const tones = {
    secondary: "bg-nd-secondary text-nd-primary",
    tertiary: "bg-nd-tertiary text-[#7a5a00]",
    fixed: "bg-nd-primary-fixed text-nd-primary",
    muted: "bg-nd-surface-low text-nd-muted",
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${tones[tone]} ${className}`}>{children}</span>;
}

export function Field({
  label,
  error,
  hint,
  children,
  className = "",
  group = false,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
  /** For controls that aren't a single input (e.g. chip groups): a <label> would bind to the first button. */
  group?: boolean;
}) {
  const Wrapper = group ? "div" : "label";
  return (
    <Wrapper className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-sm font-semibold text-nd-primary">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="text-xs font-medium text-red-600">{error}</span>
      ) : hint ? (
        <span className="text-xs text-nd-muted">{hint}</span>
      ) : null}
    </Wrapper>
  );
}

export const inputClass =
  "w-full rounded-lg border-0 border-b-2 border-nd-surface-highest bg-nd-surface-low px-4 py-3 text-[15px] text-nd-on-background outline-none transition placeholder:text-nd-muted/70 focus:border-nd-primary aria-[invalid=true]:border-red-500";

export function ChipToggle({
  options,
  value,
  onChange,
  name,
}: {
  options: readonly string[];
  value: string[];
  onChange: (next: string[]) => void;
  name: string;
}) {
  return (
    <div role="group" aria-label={name} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? value.filter((v) => v !== o) : [...value, o])}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              active ? "bg-nd-primary text-white" : "bg-nd-surface-low text-nd-muted hover:bg-nd-primary-fixed hover:text-nd-primary"
            }`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function SectionHeading({ eyebrow, title, accent, description, tone = "secondary" }: {
  eyebrow: string;
  title: string;
  accent: string;
  description?: string;
  tone?: "secondary" | "tertiary";
}) {
  return (
    <div className="mx-auto mb-12 max-w-2xl text-center">
      <Pill tone={tone} className="mb-4 px-4 text-[13px]">{eyebrow}</Pill>
      <h2 className="font-nd-serif text-[clamp(32px,4vw,52px)] font-black leading-[1.1] tracking-tight text-nd-primary">
        {title}
        <br />
        <span className="italic">{accent}</span>
      </h2>
      {description && <p className="mx-auto mt-4 max-w-xl text-[17px] text-nd-muted">{description}</p>}
    </div>
  );
}
