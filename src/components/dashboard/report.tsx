"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { compact, int, percent, usd } from "@/lib/format";
import { useApi, useFilters } from "./hooks";
import { COST_PARTS } from "./labels";
import { comparisonText, periodText } from "./overview";
import { PersonLink, useLinks } from "./panels";
import { Shell } from "./shell";
import type { CostSplit, Report, ReportLesson, ReportPerson } from "./types";
import { CheckIcon, Delta, Empty, PageHeader, Panel, Pill, SeverityIcon, Skeleton, StatGrid, StatTile, Swatch, Th } from "./ui";

function CostSplitBar({ split, total, legend = true }: { split: CostSplit; total: number; legend?: boolean }) {
  return (
    <div>
      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-surface-2">
        {total > 0 && COST_PARTS.map((p) => split[p.key] > 0 && (
          <div key={p.key} style={{ width: `${(split[p.key] / total) * 100}%`, background: p.color }} title={`${p.label}: ${usd(split[p.key])}`} />
        ))}
      </div>
      {legend && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          {COST_PARTS.map((p) => (
            <li key={p.key} className="inline-flex items-center gap-1.5">
              <Swatch color={p.color} /><span className="text-ink-2">{p.label}</span>
              <span className="text-muted tabular">{usd(split[p.key])} · {percent(total ? (split[p.key] / total) * 100 : null)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LessonList({ lessons, empty }: { lessons: ReportLesson[]; empty: string }) {
  const links = useLinks();
  if (!lessons.length) return <p className="flex items-center gap-2 px-5 pb-4 text-sm text-ink-2"><CheckIcon size={14} /> {empty}</p>;
  return (
    <ul className="border-t border-hairline">
      {lessons.map((l, i) => (
        <li key={`${l.kind}-${i}`} className="flex gap-3 border-b border-hairline px-5 py-3 last:border-0">
          <span className="mt-0.5"><SeverityIcon severity={l.severity} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-ink">{l.title}</div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{l.detail}</p>
            {(l.session_id || (l.people && l.people.length > 0)) && (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {l.session_id && <Link href={links.session(l.session_id)} className="text-ink-2 underline decoration-hairline underline-offset-2 hover:text-ink">See the session →</Link>}
                {l.people?.slice(0, 6).map((p) => <PersonLink key={p} name={p} className="text-ink-2" />)}
              </div>
            )}
          </div>
          {l.impact_usd !== null && l.impact_usd > 0.05 && <span className="shrink-0 text-xs font-medium text-ink tabular">~{usd(l.impact_usd)}</span>}
        </li>
      ))}
    </ul>
  );
}

function PersonSection({ p, medianHourly }: { p: ReportPerson; medianHourly: number | null }) {
  const links = useLinks();
  const urgent = p.lessons.filter((l) => l.severity !== "info").length;
  return (
    <Panel
      id={`person-${encodeURIComponent(p.dev)}`}
      flush
      title={
        <span className="flex flex-wrap items-center gap-2">
          <PersonLink name={p.dev} className="text-[15px]" />
          {p.team && <span className="text-xs font-normal text-muted">{p.team}</span>}
          {urgent > 0 ? <Pill tone="warning">{urgent} to fix</Pill> : <Pill tone="good">No issues</Pill>}
        </span>
      }
      action={<span className="text-[15px] font-semibold text-ink tabular">{usd(p.cost_usd)}</span>}
    >
      <div className="grid gap-4 px-5 pb-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <dl className="grid grid-cols-3 gap-2 text-xs">
          {[
            ["Sessions", `${p.sessions}`, `${int(p.prompts)} prompts`],
            ["Active time", `${p.active_hours.toFixed(1)}h`, p.cost_per_active_hour !== null ? `${usd(p.cost_per_active_hour)}/hour${medianHourly ? ` · team ${usd(medianHourly)}` : ""}` : "—"],
            ["Parallel", `up to ${p.max_parallel}`, `${p.avg_parallel.toFixed(1)} on average`],
            ["Cache rebuilds", usd(p.avoidable_usd), `${percent(p.cost_usd ? (p.avoidable_usd / p.cost_usd) * 100 : null)} of usage`],
            ["Over 400K context", usd(p.large_context_usd), `peak ${compact(p.peak_context)}`],
            ["Subagents", usd(p.subagent_usd), percent(p.cost_usd ? (p.subagent_usd / p.cost_usd) * 100 : null)],
          ].map(([label, value, sub]) => (
            <div key={label} className="rounded-lg bg-surface-2 px-2.5 py-2">
              <dt className="text-[11px] text-muted">{label}</dt>
              <dd className="text-[14px] font-semibold text-ink tabular">{value}</dd>
              <dd className="truncate text-[11px] text-muted">{sub}</dd>
            </div>
          ))}
        </dl>
        <div className="space-y-3">
          <CostSplitBar split={p.split} total={p.cost_usd} legend={false} />
          <div className="text-[11px] text-muted">
            {p.models.slice(0, 3).map((m) => `${m.label} ${usd(m.cost_usd)}`).join(" · ")}
          </div>
          {p.sessions_list.length > 0 && (
            <ul className="space-y-1 text-xs">
              {p.sessions_list.slice(0, 3).map((s) => (
                <li key={s.session_id} className="flex items-baseline justify-between gap-3">
                  <Link href={links.session(s.session_id)} className="min-w-0 truncate text-ink-2 hover:text-ink hover:underline">
                    {new Date(s.first_ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} session · {s.requests} requests{s.top ? ` · ${s.top}` : ""}
                  </Link>
                  <span className="shrink-0 font-medium text-ink tabular">{usd(s.cost)}{s.avoidable > 0.5 && <span className="font-normal text-muted"> ({usd(s.avoidable)} rebuilds)</span>}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <LessonList lessons={p.lessons} empty="Nothing to improve in this period." />
    </Panel>
  );
}

export default function ReportPage() {
  const params = useSearchParams();
  const { set } = useFilters();
  const hasRange = params.has("range");
  // The report is a daily summary by default.
  useEffect(() => {
    if (!hasRange) set({ range: "today" });
  }, [hasRange, set]);
  const { data, error, isPlaceholderData } = useApi<Report>(hasRange ? "/api/report" : null);
  const t = data?.totals;
  const prev = data?.previous;
  const single = data && data.fromDate === data.toDate;
  const active = data?.people.filter((p) => p.cost_usd > 0) ?? [];

  return (
    <Shell updatedAt={data?.generatedAt} error={error ? error.message : null} refreshing={isPlaceholderData}>
      <PageHeader
        title={single ? "Daily report" : "Report"}
        meta={data ? <><span>{periodText(data)}</span><span>{comparisonText(data)}</span></> : <Skeleton className="h-4 w-40" />}
      />

      <StatGrid className="grid-cols-2 md:grid-cols-4">
        <StatTile label="Usage value" value={t ? usd(t.cost_usd) : "–"} delta={t && <Delta current={t.cost_usd} previous={prev?.cost_usd} />}
          sub={t ? `${t.people} people · ${t.sessions} sessions · ${int(t.prompts)} prompts` : undefined} />
        <StatTile label="Lost to cache rebuilds" tone={t && t.avoidable_usd > 0.1 * t.cost_usd ? "bad" : undefined}
          hint="Extra paid for rewriting context that could have been read from cache: idle pauses, model switches, resumed sessions, changed context"
          value={t ? usd(t.avoidable_usd) : "–"} sub={t ? `${percent(t.cost_usd ? (t.avoidable_usd / t.cost_usd) * 100 : null)} of usage value` : undefined} />
        <StatTile label="Active time" value={t ? `${t.active_hours.toFixed(1)}h` : "–"}
          sub={t ? `${t.active_hours > 0 ? usd(t.cost_usd / t.active_hours) : "—"} per active hour · median ${t.median_cost_per_active_hour ? usd(t.median_cost_per_active_hour) : "—"}` : undefined} />
        <StatTile label="Biggest spender" value={active[0] ? active[0].dev : "–"}
          sub={active[0] && t ? `${usd(active[0].cost_usd)} · ${percent((active[0].cost_usd / t.cost_usd) * 100)} of usage` : undefined} />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel flush title="Team lessons" description="What cost the most across everyone, and who it affects">
          {!data ? <div className="px-5 pb-5"><Skeleton className="h-32" /></div> : <LessonList lessons={data.lessons} empty="No team-wide patterns in this period." />}
        </Panel>
        <Panel title="Where the money went" description="Team usage value by what each request paid for">
          {t ? <CostSplitBar split={t.split} total={t.cost_usd} /> : <Skeleton className="h-16" />}
          {data && (
            <div className="mt-4 border-t border-hairline pt-3">
              <div className="mb-2 text-xs font-medium text-ink">Cache rebuilds by cause</div>
              <ul className="space-y-1.5 text-xs">
                {([["idle", "Idle pauses"], ["model-switch", "Model switches"], ["resumed", "Resumed sessions"], ["context-changed", "Changed context"]] as const).map(([key, label]) => (
                  <li key={key} className="flex justify-between gap-3">
                    <span className="text-ink-2">{label} <span className="text-muted">· {data.breaks[key].count}×</span></span>
                    <span className="text-right tabular"><span className="font-medium text-ink">{usd(data.breaks[key].extra_usd)}</span>
                      {data.breaks[key].people.length > 0 && <span className="text-muted"> · {data.breaks[key].people.slice(0, 3).join(", ")}</span>}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>

      <Panel flush title="Everyone at a glance" description="Select a name to jump to their lessons">
        {!data ? <div className="px-5 pb-5"><Skeleton className="h-24" /></div> : active.length === 0 ? <Empty title="No usage in this period" /> : (
          <div className="overflow-x-auto border-t border-hairline">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="border-b border-hairline">
                  <Th className="pl-5">Person</Th><Th align="right">Usage value</Th><Th align="right">Per active hour</Th><Th align="right">Parallel</Th>
                  <Th align="right">Cache rebuilds</Th><Th align="right">Over 400K ctx</Th><Th align="right">Subagents</Th><Th className="pr-5">Top issue</Th>
                </tr>
              </thead>
              <tbody>
                {active.map((p) => (
                  <tr key={p.dev} className="border-b border-hairline last:border-0 hover:bg-surface-2/60">
                    <td className="py-2 pr-3 pl-5"><a href={`#person-${encodeURIComponent(p.dev)}`} className="font-medium text-ink hover:underline">{p.dev}</a></td>
                    <td className="px-3 py-2 text-right font-medium tabular">{usd(p.cost_usd)}</td>
                    <td className={`px-3 py-2 text-right tabular ${t?.median_cost_per_active_hour && p.cost_per_active_hour && p.cost_per_active_hour > 2 * t.median_cost_per_active_hour ? "font-medium text-critical" : ""}`}>
                      {p.cost_per_active_hour === null ? "—" : usd(p.cost_per_active_hour)}
                    </td>
                    <td className="px-3 py-2 text-right tabular">{p.max_parallel}</td>
                    <td className="px-3 py-2 text-right tabular">{usd(p.avoidable_usd)}</td>
                    <td className="px-3 py-2 text-right tabular">{percent(p.cost_usd ? (p.large_context_usd / p.cost_usd) * 100 : null)}</td>
                    <td className="px-3 py-2 text-right tabular">{percent(p.cost_usd ? (p.subagent_usd / p.cost_usd) * 100 : null)}</td>
                    <td className="max-w-[320px] truncate py-2 pr-5 pl-3 text-xs text-muted">{p.lessons[0]?.title ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {data && data.days.length > 1 && (
        <Panel flush title="Day by day">
          <div className="overflow-x-auto border-t border-hairline">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead><tr className="border-b border-hairline"><Th className="pl-5">Day</Th><Th align="right">Usage value</Th><Th align="right">People</Th><Th align="right">Sessions</Th><Th align="right">Cache rebuilds</Th><Th className="pr-5">Top spender</Th></tr></thead>
              <tbody>
                {data.days.map((d) => (
                  <tr key={d.day} className="border-b border-hairline last:border-0">
                    <td className="py-2 pr-3 pl-5 text-ink">{new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</td>
                    <td className="px-3 py-2 text-right font-medium tabular">{usd(d.cost_usd)}</td>
                    <td className="px-3 py-2 text-right tabular">{d.people}</td>
                    <td className="px-3 py-2 text-right tabular">{d.sessions}</td>
                    <td className="px-3 py-2 text-right tabular">{usd(d.avoidable_usd)}</td>
                    <td className="py-2 pr-5 pl-3 text-xs">{d.top_person ? <><PersonLink name={d.top_person} className="text-ink" /> <span className="text-muted">{usd(d.top_cost_usd)}</span></> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <h2 className="pt-2 text-[15px] font-semibold text-ink">Lessons for each person</h2>
      {!data ? <Skeleton className="h-60" /> : active.map((p) => <PersonSection key={p.dev} p={p} medianHourly={t?.median_cost_per_active_hour ?? null} />)}
    </Shell>
  );
}
