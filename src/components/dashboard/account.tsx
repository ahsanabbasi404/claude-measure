"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ago, compact, int, percent, resetsIn, usd } from "@/lib/format";
import { Heatmap } from "./charts";
import { decodeSegment, useApi, useFilters, useNow, useOptions } from "./hooks";
import { clientLabel, colorFor, dimensionOrder } from "./labels";
import { comparisonText, periodText } from "./overview";
import {
  EffortList, ErrorsList, InsightsPanel, ModelsList, PersonLink, PurposeList, SessionsTable, UsagePanel, WeeklyLimit,
} from "./panels";
import { Shell } from "./shell";
import type { AccountDetail, Breakdown } from "./types";
import { Delta, Empty, KeyValue, LiveDot, Meter, PageHeader, Panel, Pill, ShareBar, Skeleton, StatGrid, StatTile, Th } from "./ui";

function LimitHistory({ history }: { history: AccountDetail["history"] }) {
  const data = useMemo(() => history.filter((h) => h.weekly !== null).map((h) => ({ t: Date.parse(h.ts), weekly: h.weekly, dev: h.dev })), [history]);
  if (data.length < 2) return <p className="text-xs text-muted">Not enough limit reports for a history yet ({data.length} report{data.length === 1 ? "" : "s"} in 30 days).</p>;
  return (
    <div className="h-[160px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(v) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={{ stroke: "var(--axis)" }} tickLine={false} minTickGap={30} />
          <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <div className="rounded-lg bg-surface px-3 py-2 text-xs shadow-panel">
              <div className="text-muted">{new Date(payload[0].payload.t).toLocaleString()}</div>
              <div className="font-semibold text-ink">{Math.round(payload[0].payload.weekly)}% weekly</div>
              {payload[0].payload.dev && <div className="text-muted">reported by {payload[0].payload.dev}</div>}
            </div>
          ) : null} />
          <Line type="linear" dataKey="weekly" stroke="var(--series)" strokeWidth={2} dot={{ r: 3, fill: "var(--series)", stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function AccountPage() {
  const params = useParams<{ email: string }>();
  const email = decodeSegment(params.email);
  const [by, setBy] = useState<Breakdown>("person");
  const { data, error, isPlaceholderData } = useApi<AccountDetail>(`/api/accounts/${encodeURIComponent(email)}`, { by });
  const { data: options } = useOptions();
  const { href } = useFilters();
  const now = useNow();
  const a = data?.account;
  const prev = data?.previous;
  const order = dimensionOrder("person", options);
  const live = a?.last_seen ? now - Date.parse(a.last_seen) < 15 * 60_000 : false;

  return (
    <Shell updatedAt={data?.generatedAt} error={error ? error.message : null} refreshing={isPlaceholderData} hideFilters={["account"]}>
      <div className="text-xs text-muted"><Link href={href("/accounts")} className="hover:text-ink">Accounts</Link> / {email}</div>
      <PageHeader
        title={<span className="inline-flex items-center gap-2.5">{email}{a && <LiveDot active={live} />}</span>}
        meta={data && (
          <>
            {a?.plan && <Pill>{a.plan}</Pill>}
            {a?.display_name && <span>{a.display_name}</span>}
            <span>{periodText(data)}</span>
            {a?.last_seen && <span>Last used {ago(a.last_seen, now)}</span>}
            {a?.clients.map((c) => <Pill key={c}>{clientLabel(c)}</Pill>)}
          </>
        )}
      />

      {data && !a ? (
        <Panel><Empty title="This account has not been seen">It appears after the first request from an installed device.</Empty></Panel>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <Panel title="Limits" description="Current state, independent of the selected range">
              {!a ? <Skeleton className="h-28" /> : (
                <div className="space-y-4">
                  <WeeklyLimit a={a} now={now} />
                  {a.five_hour && (
                    <div>
                      <div className="flex justify-between text-xs"><span className="font-semibold text-ink">{Math.round(a.five_hour.pct)}% of 5-hour window</span><span className="text-muted">{resetsIn(a.five_hour.resetsAt, now)}</span></div>
                      <div className="mt-1.5"><Meter value={a.five_hour.pct} height={8} /></div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[["Last hour", a.burn.cost_1h], ["Last 5 hours", a.burn.cost_5h], ["Last 24 hours", a.burn.cost_24h], ["Last 7 days", a.burn.cost_7d]].map(([label, v]) => (
                      <div key={label as string} className="rounded-lg bg-surface-2 px-3 py-2">
                        <div className="text-[11px] text-muted">{label}</div>
                        <div className="text-[15px] font-semibold text-ink tabular">{usd(v as number)}</div>
                      </div>
                    ))}
                  </div>
                  {a.burn.cost_window !== null && a.weekly && (
                    <p className="text-xs text-muted">
                      {usd(a.burn.cost_window)} used since this week&apos;s window started
                      {a.weekly.pct > 0 && <> · about {usd(a.burn.cost_window / a.weekly.pct)} per 1% of the weekly limit</>}
                    </p>
                  )}
                </div>
              )}
            </Panel>
            <Panel title="Weekly limit history" description="Status line reports over the last 30 days">
              {data ? <LimitHistory history={data.history} /> : <Skeleton className="h-36" />}
            </Panel>
          </div>

          <StatGrid className="grid-cols-2 md:grid-cols-4">
            <StatTile label="Usage value" value={a ? usd(a.cost_usd) : "–"} delta={a && <Delta current={a.cost_usd} previous={prev?.cost_usd} />} sub={a ? `${percent(a.share * 100)} of all accounts` : undefined} />
            <StatTile label="People" value={data ? String(data.people.length) : "–"} sub={data && data.people.length > 1 ? "share this weekly limit" : undefined} />
            <StatTile label="Sessions" value={a ? int(a.sessions) : "–"} delta={a && <Delta current={a.sessions} previous={prev?.sessions} />} sub={a ? `${int(a.prompts)} prompts · ${int(a.requests)} requests` : undefined} />
            <StatTile label="Rate-limited" value={a ? int(a.rate_limited) : "–"} tone={a && a.rate_limited > 0 ? "bad" : undefined}
              sub={a ? `Opus ${percent(a.cost_usd ? (a.opus_cost_usd / a.cost_usd) * 100 : null)} of value · ${compact(a.total_tokens)} tokens` : undefined} />
          </StatGrid>
          {data && <p className="-mt-2 text-[11px] text-muted">{comparisonText(data)}</p>}

          <UsagePanel data={data} rows={data?.series} by={by} onBy={setBy} breakdowns={["person", "model", "client", "kind", "none"]} />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Panel flush title="Who uses this account" description="Share of this account's usage value in the selected period">
              {!data ? <div className="px-5 pb-5"><Skeleton className="h-24" /></div> : data.people.length === 0 ? <Empty title="No usage in this period" /> : (
                <div className="overflow-x-auto border-t border-hairline">
                  <table className="w-full min-w-[620px] text-[13px]">
                    <thead><tr className="border-b border-hairline"><Th className="pl-5">Person</Th><Th className="w-[200px]">Share</Th><Th align="right">Sessions</Th><Th align="right">Per prompt</Th><Th align="right">Context / req</Th><Th align="right" className="pr-5">Last used</Th></tr></thead>
                    <tbody>
                      {data.people.map((p) => {
                        const share = a && a.cost_usd > 0 ? p.cost_usd / a.cost_usd : 0;
                        return (
                          <tr key={p.dev} className="border-b border-hairline last:border-0">
                            <td className="py-2 pr-3 pl-5"><span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-[3px]" style={{ background: colorFor(order, p.dev) }} /><PersonLink name={p.dev} className="font-medium text-ink" /></span></td>
                            <td className="px-3 py-2">
                              <div className="flex justify-between text-xs tabular"><span className="font-medium text-ink">{usd(p.cost_usd)}</span><span className="text-muted">{percent(share * 100)}</span></div>
                              <div className="mt-1"><ShareBar value={share} color={colorFor(order, p.dev)} /></div>
                            </td>
                            <td className="px-3 py-2 text-right tabular">{int(p.sessions)}</td>
                            <td className="px-3 py-2 text-right tabular">{p.cost_per_prompt === null ? "—" : usd(p.cost_per_prompt)}</td>
                            <td className="px-3 py-2 text-right tabular">{p.avg_context === null ? "—" : compact(p.avg_context)}</td>
                            <td className="py-2 pr-5 pl-3 text-right text-xs text-muted">{p.last_seen ? ago(p.last_seen, now) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            <InsightsPanel insights={data?.insights} title="Attention items" empty="Nothing stands out for this account." maxHeight={360} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Models"><ModelsList models={data?.models} total={a?.cost_usd ?? 0} /></Panel>
            <Panel title="Where usage goes"><PurposeList kinds={data?.kinds} total={a?.cost_usd ?? 0} /></Panel>
            <Panel title="Effort levels"><EffortList effort={data?.effort} /></Panel>
          </div>

          <Panel flush title="Most expensive sessions on this account"><SessionsTable sessions={data?.sessions} limit={12} /></Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="When it is used" description={data ? `${data.tz.replace(/_/g, " ")} time` : undefined}>{data ? <Heatmap cells={data.heatmap} /> : <Skeleton className="h-40" />}</Panel>
            <Panel flush title="Errors"><ErrorsList errors={data?.errors} maxHeight={320} /></Panel>
          </div>

          {data?.meta && (
            <Panel title="Account details">
              <KeyValue items={[
                ["Plan tier", data.meta.rate_limit_tier ?? "—"],
                ["Organization type", data.meta.organization_type ?? "—"],
                ["First seen", new Date(data.meta.first_seen).toLocaleString()],
                ["Last signed in on", data.meta.last_dev_name ?? "—"],
              ]} />
            </Panel>
          )}
        </>
      )}
    </Shell>
  );
}
