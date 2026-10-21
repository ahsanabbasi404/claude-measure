"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ago, compact, duration, int, percent, usd } from "@/lib/format";
import { Heatmap } from "./charts";
import { decodeSegment, useApi, useFilters, useNow } from "./hooks";
import { clientLabel } from "./labels";
import { comparisonText, periodText } from "./overview";
import {
  AccountLink, EfficiencyBadge, EfficiencyBreakdown, EffortList, ErrorsList, FeedList, InsightsPanel, ModelsList,
  PurposeList, SessionsTable, ToolsTable, UsagePanel, WeeklyLimit,
} from "./panels";
import { Shell } from "./shell";
import type { Breakdown, PersonDetail } from "./types";
import { Delta, Empty, KeyValue, LiveDot, PageHeader, Panel, Pill, Segmented, Skeleton, StatGrid, StatTile } from "./ui";

/** "1.4× team median" style comparison, or nothing when there is no baseline. */
function vsMedian(value: number | null | undefined, median: number | null | undefined) {
  if (value === null || value === undefined || !median) return undefined;
  const r = value / median;
  return r > 0.9 && r < 1.1 ? "about the team median" : `${r.toFixed(1)}× team median`;
}

export default function PersonPage() {
  const params = useParams<{ name: string }>();
  const name = decodeSegment(params.name);
  const [by, setBy] = useState<Breakdown>("model");
  const [sessionView, setSessionView] = useState<"top" | "recent">("top");
  const { data, error, isPlaceholderData } = useApi<PersonDetail>(`/api/people/${encodeURIComponent(name)}`, { by });
  const { href } = useFilters();
  const now = useNow();
  const p = data?.person;
  const prev = data?.previous;
  const med = data?.team.median;
  const live = p?.last_seen ? now - Date.parse(p.last_seen) < 15 * 60_000 : false;

  return (
    <Shell updatedAt={data?.generatedAt} error={error ? error.message : null} refreshing={isPlaceholderData} hideFilters={["person"]}>
      <div className="text-xs text-muted"><Link href={href("/people")} className="hover:text-ink">People</Link> / {name}</div>
      <PageHeader
        title={<span className="inline-flex items-center gap-2.5">{name}{p && <LiveDot active={live} />}</span>}
        meta={data && (
          <>
            {p?.team && <span>Team {p.team}</span>}
            <span>{periodText(data)}</span>
            {p?.last_seen && <span>Last active {ago(p.last_seen, now)}</span>}
            {p && p.clients.map((c) => <Pill key={c}>{clientLabel(c)}</Pill>)}
            {p && <EfficiencyBadge e={p.efficiency} />}
          </>
        )}
      />

      {data && !p ? (
        <Panel><Empty title={`No usage from ${name} in this period`}>Pick a longer range or clear other filters.</Empty></Panel>
      ) : (
        <>
          <StatGrid className="grid-cols-2 md:grid-cols-4">
            <StatTile label="Usage value" value={p ? usd(p.cost_usd) : "–"} delta={p && <Delta current={p.cost_usd} previous={prev?.cost_usd} />}
              sub={p && data ? `${percent(p.share * 100)} of team · #${data.team.rank.usage} of ${data.team.people}` : undefined} />
            <StatTile label="Per active day" value={p?.cost_per_active_day != null ? usd(p.cost_per_active_day) : "–"}
              sub={p ? `${p.active_days} active day${p.active_days === 1 ? "" : "s"} · ${vsMedian(p.cost_per_active_day, med?.cost_per_active_day) ?? "no baseline"}` : undefined} />
            <StatTile label="Per prompt" value={p?.cost_per_prompt != null ? usd(p.cost_per_prompt) : "–"}
              sub={p ? `${int(p.prompts)} prompts · ${vsMedian(p.cost_per_prompt, med?.cost_per_prompt) ?? "no baseline"}` : undefined} />
            <StatTile label="Context per request" hint="Average context sent per main-conversation request" value={p?.avg_context != null ? compact(p.avg_context) : "–"}
              sub={p ? `peak ${p.peak_context ? compact(p.peak_context) : "—"} · ${vsMedian(p.avg_context, med?.avg_context) ?? "no baseline"}` : undefined} />
            <StatTile label="Sessions" value={p ? int(p.sessions) : "–"} delta={p && <Delta current={p.sessions} previous={prev?.sessions} />}
              sub={p ? `${int(p.requests)} requests · ${p.sessions ? usd(p.cost_usd / p.sessions) : "—"} each` : undefined} />
            <StatTile label="Active time" value={p ? duration(p.active_seconds) : "–"} delta={p && <Delta current={p.active_seconds} previous={prev?.active_seconds} />}
              sub={p?.cost_per_active_hour != null ? `${usd(p.cost_per_active_hour)} per active hour` : undefined} />
            <StatTile label="Lines changed" value={p ? compact(p.lines_added + p.lines_removed) : "–"}
              sub={p ? `+${compact(p.lines_added)} −${compact(p.lines_removed)} · ${p.commits} commits · ${p.pull_requests} PRs` : undefined} />
            <StatTile label="Problems" tone={p && p.rate_limited > 0 ? "bad" : undefined}
              value={p ? int(p.api_errors + p.tool_failures + p.rejections) : "–"}
              sub={p ? `${p.rate_limited} rate-limited · ${p.tool_failures} tool failures · ${p.auto_compactions} auto-compactions` : undefined} />
          </StatGrid>
          {data && <p className="-mt-2 text-[11px] text-muted">{comparisonText(data)}</p>}

          <UsagePanel data={data} rows={data?.series} by={by} onBy={setBy} breakdowns={["none", "model", "account", "client", "kind"]} />

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Accounts used" description="Usage value this person drew from each account, and that account's limit">
              {!data ? <Skeleton className="h-24" /> : data.accounts.length === 0 ? <p className="text-xs text-muted">No account information in this period.</p> : (
                <ul className="space-y-4">
                  {data.accounts.map((a) => (
                    <li key={a.user_email}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium">
                          <AccountLink email={a.user_email} className="truncate text-ink" />
                          {a.plan && <Pill>{a.plan}</Pill>}
                          {a.people.length > 1 && <Pill tone="warning">shared by {a.people.length}</Pill>}
                        </span>
                        <span className="text-xs text-muted tabular">{usd(a.person_cost_usd)} by {name} · {a.cost_usd > 0 ? percent((a.person_cost_usd / a.cost_usd) * 100) : "—"} of its usage</span>
                      </div>
                      <div className="mt-2"><WeeklyLimit a={a} now={now} compactView /></div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Efficiency breakdown" description={med?.efficiency ? `Team median score ${Math.round(med.efficiency)}` : "How the score is made up"}>
              {p ? <EfficiencyBreakdown e={p.efficiency} /> : <Skeleton className="h-40" />}
            </Panel>
          </div>

          <InsightsPanel insights={data?.insights} title={`Attention items for ${name}`} empty="Nothing stands out for this person in this period." maxHeight={360} />

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Models"><ModelsList models={data?.models} total={p?.cost_usd ?? 0} /></Panel>
            <Panel title="Where usage goes"><PurposeList kinds={data?.kinds} total={p?.cost_usd ?? 0} /></Panel>
            <Panel title="Effort levels"><EffortList effort={data?.effort} /></Panel>
          </div>

          <Panel
            flush
            title="Sessions"
            description="Select a session for request-by-request context growth and per-prompt cost"
            action={<Segmented label="Sessions" value={sessionView} onChange={setSessionView} options={[{ value: "top", label: "Most expensive" }, { value: "recent", label: "Most recent" }]} />}
          >
            <SessionsTable sessions={data?.sessions[sessionView]} showPerson={false} initialSort={sessionView === "top" ? "cost" : "recent"} key={sessionView} />
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="When they work" description={data ? `${data.tz.replace(/_/g, " ")} time` : undefined}>
              {data ? <Heatmap cells={data.heatmap} /> : <Skeleton className="h-40" />}
            </Panel>
            <Panel flush title="Tools" description="Calls, failures and average duration">
              <ToolsTable tools={data?.tools} />
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel flush title="Errors"><ErrorsList errors={data?.errors} showPeople={false} maxHeight={360} /></Panel>
            <Panel flush title="Recent activity" description="Prompts, expensive requests, compactions and failures">
              <FeedList feed={data?.activity} showPerson={false} maxHeight={360} />
            </Panel>
          </div>

          <Panel title="Machines and clients">
            {!data ? <Skeleton className="h-16" /> : (
              <div className="space-y-4">
                <KeyValue items={[
                  ["Claude Code versions", p?.app_versions.join(", ") || "—"],
                  ["Clients", p?.clients.map(clientLabel).join(", ") || "—"],
                  ["Hosts", p?.hosts.join(", ") || "—"],
                  ["Subagent share", percent(p?.subagent_share == null ? null : p.subagent_share * 100)],
                  ["Opus share", percent(p?.opus_share == null ? null : p.opus_share * 100)],
                  ["Cache reuse", percent(p?.cache_hit == null ? null : p.cache_hit * 100)],
                ]} />
                {data.devices.length > 0 && (
                  <ul className="space-y-1 text-xs text-muted">
                    {data.devices.map((d) => (
                      <li key={d.device_id}>
                        <span className="text-ink-2">{d.host_name ?? d.device_id}</span> · {d.os_type ?? "?"} · agent v{d.agent_version ?? "?"} · last check-in {ago(d.last_heartbeat, now)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Panel>
        </>
      )}
    </Shell>
  );
}
