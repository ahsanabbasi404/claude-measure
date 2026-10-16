"use client";

import { useState } from "react";
import { ago, compact, percent, usd } from "@/lib/format";
import type { Developer } from "./types";
import { Empty, LiveDot, Meter, Panel, Pill, ShareBar, Skeleton } from "./ui";

type SortKey = "usage" | "efficiency" | "weekly" | "context" | "problems" | "recent";

const SORTS: { key: SortKey; label: string; get: (d: Developer) => number }[] = [
  { key: "usage", label: "Usage", get: (d) => d.cost_usd },
  { key: "efficiency", label: "Efficiency", get: (d) => d.efficiency.score ?? -1 },
  { key: "weekly", label: "Weekly limit", get: (d) => d.weekly?.pct ?? -1 },
  { key: "context", label: "Context", get: (d) => d.avg_context ?? -1 },
  { key: "problems", label: "Problems", get: (d) => problems(d) },
  { key: "recent", label: "Last active", get: (d) => Date.parse(d.last_seen) },
];

const problems = (d: Developer) => d.api_errors + d.tool_failures + d.rejections;

export function EfficiencyBadge({ e }: { e: Developer["efficiency"] }) {
  if (e.score === null) return <span className="text-xs text-muted">Not enough data</span>;
  const tone = e.score >= 75 ? "good" : e.score >= 55 ? "neutral" : "critical";
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-7 text-right text-[13px] font-semibold text-ink tabular-nums">{e.score}</span>
      <Pill tone={tone}>{e.label}</Pill>
    </span>
  );
}

export function PeopleTable({ developers, now, onSelect }: { developers: Developer[] | undefined; now: number; onSelect: (dev: string) => void }) {
  const [sort, setSort] = useState<SortKey>("usage");
  const [desc, setDesc] = useState(true);
  const sorter = SORTS.find((s) => s.key === sort)!;
  const rows = developers ? [...developers].sort((a, b) => (desc ? -1 : 1) * (sorter.get(a) - sorter.get(b))) : undefined;

  function header(key: SortKey, label: string, className = "") {
    const active = sort === key;
    return (
      <th className={`px-3 py-2 text-left text-[11px] font-medium text-muted ${className}`} aria-sort={active ? (desc ? "descending" : "ascending") : "none"}>
        <button
          onClick={() => (active ? setDesc(!desc) : (setSort(key), setDesc(true)))}
          className={`inline-flex items-center gap-1 hover:text-ink ${active ? "text-ink" : ""}`}
        >
          {label}
          <span className="w-2 text-[9px]">{active ? (desc ? "▼" : "▲") : ""}</span>
        </button>
      </th>
    );
  }

  return (
    <Panel
      title="People"
      description="Ranked by usage. Efficiency weighs cache reuse, context size, output per $, errors and auto-compactions. Select a row for the breakdown."
      flush
    >
      {!rows ? (
        <div className="space-y-2 px-5 pb-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-11" />)}</div>
      ) : rows.length === 0 ? (
        <Empty title="No activity in this period">
          Install the monitor on a machine from Setup &amp; devices, then use Claude Code. Activity shows here within seconds.
        </Empty>
      ) : (
        <div className="overflow-x-auto border-t border-hairline">
          <table className="w-full min-w-[980px] text-[13px]">
            <thead>
              <tr className="border-b border-hairline">
                <th className="py-2 pr-3 pl-5 text-left text-[11px] font-medium text-muted">Person</th>
                {header("usage", "Share of usage", "w-[200px]")}
                {header("efficiency", "Efficiency")}
                {header("weekly", "Weekly limit", "w-[170px]")}
                {header("context", "Context / request")}
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted">Cache</th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-muted">Auto-compacts</th>
                {header("problems", "Problems")}
                {header("recent", "Last active", "pr-5")}
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const active = now - Date.parse(d.last_seen) < 15 * 60_000;
                const p = problems(d) + d.rate_limited;
                return (
                  <tr
                    key={d.dev}
                    onClick={() => onSelect(d.dev)}
                    className="cursor-pointer border-b border-hairline transition-colors last:border-0 hover:bg-surface-2"
                  >
                    <td className="py-2.5 pr-3 pl-5">
                      <div className="flex items-center gap-2">
                        <LiveDot active={active} />
                        <span className="font-medium text-ink">{d.dev}</span>
                        {d.emails.length > 1 && <Pill tone="warning">{d.emails.length} accounts</Pill>}
                      </div>
                      <div className="mt-0.5 pl-4 text-xs text-muted">
                        {[d.team, d.emails[0]].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-ink tabular-nums">{usd(d.cost_usd)}</span>
                        <span className="text-xs text-muted tabular-nums">{percent(d.share * 100)}</span>
                      </div>
                      <div className="mt-1.5"><ShareBar value={d.share} /></div>
                    </td>
                    <td className="px-3 py-2.5"><EfficiencyBadge e={d.efficiency} /></td>
                    <td className="px-3 py-2.5">
                      {d.weekly ? (
                        <>
                          <div className="flex justify-between text-xs tabular-nums">
                            <span className="text-ink">{Math.round(d.weekly.pct)}%</span>
                            {d.weekly.hitsLimitAt && <span className="text-critical">runs out early</span>}
                          </div>
                          <div className="mt-1"><Meter value={d.weekly.pct} projected={d.weekly.projectedPct} height={5} /></div>
                        </>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{d.avg_context === null ? "—" : `${compact(d.avg_context)}`}</td>
                    <td className="px-3 py-2.5 tabular-nums">{percent(d.cache_hit === null ? null : d.cache_hit * 100)}</td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {d.auto_compactions}
                      <span className="text-muted"> / {d.sessions} sessions</span>
                    </td>
                    <td className={`px-3 py-2.5 tabular-nums ${d.rate_limited ? "text-critical" : p ? "text-ink" : "text-muted"}`}>
                      {p}
                      {d.rate_limited > 0 && <span className="text-xs"> · {d.rate_limited} limited</span>}
                    </td>
                    <td className="py-2.5 pr-5 pl-3 text-xs text-muted">{ago(d.last_seen, now)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
