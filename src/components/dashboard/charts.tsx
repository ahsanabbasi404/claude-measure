"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compact, int, usd } from "@/lib/format";
import { CATEGORICAL, dimensionLabel, OTHER_COLOR, OTHER_KEY } from "./labels";
import type { Breakdown, Bucket, HeatCell, SeriesRow } from "./types";
import { Swatch } from "./ui";

export type Metric = "cost_usd" | "tokens" | "requests";
export const METRIC_OPTIONS: { value: Metric; label: string }[] = [
  { value: "cost_usd", label: "Usage value" },
  { value: "tokens", label: "Tokens" },
  { value: "requests", label: "Requests" },
];
export const formatMetric = (m: Metric, v: number) => (m === "cost_usd" ? usd(v) : compact(v));

// ---------------------------------------------------------------- bucket labels

function bucketDate(key: string): Date {
  const [date, hour] = key.split("T");
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour ? Number(hour) : 0));
}

/** Bucket keys are already local wall-clock times; format them as UTC so no second shift applies. */
export function bucketLabel(key: string, bucket: Bucket, long = false): string {
  const d = bucketDate(key);
  if (bucket === "hour") {
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", timeZone: "UTC" });
    return long ? `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}, ${time}` : time;
  }
  return d.toLocaleDateString("en-US", long ? { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" });
}

// ---------------------------------------------------------------- series assignment

type Plotted = { key: string; label: string; color: string; total: number };

/**
 * The largest series get their own color, the rest fold into "Other". Colors follow the stable
 * entity order, so an entity keeps its color when filters change.
 */
export function useSeriesKeys(rows: SeriesRow[], metric: Metric, by: Breakdown, order: string[], max = CATEGORICAL.length) {
  return useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of rows) totals.set(r.key, (totals.get(r.key) ?? 0) + r[metric]);
    const ranked = [...totals.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const visible = ranked.length > max ? ranked.slice(0, max - 1) : ranked;
    const used = new Set<number>();
    const plotted: Plotted[] = [];
    // Stable slots first, then free slots for entities outside the stable order.
    for (const [key, total] of visible) {
      const i = order.indexOf(key);
      if (i >= 0 && i < CATEGORICAL.length) {
        used.add(i);
        plotted.push({ key, label: dimensionLabel(by, key), color: CATEGORICAL[i], total });
      }
    }
    for (const [key, total] of visible) {
      if (plotted.some((p) => p.key === key)) continue;
      const free = CATEGORICAL.findIndex((_, i) => !used.has(i));
      used.add(free);
      plotted.push({ key, label: dimensionLabel(by, key), color: free >= 0 ? CATEGORICAL[free] : OTHER_COLOR, total });
    }
    plotted.sort((a, b) => b.total - a.total);
    const rest = ranked.slice(visible.length);
    if (rest.length) {
      plotted.push({ key: OTHER_KEY, label: `Other (${rest.length})`, color: OTHER_COLOR, total: rest.reduce((a, [, v]) => a + v, 0) });
    }
    const mapKey = (k: string) => (plotted.some((p) => p.key === k) ? k : OTHER_KEY);
    return { plotted, mapKey };
  }, [rows, metric, by, order, max]);
}

// ---------------------------------------------------------------- usage chart

type Datum = { bucket: string } & Record<string, number | string>;

function UsageTooltip({ active, payload, plotted, metric, bucket }: {
  active?: boolean;
  payload?: { payload: Datum }[];
  plotted: Plotted[];
  metric: Metric;
  bucket: Bucket;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const items = plotted.map((p) => ({ ...p, value: Number(d[p.key] ?? 0) })).filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  const total = items.reduce((a, p) => a + p.value, 0);
  return (
    <div className="min-w-[180px] rounded-lg bg-surface px-3 py-2 text-xs shadow-[0_0_0_1px_var(--hairline),0_6px_18px_-6px_rgba(0,0,0,0.2)]">
      <div className="text-muted">{bucketLabel(d.bucket, bucket, true)}</div>
      <div className="mt-0.5 text-[15px] font-semibold text-ink">{formatMetric(metric, total)}</div>
      {plotted.length > 1 && items.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {items.map((p) => (
            <li key={p.key} className="flex items-center gap-2">
              <Swatch color={p.color} shape="line" />
              <span className="min-w-0 flex-1 truncate text-ink-2">{p.label}</span>
              <span className="font-medium text-ink tabular">{formatMetric(metric, p.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function UsageChart({
  rows,
  buckets,
  bucket,
  metric,
  by,
  order,
  height = 240,
  view = "chart",
  legendHref,
}: {
  rows: SeriesRow[];
  buckets: string[];
  bucket: Bucket;
  metric: Metric;
  by: Breakdown;
  order: string[];
  height?: number;
  view?: "chart" | "table";
  legendHref?: (key: string) => string | null;
}) {
  const { plotted, mapKey } = useSeriesKeys(rows, metric, by, order);
  const data = useMemo(() => {
    const byBucket = new Map<string, Datum>(buckets.map((b) => [b, { bucket: b }]));
    for (const r of rows) {
      const d = byBucket.get(r.bucket);
      if (!d) continue;
      const k = mapKey(r.key);
      d[k] = Number(d[k] ?? 0) + r[metric];
    }
    return [...byBucket.values()];
  }, [rows, buckets, metric, mapKey]);

  const stacked = plotted.length > 1;
  // Bottom of the stack is the largest series; it is drawn first.
  const drawOrder = [...plotted].filter((p) => p.key !== OTHER_KEY).concat(plotted.filter((p) => p.key === OTHER_KEY));

  if (view === "table") {
    return (
      <div className="max-h-[360px] overflow-auto border-t border-hairline">
        <table className="w-full min-w-[480px] text-xs">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-hairline">
              <th className="px-3 py-2 pl-5 text-left font-medium text-muted">{bucket === "hour" ? "Hour" : "Day"}</th>
              {plotted.map((p) => <th key={p.key} className="px-3 py-2 text-right font-medium whitespace-nowrap text-muted">{p.label}</th>)}
              {stacked && <th className="px-3 py-2 pr-5 text-right font-medium text-muted">Total</th>}
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().map((d) => {
              const total = plotted.reduce((a, p) => a + Number(d[p.key] ?? 0), 0);
              return (
                <tr key={d.bucket} className="border-b border-hairline last:border-0">
                  <td className="px-3 py-1.5 pl-5 whitespace-nowrap text-ink-2">{bucketLabel(d.bucket, bucket, true)}</td>
                  {plotted.map((p) => <td key={p.key} className="px-3 py-1.5 text-right text-ink tabular">{Number(d[p.key] ?? 0) ? formatMetric(metric, Number(d[p.key])) : "–"}</td>)}
                  {stacked && <td className="px-3 py-1.5 pr-5 text-right font-medium text-ink tabular">{formatMetric(metric, total)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      {stacked && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 px-5 pb-2 text-xs">
          {plotted.map((p) => {
            const href = legendHref?.(p.key);
            const body = (
              <>
                <Swatch color={p.color} />
                <span className="text-ink-2">{p.label}</span>
                <span className="text-muted tabular">{formatMetric(metric, p.total)}</span>
              </>
            );
            return (
              <li key={p.key}>
                {href ? <Link href={href} className="inline-flex items-center gap-1.5 hover:underline">{body}</Link> : <span className="inline-flex items-center gap-1.5">{body}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <div style={{ height }} className="px-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 4 }} barCategoryGap={bucket === "hour" ? "18%" : "28%"}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="bucket"
              tickFormatter={(v) => bucketLabel(v, bucket)}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              axisLine={{ stroke: "var(--axis)" }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(v) => formatMetric(metric, v)}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<UsageTooltip plotted={plotted} metric={metric} bucket={bucket} />} />
            {drawOrder.map((p, i) => (
              <Bar
                key={p.key}
                dataKey={p.key}
                stackId="usage"
                fill={p.color}
                stroke="var(--surface)"
                strokeWidth={stacked ? 1 : 0}
                radius={i === drawOrder.length - 1 ? [3, 3, 0, 0] : 0}
                maxBarSize={36}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- small pieces

export function Sparkline({ values, width = 84, height = 22, label }: { values: number[]; width?: number; height?: number; label?: string }) {
  const max = Math.max(...values, 0);
  if (values.length < 2 || max <= 0) {
    return <svg width={width} height={height} aria-hidden><line x1="0" x2={width} y1={height - 1} y2={height - 1} stroke="var(--grid)" /></svg>;
  }
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`);
  return (
    <svg width={width} height={height} role="img" aria-label={label ?? "Daily trend"} className="overflow-visible">
      <polyline points={`0,${height} ${pts.join(" ")} ${width},${height}`} fill="var(--series-wash)" stroke="none" />
      <polyline points={pts.join(" ")} fill="none" stroke="var(--series)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Weekday × hour grid of usage, single-hue sequential scale. */
export function Heatmap({ cells, metric = "cost_usd" }: { cells: HeatCell[]; metric?: "cost_usd" | "requests" }) {
  const [hover, setHover] = useState<HeatCell | null>(null);
  const grid = useMemo(() => {
    const m = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c]));
    return DAYS.map((_, d) => Array.from({ length: 24 }, (_, h) => m.get(`${d + 1}-${h}`) ?? { dow: d + 1, hour: h, cost_usd: 0, requests: 0 }));
  }, [cells]);
  const max = Math.max(0, ...cells.map((c) => c[metric]));
  const total = cells.reduce((a, c) => a + c[metric], 0);
  const peak = cells.length ? [...cells].sort((a, b) => b[metric] - a[metric])[0] : null;
  const fmt = (v: number) => (metric === "cost_usd" ? usd(v) : int(v));
  const hourLabel = (h: number) => new Date(Date.UTC(2020, 0, 1, h)).toLocaleTimeString("en-US", { hour: "numeric", timeZone: "UTC" });

  return (
    <div>
      <div className="mb-2 h-4 text-xs text-muted">
        {hover ? (
          <span><span className="text-ink-2">{DAYS[hover.dow - 1]} {hourLabel(hover.hour)}</span> · <span className="font-medium text-ink">{fmt(hover[metric])}</span> · {int(hover.requests)} requests</span>
        ) : peak && total > 0 ? (
          <span>Busiest: <span className="text-ink-2">{DAYS[peak.dow - 1]} {hourLabel(peak.hour)}</span> ({fmt(peak[metric])})</span>
        ) : "No activity"}
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[520px] grid-cols-[32px_repeat(24,minmax(0,1fr))] gap-[2px]" onMouseLeave={() => setHover(null)}>
          {grid.map((row, d) => (
            <div key={d} className="contents">
              <div className="pr-1 text-[10px] leading-[18px] text-muted">{DAYS[d]}</div>
              {row.map((c) => {
                const v = c[metric];
                const t = max > 0 ? Math.sqrt(v / max) : 0;
                return (
                  <button
                    key={c.hour}
                    type="button"
                    aria-label={`${DAYS[d]} ${hourLabel(c.hour)}: ${fmt(v)}`}
                    onMouseEnter={() => setHover(c)}
                    onFocus={() => setHover(c)}
                    className="h-[18px] rounded-[3px] outline-offset-0 hover:ring-1 hover:ring-ink"
                    style={{ background: v > 0 ? `color-mix(in oklab, var(--series) ${Math.round(12 + t * 88)}%, var(--surface-2))` : "var(--surface-2)" }}
                  />
                );
              })}
            </div>
          ))}
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-center text-[10px] text-muted">{h % 6 === 0 ? hourLabel(h) : ""}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

export type BarItem = { key: string; label: ReactNode; value: number; display: string; sub?: ReactNode; color?: string; href?: string };

/** Ranked horizontal bars with labels above each bar (readable at any width). */
export function BarList({ items, empty = "No data in this period" }: { items: BarItem[]; empty?: string }) {
  const max = Math.max(0, ...items.map((i) => i.value));
  if (!items.length) return <p className="text-xs text-muted">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((i) => {
        const inner = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-ink">{i.label}</span>
              <span className="shrink-0 font-medium text-ink tabular">{i.display}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-surface-2">
              <div className="h-1.5 rounded-full" style={{ width: `${max > 0 ? Math.max(1.5, (i.value / max) * 100) : 0}%`, background: i.color ?? "var(--series)" }} />
            </div>
            {i.sub && <div className="mt-0.5 truncate text-[11px] text-muted">{i.sub}</div>}
          </>
        );
        return (
          <li key={i.key}>
            {i.href ? <Link href={i.href} className="block rounded-md hover:bg-surface-2/60 [&:hover_span:first-child]:underline">{inner}</Link> : inner}
          </li>
        );
      })}
    </ul>
  );
}

/** One horizontal bar split into parts (who uses a shared account). */
export function SplitBar({ parts, height = 8 }: { parts: { key: string; value: number; color: string; label: string }[]; height?: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (total <= 0) return <div className="w-full rounded-full bg-surface-2" style={{ height }} />;
  return (
    <div className="flex w-full gap-[2px] overflow-hidden rounded-full" style={{ height }}>
      {parts.filter((p) => p.value > 0).map((p) => (
        <div key={p.key} title={`${p.label}: ${Math.round((p.value / total) * 100)}%`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
      ))}
    </div>
  );
}
