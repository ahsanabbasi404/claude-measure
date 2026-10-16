"use client";

import { useMemo, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compact, duration, int, percent, usd } from "@/lib/format";
import type { SeriesPoint, Stats } from "./types";
import { Segmented, Skeleton } from "./ui";

type Metric = "cost_usd" | "total_tokens" | "requests";

const METRICS: { value: Metric; label: string; caption: string }[] = [
  { value: "cost_usd", label: "Usage value", caption: "API-equivalent value. Max plans are not billed per token; this is the best single measure of how much limit is consumed." },
  { value: "total_tokens", label: "Tokens", caption: "All tokens processed, including cache reads and writes." },
  { value: "requests", label: "Requests", caption: "Model requests, including subagents and background calls." },
];

const fmt = (m: Metric, v: number) => (m === "cost_usd" ? usd(v) : compact(v));

/** Fills empty buckets so the time axis is continuous. */
function fillSeries(series: SeriesPoint[], since: string, bucket: "hour" | "day", generatedAt: string): SeriesPoint[] {
  const step = bucket === "hour" ? 3600_000 : 86400_000;
  const byKey = new Map(series.map((p) => [new Date(p.bucket).getTime(), p]));
  const start = new Date(since);
  if (bucket === "hour") start.setMinutes(0, 0, 0);
  else start.setHours(0, 0, 0, 0);
  const end = new Date(generatedAt).getTime();
  const out: SeriesPoint[] = [];
  for (let t = start.getTime(); t <= end; t += step) {
    const hit = [...byKey.entries()].find(([k]) => k >= t && k < t + step)?.[1];
    out.push({ bucket: new Date(t).toISOString(), requests: hit?.requests ?? 0, total_tokens: hit?.total_tokens ?? 0, cost_usd: hit?.cost_usd ?? 0 });
  }
  return out;
}

function tickLabel(iso: string, bucket: "hour" | "day") {
  const d = new Date(iso);
  return bucket === "hour"
    ? d.toLocaleTimeString([], { hour: "numeric" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function ChartTooltip({ active, payload, metric, bucket }: {
  active?: boolean;
  payload?: { payload: SeriesPoint }[];
  metric: Metric;
  bucket: "hour" | "day";
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const d = new Date(p.bucket);
  return (
    <div className="rounded-lg bg-surface px-3 py-2 text-xs shadow-panel">
      <div className="text-muted">
        {bucket === "hour"
          ? d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })
          : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="size-2 rounded-full bg-series" />
        <span className="font-semibold text-ink">{fmt(metric, p[metric])}</span>
      </div>
      {metric !== "cost_usd" && <div className="mt-0.5 text-muted">{usd(p.cost_usd)} value</div>}
      {metric !== "requests" && <div className="text-muted">{int(p.requests)} requests</div>}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" }) {
  return (
    <div className="px-5 py-3.5">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${tone === "bad" ? "text-critical" : "text-ink"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function UsagePanel({ stats }: { stats: Stats | undefined }) {
  const [metric, setMetric] = useState<Metric>("cost_usd");
  const data = useMemo(
    () => (stats ? fillSeries(stats.series, stats.since, stats.bucket, stats.generatedAt) : []),
    [stats],
  );
  const t = stats?.totals;
  const headline = t ? (metric === "cost_usd" ? t.cost_usd : metric === "total_tokens" ? t.tokens : t.requests) : 0;
  const caption = METRICS.find((m) => m.value === metric)!.caption;
  const problems = t ? t.api_errors + t.tool_failures + t.rejections : 0;

  return (
    <section className="rounded-[10px] bg-surface shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5">
        <div className="min-w-0">
          <div className="text-xs text-muted">Team usage · {stats ? rangeLabel(stats.range) : "…"}</div>
          {t ? (
            <div className="mt-1 text-[44px] leading-none font-semibold tracking-tight text-ink">{fmt(metric, headline)}</div>
          ) : (
            <Skeleton className="mt-2 h-11 w-40" />
          )}
          <p className="mt-2 max-w-xl text-xs text-muted">{caption}</p>
        </div>
        <Segmented label="Chart metric" value={metric} onChange={setMetric} options={METRICS.map(({ value, label }) => ({ value, label }))} />
      </div>

      <div className="h-[220px] px-2 pt-4">
        {stats ? (
          <ResponsiveContainer width="100%" height="100%">
            {/* Daily totals are discrete, so they render as columns; hourly data reads as a continuous line. */}
            <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis
                dataKey="bucket"
                tickFormatter={(v) => tickLabel(v, stats.bucket)}
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                axisLine={{ stroke: "var(--axis)" }}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis
                tickFormatter={(v) => fmt(metric, v)}
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={56}
              />
              <Tooltip
                cursor={stats.bucket === "day" ? { fill: "var(--surface-2)" } : { stroke: "var(--axis)", strokeWidth: 1 }}
                content={<ChartTooltip metric={metric} bucket={stats.bucket} />}
              />
              {stats.bucket === "day" ? (
                <Bar dataKey={metric} fill="var(--series)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              ) : (
                <Area
                  type="linear"
                  dataKey={metric}
                  stroke="var(--series)"
                  strokeWidth={2}
                  fill="var(--series-wash)"
                  fillOpacity={1}
                  activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2, fill: "var(--series)" }}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <Skeleton className="mx-3 h-full" />
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-b-[10px] border-t border-hairline bg-hairline sm:grid-cols-3 lg:grid-cols-6 [&>*]:bg-surface">
        <Kpi label="People" value={t ? String(t.developers) : "–"} sub={t ? `${t.active_now} active now · ${t.accounts} ${t.accounts === 1 ? "account" : "accounts"}` : undefined} />
        <Kpi label="Sessions" value={t ? int(t.sessions) : "–"} sub={t ? `${int(t.prompts)} prompts` : undefined} />
        <Kpi label="Active time" value={t ? duration(t.active_seconds) : "–"} sub={t && t.active_seconds > 60 ? `${usd(t.cost_usd / (t.active_seconds / 3600))} per active hour` : undefined} />
        <Kpi label="Cache reuse" value={t ? percent(t.cache_hit === null ? null : t.cache_hit * 100) : "–"} sub="higher is cheaper" />
        <Kpi label="Compactions" value={t ? int(t.compactions) : "–"} sub={t ? `${t.auto_compactions} automatic` : undefined} />
        <Kpi
          label="Problems"
          value={t ? int(problems + t.rate_limited) : "–"}
          sub={t ? `${t.rate_limited} rate-limited · ${problems} errors & rejections` : undefined}
          tone={t && t.rate_limited > 0 ? "bad" : undefined}
        />
      </div>
    </section>
  );
}

export function rangeLabel(r: string) {
  return r === "24h" ? "last 24 hours" : r === "7d" ? "last 7 days" : "last 30 days";
}
