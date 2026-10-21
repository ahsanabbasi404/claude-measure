"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ago, compact, duration, int, percent, resetsIn, usd } from "@/lib/format";
import { BarList, METRIC_OPTIONS, Sparkline, SplitBar, UsageChart, type Metric } from "./charts";
import { useFilters, useNow, useOptions } from "./hooks";
import { clientLabel, colorFor, dimensionOrder, KIND_HINT, KIND_LABEL, sortEffort } from "./labels";
import type {
  Account, Breakdown, ErrorGroup, FeedItem, Insight, LivePerson, Mix, Person, RangeInfo, SeriesRow, Session,
} from "./types";
import {
  CheckIcon, Empty, LiveDot, Meter, Panel, Pill, Segmented, SeverityIcon, ShareBar, Skeleton, SortHeader, Th, usageSeverity, useSort,
} from "./ui";

// ---------------------------------------------------------------- links

export function useLinks() {
  const { href } = useFilters();
  return {
    person: (name: string) => href(`/people/${encodeURIComponent(name)}`),
    account: (email: string) => href(`/accounts/${encodeURIComponent(email)}`),
    session: (id: string) => href(`/sessions/${encodeURIComponent(id)}`),
    href,
  };
}

export function PersonLink({ name, className = "" }: { name: string; className?: string }) {
  const links = useLinks();
  return <Link href={links.person(name)} className={`hover:underline ${className}`}>{name}</Link>;
}

export function AccountLink({ email, className = "" }: { email: string; className?: string }) {
  const links = useLinks();
  return <Link href={links.account(email)} className={`hover:underline ${className}`}>{email}</Link>;
}

// ---------------------------------------------------------------- usage over time

const BREAKDOWN_LABEL: Record<Breakdown, string> = {
  none: "Total", person: "Person", account: "Account", model: "Model", client: "Client", kind: "Purpose",
};

export function UsagePanel({
  title = "Usage over time",
  data,
  rows,
  by,
  onBy,
  breakdowns,
  height,
  headline,
}: {
  title?: string;
  data: RangeInfo | undefined;
  rows: SeriesRow[] | undefined;
  by: Breakdown;
  onBy: (b: Breakdown) => void;
  breakdowns: Breakdown[];
  height?: number;
  headline?: (metric: Metric) => ReactNode;
}) {
  const [metric, setMetric] = useState<Metric>("cost_usd");
  const [view, setView] = useState<"chart" | "table">("chart");
  const { data: options } = useOptions();
  const links = useLinks();
  const order = useMemo(() => dimensionOrder(by, options), [by, options]);
  const legendHref = (key: string) =>
    by === "person" ? links.person(key) : by === "account" && key.includes("@") ? links.account(key) : null;

  return (
    <Panel
      flush
      title={title}
      description={data ? `${data.bucket === "hour" ? "Hourly" : "Daily"} in ${data.tz.replace(/_/g, " ")} time` : undefined}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Metric" value={metric} onChange={setMetric} options={METRIC_OPTIONS} />
          {breakdowns.length > 1 && (
            <Segmented label="Break down by" value={by} onChange={onBy} options={breakdowns.map((b) => ({ value: b, label: BREAKDOWN_LABEL[b] }))} />
          )}
          <Segmented label="View" value={view} onChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />
        </div>
      }
    >
      {headline && <div className="px-5 pb-2">{headline(metric)}</div>}
      {data && rows ? (
        rows.length === 0 ? (
          <Empty title="No requests in this period">Try a longer range or clear filters.</Empty>
        ) : (
          <div className="pb-4">
            <UsageChart rows={rows} buckets={data.buckets} bucket={data.bucket} metric={metric} by={by} order={order} height={height} view={view} legendHref={legendHref} />
          </div>
        )
      ) : (
        <div className="px-5 pb-5"><Skeleton className="h-[240px]" /></div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- attention

const CATEGORY_LABEL: Record<Insight["category"] | "all", string> = {
  all: "All", limits: "Limits", "heavy-use": "Heavy use", waste: "Waste", errors: "Errors", setup: "Setup",
};
const SEVERITY_LABEL = { critical: "Critical", serious: "High", warning: "Warning", info: "Info" } as const;

export function InsightsPanel({ insights, title = "Needs attention", maxHeight = 420, empty }: { insights: Insight[] | undefined; title?: string; maxHeight?: number; empty?: string }) {
  const [category, setCategory] = useState<Insight["category"] | "all">("all");
  const links = useLinks();
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of insights ?? []) c[i.category] = (c[i.category] ?? 0) + 1;
    return c;
  }, [insights]);
  const shown = (insights ?? []).filter((i) => category === "all" || i.category === category);
  const urgent = insights?.filter((i) => i.severity === "critical" || i.severity === "serious").length ?? 0;
  const cats = (Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).filter((c) => c === "all" || counts[c]);

  return (
    <Panel
      flush
      title={title}
      description={insights ? (insights.length ? `${insights.length} item${insights.length > 1 ? "s" : ""}${urgent ? ` · ${urgent} urgent` : ""}` : undefined) : undefined}
      action={insights && insights.length > 0 && cats.length > 2 ? (
        <Segmented label="Category" value={category} onChange={setCategory} options={cats.map((c) => ({ value: c, label: c === "all" ? "All" : `${CATEGORY_LABEL[c]} ${counts[c]}` }))} />
      ) : undefined}
    >
      {!insights ? (
        <div className="space-y-3 px-5 pb-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
      ) : insights.length === 0 ? (
        <div className="flex items-center gap-2.5 px-5 pb-5 text-sm text-ink-2"><CheckIcon /> {empty ?? "Nothing needs attention in this period."}</div>
      ) : (
        <ul className="overflow-y-auto border-t border-hairline" style={{ maxHeight }}>
          {shown.map((i, n) => {
            const href = i.subjectType === "person" ? links.person(i.subject) : i.subjectType === "account" ? links.account(i.subject) : links.session(i.subject);
            return (
              <li key={`${i.kind}-${i.subject}-${n}`} className="border-b border-hairline last:border-0">
                <Link href={href} className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-surface-2">
                  <span className="mt-0.5"><SeverityIcon severity={i.severity} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-ink">{i.title}</span>
                    {i.detail && <span className="mt-0.5 block text-xs text-muted">{i.detail}</span>}
                  </span>
                  <span className="mt-0.5 shrink-0 text-[11px] text-muted">{SEVERITY_LABEL[i.severity]}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- efficiency

export function EfficiencyBadge({ e }: { e: Person["efficiency"] }) {
  if (e.score === null) return <span className="text-xs text-muted" title="Fewer than 15 requests in this period">Not enough data</span>;
  const tone = e.score >= 75 ? "good" : e.score >= 55 ? "neutral" : "critical";
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-6 text-right text-[13px] font-semibold text-ink tabular">{e.score}</span>
      <Pill tone={tone}>{e.label}</Pill>
    </span>
  );
}

export function EfficiencyBreakdown({ e }: { e: Person["efficiency"] }) {
  if (!e.parts.length) return <p className="text-xs text-muted">Needs at least 15 requests in the period.</p>;
  return (
    <ul className="space-y-3.5">
      {e.parts.map((p) => (
        <li key={p.key}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="font-medium text-ink">{p.label} <span className="font-normal text-muted">· {Math.round(p.weight * 100)}%</span></span>
            <span className="text-right text-xs text-muted">{p.value}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-surface-2">
              <div className="h-1.5 rounded-full" style={{ width: `${Math.max(3, p.score)}%`, background: p.score >= 70 ? "var(--series)" : p.score >= 45 ? "var(--warning)" : "var(--critical)" }} />
            </div>
            <span className="w-7 text-right text-xs text-ink-2 tabular">{Math.round(p.score)}</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">{p.hint}</p>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- limits

function until(iso: string, now: number) {
  const s = (Date.parse(iso) - now) / 1000;
  if (s <= 0) return "0h";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 172800) return `${Math.round(s / 3600)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

export function WeeklyLimit({ a, now, compactView = false }: { a: Pick<Account, "weekly" | "never_reported">; now: number; compactView?: boolean }) {
  const w = a.weekly;
  if (!w) {
    return (
      <p className="text-xs text-muted">
        {a.never_reported
          ? "No limit data: this account is only used from IDE extensions, which do not report limits. Usage value below is the best measure."
          : "No current limit data: the last report is older than this week's window."}
      </p>
    );
  }
  const sev = usageSeverity(w.pct);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={`font-semibold ${sev === "critical" ? "text-critical" : "text-ink"}`}>{Math.round(w.pct)}% of weekly limit</span>
        <span className="text-muted">{resetsIn(w.resetsAt, now)}</span>
      </div>
      <div className="mt-1.5"><Meter value={w.pct} projected={w.projectedPct} height={compactView ? 6 : 8} /></div>
      <div className="mt-1 text-[11px] text-muted">
        {w.hitsLimitAt ? (
          <span className="text-critical">{Date.parse(w.hitsLimitAt) <= now ? "Limit reached" : `Runs out in ~${until(w.hitsLimitAt, now)} at the current pace`}</span>
        ) : w.projectedPct !== null ? (
          <>On pace for {Math.round(w.projectedPct)}% at reset</>
        ) : (
          <>Too early in the week to project</>
        )}
        {w.pacePerDay !== null && ` · ${w.pacePerDay.toFixed(0)}%/day`}
        {` · as of ${ago(w.asOf, now)}`}
      </div>
    </div>
  );
}

export function AccountCard({ a, now }: { a: Account; now: number }) {
  const links = useLinks();
  const { data: options } = useOptions();
  const order = dimensionOrder("person", options);
  const live = a.last_seen ? now - Date.parse(a.last_seen) < 15 * 60_000 : false;
  return (
    <Link href={links.account(a.user_email)} className="block rounded-[10px] bg-surface p-4 shadow-panel transition-colors hover:bg-surface-2/50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <LiveDot active={live} />
            <span className="truncate text-[13px] font-semibold text-ink">{a.user_email}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {a.plan && <Pill>{a.plan}</Pill>}
            {a.people.length > 1 && <Pill tone="warning">Shared by {a.people.length}</Pill>}
            {a.rate_limited > 0 && <Pill tone="critical">{a.rate_limited}× rate-limited</Pill>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[15px] font-semibold text-ink">{usd(a.burn.cost_7d)}</div>
          <div className="text-[11px] text-muted">last 7 days</div>
        </div>
      </div>
      <div className="mt-3"><WeeklyLimit a={a} now={now} compactView /></div>
      {a.five_hour && (
        <div className="mt-2.5">
          <div className="flex justify-between text-[11px] text-muted"><span>5-hour window {Math.round(a.five_hour.pct)}%</span><span>{resetsIn(a.five_hour.resetsAt, now)}</span></div>
          <div className="mt-1"><Meter value={a.five_hour.pct} height={4} /></div>
        </div>
      )}
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-hairline pt-2.5 text-[11px]">
        <div><div className="text-muted">Last hour</div><div className="font-medium text-ink tabular">{usd(a.burn.cost_1h)}</div></div>
        <div><div className="text-muted">Last 5h</div><div className="font-medium text-ink tabular">{usd(a.burn.cost_5h)}</div></div>
        <div><div className="text-muted">Last 24h</div><div className="font-medium text-ink tabular">{usd(a.burn.cost_24h)}</div></div>
      </div>
      {a.people.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[11px] text-muted">Used by, in this period</div>
          <SplitBar parts={a.people.map((p) => ({ key: p.dev, value: p.cost_usd, label: p.dev, color: colorFor(order, p.dev) }))} />
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            {a.people.slice(0, 5).map((p) => (
              <li key={p.dev} className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-[2px]" style={{ background: colorFor(order, p.dev) }} />
                <span className="text-ink-2">{p.dev}</span>
                <span className="text-muted tabular">{a.cost_usd > 0 ? percent((p.cost_usd / a.cost_usd) * 100) : "—"}</span>
              </li>
            ))}
            {a.people.length > 5 && <li className="text-muted">+{a.people.length - 5} more</li>}
          </ul>
        </div>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------- people table

type PeopleSort = "usage" | "trend" | "efficiency" | "weekly" | "context" | "perPrompt" | "perDay" | "opus" | "problems" | "recent";
const problems = (p: Person) => p.api_errors + p.tool_failures + p.rejections;
const PEOPLE_SORTS: Record<PeopleSort, (p: Person) => number> = {
  usage: (p) => p.cost_usd,
  trend: (p) => (p.prev_cost_usd > 0 ? p.cost_usd / p.prev_cost_usd : p.cost_usd > 0 ? 1e9 : -1),
  efficiency: (p) => p.efficiency.score ?? -1,
  weekly: (p) => p.weekly?.pct ?? -1,
  context: (p) => p.avg_context ?? -1,
  perPrompt: (p) => p.cost_per_prompt ?? -1,
  perDay: (p) => p.cost_per_active_day ?? -1,
  opus: (p) => p.opus_share ?? -1,
  problems: (p) => problems(p) + p.rate_limited * 10,
  recent: (p) => (p.last_seen ? Date.parse(p.last_seen) : 0),
};

export function dayList(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${fromDate}T00:00:00Z`); t <= Date.parse(`${toDate}T00:00:00Z`); t += 86400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function PeopleTable({ people, info, search = "" }: { people: Person[] | undefined; info: RangeInfo | undefined; search?: string }) {
  const { sort, desc, onSort } = useSort<PeopleSort>("usage");
  const now = useNow();
  const links = useLinks();
  const days = info ? dayList(info.fromDate, info.toDate) : [];
  const rows = people
    ?.filter((p) => !search || `${p.dev} ${p.team ?? ""} ${p.emails.join(" ")}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (desc ? -1 : 1) * (PEOPLE_SORTS[sort](a) - PEOPLE_SORTS[sort](b)));
  const h = (k: PeopleSort, label: string, extra: { className?: string; align?: "left" | "right"; title?: string } = {}) => (
    <SortHeader label={label} sortKey={k} sort={sort} desc={desc} onSort={onSort} {...extra} />
  );

  if (!rows) return <div className="space-y-2 px-5 pb-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>;
  if (!rows.length) return <Empty title="No people match">Install the monitor on a machine from Setup & devices, or clear filters.</Empty>;

  return (
    <div className="overflow-x-auto border-t border-hairline">
      <table className="w-full min-w-[1180px] text-[13px]">
        <thead>
          <tr className="border-b border-hairline">
            <Th className="pl-5">Person</Th>
            {h("usage", "Usage value", { className: "w-[170px]" })}
            {h("trend", "vs prev.", { title: "Change against the previous period of equal length" })}
            {days.length > 1 && <Th>Daily</Th>}
            {h("efficiency", "Efficiency")}
            {h("weekly", "Weekly limit", { className: "w-[140px]", title: "The most-used account's weekly limit" })}
            {h("perDay", "Per active day", { align: "right" })}
            {h("perPrompt", "Per prompt", { align: "right" })}
            {h("context", "Context / req", { align: "right", title: "Average context sent per main-conversation request" })}
            {h("opus", "Opus", { align: "right", title: "Share of usage value on Opus models" })}
            {h("problems", "Problems", { align: "right" })}
            {h("recent", "Last active", { className: "pr-5" })}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const active = p.last_seen ? now - Date.parse(p.last_seen) < 15 * 60_000 : false;
            const prob = problems(p);
            return (
              <tr key={p.dev} className="border-b border-hairline last:border-0 hover:bg-surface-2/60">
                <td className="py-2.5 pr-3 pl-5">
                  <Link href={links.person(p.dev)} className="group block">
                    <div className="flex items-center gap-2">
                      <LiveDot active={active} />
                      <span className="font-medium text-ink group-hover:underline">{p.dev}</span>
                      {p.emails.length > 1 && <Pill tone="warning" title={p.emails.join(", ")}>{p.emails.length} accounts</Pill>}
                    </div>
                    <div className="mt-0.5 max-w-[260px] truncate pl-4 text-xs text-muted">{[p.team, p.emails[0]].filter(Boolean).join(" · ") || "—"}</div>
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-ink tabular">{usd(p.cost_usd)}</span>
                    <span className="text-xs text-muted tabular">{percent(p.share * 100)}</span>
                  </div>
                  <div className="mt-1.5"><ShareBar value={p.share} /></div>
                </td>
                <td className="px-3 py-2.5 text-xs tabular">
                  {p.prev_cost_usd > 0 ? (
                    <span className={p.cost_usd >= p.prev_cost_usd ? "text-ink" : "text-muted"}>
                      {p.cost_usd >= p.prev_cost_usd ? "▲" : "▼"} {Math.abs(Math.round(((p.cost_usd - p.prev_cost_usd) / p.prev_cost_usd) * 100))}%
                    </span>
                  ) : p.cost_usd > 0 ? <span className="text-muted">new</span> : <span className="text-muted">—</span>}
                </td>
                {days.length > 1 && <td className="px-3 py-2.5"><Sparkline values={days.map((d) => p.daily[d] ?? 0)} label={`${p.dev} daily usage`} /></td>}
                <td className="px-3 py-2.5"><EfficiencyBadge e={p.efficiency} /></td>
                <td className="px-3 py-2.5">
                  {p.weekly ? (
                    <>
                      <div className="flex justify-between text-xs tabular">
                        <span className="text-ink">{Math.round(p.weekly.pct)}%</span>
                        {p.weekly.hitsLimitAt && <span className="text-critical">runs out early</span>}
                      </div>
                      <div className="mt-1"><Meter value={p.weekly.pct} projected={p.weekly.projectedPct} height={5} /></div>
                    </>
                  ) : <span className="text-xs text-muted">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular">{p.cost_per_active_day === null ? "—" : usd(p.cost_per_active_day)}<div className="text-[11px] text-muted">{p.active_days} day{p.active_days === 1 ? "" : "s"}</div></td>
                <td className="px-3 py-2.5 text-right tabular">{p.cost_per_prompt === null ? "—" : usd(p.cost_per_prompt)}<div className="text-[11px] text-muted">{int(p.prompts)} prompts</div></td>
                <td className="px-3 py-2.5 text-right tabular">{p.avg_context === null ? "—" : compact(p.avg_context)}<div className="text-[11px] text-muted">{percent(p.cache_hit === null ? null : p.cache_hit * 100)} cached</div></td>
                <td className="px-3 py-2.5 text-right tabular">{percent(p.opus_share === null ? null : p.opus_share * 100)}</td>
                <td className={`px-3 py-2.5 text-right tabular ${p.rate_limited ? "text-critical" : prob ? "text-ink" : "text-muted"}`}>
                  {prob + p.rate_limited}
                  {p.rate_limited > 0 && <div className="text-[11px]">{p.rate_limited} rate-limited</div>}
                </td>
                <td className="py-2.5 pr-5 pl-3 text-xs whitespace-nowrap text-muted">{p.last_seen ? ago(p.last_seen, now) : "no usage"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- sessions table

type SessionSort = "cost" | "recent" | "duration" | "context" | "requests" | "prompts" | "perPrompt";
const SESSION_SORTS: Record<SessionSort, (s: Session) => number> = {
  cost: (s) => s.cost_usd,
  recent: (s) => Date.parse(s.last_ts),
  duration: (s) => s.duration_s,
  context: (s) => s.peak_context ?? -1,
  requests: (s) => s.requests,
  prompts: (s) => s.prompts,
  perPrompt: (s) => (s.prompts ? s.cost_usd / s.prompts : -1),
};

export function SessionsTable({ sessions, showPerson = true, initialSort = "cost", limit }: { sessions: Session[] | undefined; showPerson?: boolean; initialSort?: SessionSort; limit?: number }) {
  const { sort, desc, onSort } = useSort<SessionSort>(initialSort);
  const now = useNow();
  const links = useLinks();
  const rows = sessions ? [...sessions].sort((a, b) => (desc ? -1 : 1) * (SESSION_SORTS[sort](a) - SESSION_SORTS[sort](b))).slice(0, limit) : undefined;
  const h = (k: SessionSort, label: string, extra: { className?: string; align?: "left" | "right"; title?: string } = {}) => (
    <SortHeader label={label} sortKey={k} sort={sort} desc={desc} onSort={onSort} {...extra} />
  );
  if (!rows) return <div className="space-y-2 px-5 pb-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>;
  if (!rows.length) return <Empty title="No sessions in this period" />;
  return (
    <div className="overflow-x-auto border-t border-hairline">
      <table className="w-full min-w-[980px] text-[13px]">
        <thead>
          <tr className="border-b border-hairline">
            {h("recent", "Session", { className: "pl-5" })}
            {showPerson && <Th>Person · account</Th>}
            {h("cost", "Usage value", { align: "right" })}
            {h("duration", "Duration", { align: "right" })}
            {h("prompts", "Prompts", { align: "right" })}
            {h("perPrompt", "Per prompt", { align: "right" })}
            {h("requests", "Requests", { align: "right" })}
            {h("context", "Peak context", { align: "right", title: "Largest context sent in one main-conversation request" })}
            <Th align="right">Compactions</Th>
            <Th align="right" className="pr-5">Errors</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.session_id} className="border-b border-hairline last:border-0 hover:bg-surface-2/60">
              <td className="py-2 pr-3 pl-5">
                <Link href={links.session(s.session_id)} className="group block">
                  <span className="font-medium text-ink group-hover:underline">{new Date(s.first_ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                  <div className="text-[11px] text-muted">{clientLabel(s.client)} · {s.models.map((m) => m.label).join(", ") || "—"} · {ago(s.last_ts, now)}</div>
                </Link>
              </td>
              {showPerson && (
                <td className="px-3 py-2">
                  <PersonLink name={s.dev} className="text-ink" />
                  <div className="max-w-[220px] truncate text-[11px] text-muted">{s.user_email ?? "—"}</div>
                </td>
              )}
              <td className="px-3 py-2 text-right font-medium text-ink tabular">{usd(s.cost_usd)}</td>
              <td className="px-3 py-2 text-right tabular">{duration(s.duration_s)}</td>
              <td className="px-3 py-2 text-right tabular">{int(s.prompts)}</td>
              <td className="px-3 py-2 text-right tabular">{s.prompts ? usd(s.cost_usd / s.prompts) : "—"}</td>
              <td className="px-3 py-2 text-right tabular">{int(s.requests)}{s.subagent_requests > 0 && <div className="text-[11px] text-muted">{s.subagent_requests} subagent</div>}</td>
              <td className="px-3 py-2 text-right tabular">{s.peak_context === null ? "—" : compact(s.peak_context)}</td>
              <td className="px-3 py-2 text-right tabular">{s.compactions ? `${s.compactions}${s.auto_compactions ? ` (${s.auto_compactions} auto)` : ""}` : "—"}</td>
              <td className={`py-2 pr-5 pl-3 text-right tabular ${s.rate_limited ? "text-critical" : s.errors ? "text-ink" : "text-muted"}`}>{s.errors || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- mix

export function ModelsList({ models, total }: { models: Mix["models"] | undefined; total: number }) {
  const { data: options } = useOptions();
  const order = dimensionOrder("model", options);
  if (!models) return <Skeleton className="h-24" />;
  return (
    <BarList
      items={models.map((m) => ({
        key: m.key, label: <>{m.label} <span className="text-[11px] text-muted">{m.key}</span></>, value: m.cost_usd,
        display: usd(m.cost_usd), color: colorFor(order, m.key),
        sub: `${percent(total ? (m.cost_usd / total) * 100 : null)} · ${int(m.requests)} requests · ${compact(m.tokens)} tokens · ${m.people} ${m.people === 1 ? "person" : "people"}`,
      }))}
    />
  );
}

export function PurposeList({ kinds, total }: { kinds: Mix["kinds"] | undefined; total: number }) {
  const order = dimensionOrder("kind", undefined);
  if (!kinds) return <Skeleton className="h-24" />;
  return (
    <BarList
      items={kinds.map((k) => ({
        key: k.key, label: KIND_LABEL[k.key] ?? k.key, value: k.cost_usd, display: usd(k.cost_usd), color: colorFor(order, k.key),
        sub: `${percent(total ? (k.cost_usd / total) * 100 : null)} · ${int(k.requests)} requests · ${KIND_HINT[k.key] ?? ""}`,
      }))}
    />
  );
}

export function EffortList({ effort }: { effort: Mix["effort"] | undefined }) {
  if (!effort) return <Skeleton className="h-24" />;
  const total = effort.reduce((a, e) => a + e.requests, 0);
  return (
    <BarList
      items={sortEffort(effort).map((e) => ({
        key: e.key, label: e.key === "default" ? "Not reported" : e.key, value: e.requests,
        display: percent(total ? (e.requests / total) * 100 : null),
        sub: `${int(e.requests)} requests · ${usd(e.cost_usd)} · ${e.requests ? usd(e.cost_usd / e.requests) : "—"} per request`,
      }))}
    />
  );
}

export function ToolsTable({ tools }: { tools: Mix["tools"] | undefined }) {
  if (!tools) return <Skeleton className="h-24" />;
  if (!tools.length) return <p className="px-5 pb-5 text-xs text-muted">No tool calls in this period.</p>;
  return (
    <div className="overflow-x-auto border-t border-hairline">
      <table className="w-full text-[13px]">
        <thead><tr className="border-b border-hairline"><Th className="pl-5">Tool</Th><Th align="right">Calls</Th><Th align="right">Failed</Th><Th align="right" className="pr-5">Avg time</Th></tr></thead>
        <tbody>
          {tools.map((t) => (
            <tr key={t.key} className="border-b border-hairline last:border-0">
              <td className="py-1.5 pr-3 pl-5 text-ink">{t.key}</td>
              <td className="px-3 py-1.5 text-right tabular">{int(t.calls)}</td>
              <td className={`px-3 py-1.5 text-right tabular ${t.failures ? "text-critical" : "text-muted"}`}>{t.failures ? `${t.failures} (${percent((t.failures / t.calls) * 100)})` : "—"}</td>
              <td className="py-1.5 pr-5 pl-3 text-right text-muted tabular">{t.avg_ms ? duration(t.avg_ms / 1000) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- errors & activity

const ERROR_LABEL: Record<string, string> = {
  api_error: "API error", api_retries_exhausted: "Retries exhausted", internal_error: "Internal error",
  api_refusal: "Refusal", compaction: "Compaction failed", mcp_server_connection: "MCP server failed", tool_result: "Tool failed",
};

export function ErrorsList({ errors, maxHeight = 420, showPeople = true }: { errors: ErrorGroup[] | undefined; maxHeight?: number; showPeople?: boolean }) {
  const now = useNow();
  if (!errors) return <div className="px-5 pb-5"><Skeleton className="h-9" /></div>;
  if (!errors.length) return <div className="flex items-center gap-2.5 px-5 pb-5 text-sm text-ink-2"><CheckIcon /> No errors in this period.</div>;
  return (
    <ul className="overflow-y-auto border-t border-hairline" style={{ maxHeight }}>
      {errors.map((e, i) => (
        <li key={i} className="border-b border-hairline px-5 py-2.5 last:border-0">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="font-medium text-ink">
              {e.status_code === "429" ? "Rate-limited" : ERROR_LABEL[e.event_name] ?? e.event_name}
              {e.tools.length > 0 && <span className="ml-1.5 font-normal text-muted">{e.tools.join(", ")}</span>}
              {e.status_code && <span className="ml-1.5 text-xs font-normal text-muted">HTTP {e.status_code}</span>}
            </span>
            <span className="shrink-0 text-xs text-muted tabular">{e.count}× · {ago(e.last_seen, now)}</span>
          </div>
          {e.error && <p className="mt-0.5 line-clamp-2 text-xs text-muted" title={e.error}>{e.error}</p>}
          {showPeople && e.people.length > 0 && (
            <p className="mt-0.5 text-[11px] text-muted">{e.people.map((p, n) => <span key={p}>{n > 0 && ", "}<PersonLink name={p} /></span>)}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function describe(f: FeedItem): { label: string; detail: string; tone?: "bad" } {
  switch (f.event_name) {
    case "user_prompt":
      return { label: f.command_name ? `/${f.command_name}` : "Prompt", detail: f.prompt_length ? `${int(Number(f.prompt_length))} characters` : "" };
    case "api_request":
      return { label: "Expensive request", detail: `${f.model ?? ""} · ${compact(f.tokens)} tokens · ${usd(f.cost_usd ?? 0)}` };
    case "api_error":
      return { label: f.status_code === "429" ? "Rate-limited" : "API error", detail: [f.status_code, f.error].filter(Boolean).join(" · "), tone: "bad" };
    case "api_retries_exhausted":
      return { label: "Retries exhausted", detail: f.error ?? "", tone: "bad" };
    case "api_refusal":
      return { label: "Refusal", detail: f.model ?? "" };
    case "internal_error":
      return { label: "Internal error", detail: f.error ?? "", tone: "bad" };
    case "compaction":
      return {
        label: f.trigger === "auto" ? "Auto-compacted" : "Compacted",
        detail: f.pre_tokens ? `${compact(Number(f.pre_tokens))} → ${compact(Number(f.post_tokens ?? 0))} tokens` : f.error ?? "",
        tone: f.error ? "bad" : undefined,
      };
    case "tool_result":
      return { label: "Tool failed", detail: f.tool_name ?? "", tone: "bad" };
    case "tool_decision":
      return { label: "Tool rejected", detail: f.tool_name ?? "" };
    case "subagent_completed":
      return { label: "Subagent finished", detail: f.agent_type ?? "" };
    case "mcp_server_connection":
      return { label: "MCP server failed", detail: f.error ?? "", tone: "bad" };
    case "auth":
      return { label: f.action === "logout" ? "Signed out" : "Signed in", detail: f.user_email ?? "" };
    default:
      return { label: f.event_name, detail: "" };
  }
}

export function FeedList({ feed, maxHeight = 520, showPerson = true }: { feed: FeedItem[] | undefined; maxHeight?: number; showPerson?: boolean }) {
  const now = useNow();
  const links = useLinks();
  if (!feed) return <div className="space-y-2 px-5 pb-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-7" />)}</div>;
  if (!feed.length) return <Empty title="No activity in this period" />;
  return (
    <ul className="overflow-y-auto border-t border-hairline" style={{ maxHeight }}>
      {feed.map((f) => {
        const d = describe(f);
        return (
          <li key={f.id} className={`grid ${showPerson ? "grid-cols-[72px_minmax(0,120px)_minmax(0,1fr)]" : "grid-cols-[72px_minmax(0,1fr)]"} items-baseline gap-3 border-b border-hairline px-5 py-2 text-[13px] last:border-0`}>
            <span className="text-[11px] text-muted tabular" title={new Date(f.ts).toLocaleString()}>{ago(f.ts, now)}</span>
            {showPerson && (f.dev ? <PersonLink name={f.dev} className="truncate text-ink-2" /> : <span className="text-muted">—</span>)}
            <span className="min-w-0 truncate">
              {f.session_id ? (
                <Link href={links.session(f.session_id)} className={`font-medium hover:underline ${d.tone === "bad" ? "text-critical" : "text-ink"}`}>{d.label}</Link>
              ) : (
                <span className={`font-medium ${d.tone === "bad" ? "text-critical" : "text-ink"}`}>{d.label}</span>
              )}
              {d.detail && <span className="ml-2 text-xs text-muted">{d.detail}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function LiveList({ live }: { live: LivePerson[] | undefined }) {
  const now = useNow();
  const links = useLinks();
  if (!live) return <div className="px-5 pb-5"><Skeleton className="h-10" /></div>;
  if (!live.length) return <p className="px-5 pb-5 text-xs text-muted">Nobody is using Claude Code right now.</p>;
  return (
    <ul className="border-t border-hairline">
      {live.map((l) => (
        <li key={l.dev} className="flex items-center gap-3 border-b border-hairline px-5 py-2.5 last:border-0">
          <LiveDot active />
          <div className="min-w-0 flex-1">
            <PersonLink name={l.dev} className="text-[13px] font-medium text-ink" />
            <div className="truncate text-[11px] text-muted">
              {[l.model, clientLabel(l.client), l.user_email].filter(Boolean).join(" · ")} · {ago(l.last_seen, now)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[13px] font-semibold text-ink tabular">{usd(l.cost_1h)}</div>
            <div className="text-[11px] text-muted">last hour{l.session_id && <> · <Link href={links.session(l.session_id)} className="hover:underline">session</Link></>}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

