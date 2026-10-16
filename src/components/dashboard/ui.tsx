import type { ReactNode } from "react";
import type { Severity } from "./types";

export function Panel({
  title,
  description,
  action,
  children,
  className = "",
  flush = false,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`rounded-[10px] bg-surface shadow-panel ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={flush ? "" : "px-5 pb-5"}>{children}</div>
    </section>
  );
}

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "var(--critical)",
  serious: "var(--serious)",
  warning: "var(--warning)",
  info: "var(--muted)",
};

export function SeverityIcon({ severity, size = 16 }: { severity: Severity; size?: number }) {
  const color = SEVERITY_COLOR[severity];
  if (severity === "info") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-label="Info" role="img" className="shrink-0">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke={color} strokeWidth="1.5" />
        <path d="M8 7.2v3.6M8 5.1v.1" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-label={severity} role="img" className="shrink-0">
      <path d="M8 1.8 15 14H1z" fill={color} stroke={color} strokeWidth="1" strokeLinejoin="round" />
      <path d="M8 6.2v3.6M8 11.6v.1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon({ size = 16, color = "var(--good)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="shrink-0">
      <circle cx="8" cy="8" r="7" fill={color} />
      <path d="m5 8.2 2 2 4-4.2" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function LiveDot({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-block size-2 rounded-full ${active ? "live-dot bg-good" : "bg-axis"}`}
      aria-label={active ? "Active in the last 15 minutes" : "Inactive"}
    />
  );
}

/** Severity of a utilisation percentage, shared by meters and labels. */
export function usageSeverity(pct: number): "ok" | Severity {
  if (pct >= 95) return "critical";
  if (pct >= 80) return "serious";
  if (pct >= 60) return "warning";
  return "ok";
}

const FILL: Record<string, string> = {
  ok: "var(--series)",
  warning: "var(--warning)",
  serious: "var(--serious)",
  critical: "var(--critical)",
};

/**
 * Horizontal meter. The fill carries severity; an optional marker shows where the current pace
 * ends up at reset (clamped to the track, with an overflow cap when past 100%).
 */
export function Meter({ value, projected, height = 6 }: { value: number; projected?: number | null; height?: number }) {
  const sev = usageSeverity(value);
  const proj = projected ?? null;
  return (
    <div className="relative w-full rounded-full bg-series-track" style={{ height }}>
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: FILL[sev] }}
      />
      {proj !== null && proj > value && (
        <div
          className="absolute -top-[3px] w-[2px] rounded-full bg-ink"
          style={{ left: `calc(${Math.min(100, proj)}% - 1px)`, height: height + 6 }}
          title={`On pace for ${Math.round(proj)}% at reset`}
        />
      )}
    </div>
  );
}

export function ShareBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-surface-2">
      <div className="h-1.5 rounded-full bg-series" style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warning" | "critical" }) {
  const tones = {
    neutral: "bg-surface-2 text-ink-2",
    good: "bg-[color-mix(in_oklab,var(--good)_14%,transparent)] text-good-text",
    warning: "bg-[color-mix(in_oklab,var(--warning)_20%,transparent)] text-ink",
    critical: "bg-[color-mix(in_oklab,var(--critical)_14%,transparent)] text-critical",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="mt-1 max-w-md text-xs text-muted">{children}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} />;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[7px] bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`h-7 rounded-[5px] px-2.5 text-xs font-medium transition-colors ${
            o.value === value ? "bg-surface text-ink shadow-panel" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
