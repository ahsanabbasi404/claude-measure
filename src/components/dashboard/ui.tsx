"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Severity } from "./types";

export function Panel({
  title,
  description,
  action,
  children,
  className = "",
  flush = false,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
  id?: string;
}) {
  return (
    <section id={id} className={`min-w-0 rounded-[10px] bg-surface shadow-panel ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3">
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

export function PageHeader({ eyebrow, title, meta, actions }: { eyebrow?: ReactNode; title: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <div className="text-xs text-muted">{eyebrow}</div>}
        <h1 className="mt-0.5 text-[22px] leading-tight font-semibold tracking-tight break-words text-ink">{title}</h1>
        {meta && <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">{meta}</div>}
      </div>
      {actions}
    </div>
  );
}

/**
 * Change against the previous period. Direction only carries color when it is clearly good or bad
 * (errors up is bad); for volume metrics it stays neutral.
 */
export function Delta({ current, previous, goodWhen }: { current: number; previous: number | null | undefined; goodWhen?: "up" | "down" }) {
  if (previous === null || previous === undefined) return null;
  if (previous === 0) {
    return current > 0 ? <span className="text-[11px] text-muted">new</span> : null;
  }
  const change = (current - previous) / Math.abs(previous);
  if (!Number.isFinite(change)) return null;
  const pct = Math.round(change * 100);
  if (pct === 0) return <span className="text-[11px] text-muted">no change</span>;
  const up = pct > 0;
  const tone = !goodWhen ? "text-ink-2" : (up === (goodWhen === "up")) ? "text-good-text" : "text-critical";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium tabular ${tone}`}>
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden className={up ? "" : "rotate-180"}>
        <path d="M4 1 7.5 6.5h-7z" fill="currentColor" />
      </svg>
      {Math.abs(pct) > 999 ? ">999" : Math.abs(pct)}%
      <span className="sr-only">{up ? "increase" : "decrease"} vs previous period</span>
    </span>
  );
}

export function StatTile({
  label,
  value,
  sub,
  delta,
  tone,
  hint,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: ReactNode;
  tone?: "bad";
  hint?: string;
}) {
  return (
    <div className="min-w-0 bg-surface px-4 py-3.5" title={hint}>
      <div className="truncate text-xs text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`truncate text-[20px] leading-tight font-semibold ${tone === "bad" ? "text-critical" : "text-ink"}`}>{value}</span>
        {delta}
      </div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

/** Tiles joined by hairlines, as one strip. */
export function StatGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`grid gap-px overflow-hidden rounded-[10px] bg-hairline shadow-panel ${className}`}>{children}</div>
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
      className={`inline-block size-2 shrink-0 rounded-full ${active ? "live-dot bg-good" : "bg-axis"}`}
      aria-label={active ? "Active in the last 15 minutes" : "Inactive"}
      title={active ? "Active in the last 15 minutes" : undefined}
    />
  );
}

export function Swatch({ color, shape = "rect" }: { color: string; shape?: "rect" | "line" }) {
  return shape === "line"
    ? <span className="inline-block h-[2px] w-3 shrink-0 rounded-full" style={{ background: color }} />
    : <span className="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />;
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
 * ends up at reset.
 */
export function Meter({ value, projected, height = 6 }: { value: number; projected?: number | null; height?: number }) {
  const sev = usageSeverity(value);
  const proj = projected ?? null;
  return (
    <div className="relative w-full rounded-full bg-series-track" style={{ height }} role="meter" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: FILL[sev] }} />
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

export function ShareBar({ value, color = "var(--series)" }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-surface-2">
      <div className="h-1.5 rounded-full" style={{ width: `${Math.max(value > 0 ? 2 : 0, Math.min(100, value * 100))}%`, background: color }} />
    </div>
  );
}

export function Pill({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "good" | "warning" | "critical" | "accent"; title?: string }) {
  const tones = {
    neutral: "bg-surface-2 text-ink-2",
    good: "bg-[color-mix(in_oklab,var(--good)_14%,transparent)] text-good-text",
    warning: "bg-[color-mix(in_oklab,var(--warning)_22%,transparent)] text-ink",
    critical: "bg-[color-mix(in_oklab,var(--critical)_14%,transparent)] text-critical",
    accent: "bg-series-wash text-ink",
  } as const;
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${tones[tone]}`}>
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
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-[7px] bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`h-7 shrink-0 rounded-[5px] px-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
            o.value === value ? "bg-surface text-ink shadow-panel" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Dropdown anchored to its trigger; closes on outside click and Escape. */
export function Popover({
  trigger,
  children,
  align = "left",
  width = 280,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          className={`absolute top-[calc(100%+6px)] z-40 max-w-[calc(100vw-32px)] rounded-[10px] bg-surface p-1 shadow-[0_0_0_1px_var(--hairline),0_8px_24px_-6px_rgba(0,0,0,0.18)] ${align === "right" ? "right-0" : "left-0"}`}
          style={{ width }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function SortHeader<K extends string>({
  label,
  sortKey,
  sort,
  desc,
  onSort,
  className = "",
  align = "left",
  title,
}: {
  label: string;
  sortKey: K;
  sort: K;
  desc: boolean;
  onSort: (k: K) => void;
  className?: string;
  align?: "left" | "right";
  title?: string;
}) {
  const active = sort === sortKey;
  return (
    <th className={`px-3 py-2 text-[11px] font-medium text-muted ${align === "right" ? "text-right" : "text-left"} ${className}`} aria-sort={active ? (desc ? "descending" : "ascending") : "none"} title={title}>
      <button onClick={() => onSort(sortKey)} className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-ink ${active ? "text-ink" : ""}`}>
        {label}
        <span className="w-2 text-[9px]">{active ? (desc ? "▼" : "▲") : ""}</span>
      </button>
    </th>
  );
}

export function useSort<K extends string>(initial: K) {
  const [sort, setSort] = useState<K>(initial);
  const [desc, setDesc] = useState(true);
  const onSort = (k: K) => (k === sort ? setDesc(!desc) : (setSort(k), setDesc(true)));
  return { sort, desc, onSort };
}

export function Th({ children, className = "", align = "left", title }: { children?: ReactNode; className?: string; align?: "left" | "right"; title?: string }) {
  return <th title={title} className={`px-3 py-2 text-[11px] font-medium whitespace-nowrap text-muted ${align === "right" ? "text-right" : "text-left"} ${className}`}>{children}</th>;
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-0 text-[13px] sm:grid-cols-2">
      {items.map(([k, v], i) => (
        <div key={i} className="flex items-baseline justify-between gap-3 border-b border-hairline py-1.5">
          <dt className="text-muted">{k}</dt>
          <dd className="text-right text-ink tabular">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
