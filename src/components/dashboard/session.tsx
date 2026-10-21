"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compact, duration, int, usd } from "@/lib/format";
import { decodeSegment, useApi, useFilters } from "./hooks";
import { clientLabel, KIND_LABEL } from "./labels";
import { AccountLink, ErrorsList, ModelsList, PersonLink, PurposeList, ToolsTable } from "./panels";
import { Shell } from "./shell";
import type { SessionDetail } from "./types";
import { Empty, PageHeader, Panel, Pill, Segmented, Skeleton, SortHeader, StatGrid, StatTile, Th, useSort } from "./ui";

type Req = SessionDetail["requests"][number] & { n: number };

function RequestTooltip({ active, payload }: { active?: boolean; payload?: { payload: Req }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-lg bg-surface px-3 py-2 text-xs shadow-[0_0_0_1px_var(--hairline),0_6px_18px_-6px_rgba(0,0,0,0.2)]">
      <div className="text-muted">Request {r.n} · {new Date(r.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}</div>
      <div className="mt-0.5 font-semibold text-ink">{compact(r.context)} tokens context</div>
      <div className="text-muted">{[r.model, KIND_LABEL[r.kind] ?? r.kind, r.agent, r.effort && `${r.effort} effort`].filter(Boolean).join(" · ")}</div>
      <div className="text-muted">{usd(r.cost_usd)} · {compact(r.output_tokens)} output · {(r.duration_ms / 1000).toFixed(1)}s</div>
      <div className="text-muted">{usd(r.cumulative_cost)} so far</div>
    </div>
  );
}

type PromptSort = "time" | "cost" | "requests" | "context";

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const id = decodeSegment(params.id);
  const { data, error } = useApi<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`);
  const { href } = useFilters();
  const [scope, setScope] = useState<"main" | "all">("main");
  const prompts = useSort<PromptSort>("time");
  const s = data?.session;

  const requests = useMemo<Req[]>(() => (data?.requests ?? []).map((r, i) => ({ ...r, n: i + 1 })), [data]);
  const plotted = scope === "main" ? requests.filter((r) => r.kind === "main") : requests;
  // Compactions mark the first request after them.
  const compactionMarks = useMemo(() => (data?.compactions ?? []).map((c) => {
    const t = Date.parse(c.ts);
    return { ...c, n: requests.find((r) => Date.parse(r.ts) >= t)?.n ?? null };
  }).filter((c) => c.n !== null), [data, requests]);

  const promptRows = useMemo(() => {
    const get: Record<PromptSort, (p: SessionDetail["prompts"][number]) => number> = {
      time: (p) => Date.parse(p.ts), cost: (p) => p.cost_usd, requests: (p) => p.requests, context: (p) => p.peak_context ?? 0,
    };
    const rows = (data?.prompts ?? []).filter((p) => p.requests > 0 || p.prompt_length);
    return rows.sort((a, b) => (prompts.desc ? -1 : 1) * (get[prompts.sort](a) - get[prompts.sort](b)));
  }, [data, prompts.sort, prompts.desc]);
  const maxPromptCost = Math.max(0, ...(data?.prompts ?? []).map((p) => p.cost_usd));

  return (
    <Shell updatedAt={data?.generatedAt} error={error ? error.message : null} filters={false}>
      <div className="text-xs text-muted"><Link href={href("/sessions")} className="hover:text-ink">Sessions</Link> / {id.slice(0, 8)}</div>
      <PageHeader
        title={s ? <>Session by <PersonLink name={s.dev} /></> : "Session"}
        meta={s && (
          <>
            <span>{new Date(s.first_ts).toLocaleString()} – {new Date(s.last_ts).toLocaleString()}</span>
            {s.user_email && <AccountLink email={s.user_email} />}
            <Pill>{clientLabel(s.client)}</Pill>
            {s.models.map((m) => <Pill key={m.id}>{m.label}</Pill>)}
          </>
        )}
      />

      {data && !s ? <Panel><Empty title="Session not found">It may be older than the retention period.</Empty></Panel> : (
        <>
          <StatGrid className="grid-cols-2 md:grid-cols-4">
            <StatTile label="Usage value" value={s ? usd(s.cost_usd) : "–"} sub={s ? `${compact(s.tokens)} tokens` : undefined} />
            <StatTile label="Duration" value={s ? duration(s.duration_s) : "–"} sub={s ? `${int(s.prompts)} prompts · ${s.prompts ? usd(s.cost_usd / s.prompts) : "—"} each` : undefined} />
            <StatTile label="Peak context" value={s?.peak_context ? compact(s.peak_context) : "–"} sub={s ? `${int(s.requests)} requests · ${s.subagent_requests} by subagents` : undefined} />
            <StatTile label="Compactions" value={s ? String(s.compactions) : "–"} sub={s ? `${s.auto_compactions} automatic · ${s.errors} errors` : undefined} tone={s && s.rate_limited ? "bad" : undefined} />
          </StatGrid>

          <Panel
            title="Context size per request"
            description="Every request resends the conversation so far. A rising line is a growing bill per request; drops are compactions or /clear."
            action={<Segmented label="Requests" value={scope} onChange={setScope} options={[{ value: "main", label: "Conversation" }, { value: "all", label: "All requests" }]} />}
          >
            {!data ? <Skeleton className="h-60" /> : plotted.length === 0 ? <Empty title="No requests" /> : (
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={plotted} margin={{ top: 8, right: 16, bottom: 0, left: 4 }}>
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="n" type="number" domain={["dataMin", "dataMax"]} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={{ stroke: "var(--axis)" }} tickLine={false} />
                    <YAxis tickFormatter={(v) => compact(v)} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
                    <Tooltip content={<RequestTooltip />} cursor={{ stroke: "var(--axis)" }} />
                    {compactionMarks.map((c, i) => (
                      <ReferenceLine key={i} x={c.n!} stroke="var(--serious)" strokeDasharray="3 3"
                        label={{ value: c.trigger === "auto" ? "auto-compact" : "compact", position: "insideTopLeft", fill: "var(--muted)", fontSize: 10 }} />
                    ))}
                    <Line type="linear" dataKey="context" stroke="var(--series)" strokeWidth={1.5} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2, fill: "var(--series)" }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          <Panel title="Cumulative usage value" description="How fast this session spent; steep stretches are expensive prompts">
            {!data ? <Skeleton className="h-40" /> : (
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={requests} margin={{ top: 8, right: 16, bottom: 0, left: 4 }}>
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="n" type="number" domain={["dataMin", "dataMax"]} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={{ stroke: "var(--axis)" }} tickLine={false} />
                    <YAxis tickFormatter={(v) => usd(v)} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
                    <Tooltip content={<RequestTooltip />} cursor={{ stroke: "var(--axis)" }} />
                    <Area type="linear" dataKey="cumulative_cost" stroke="var(--series)" strokeWidth={2} fill="var(--series-wash)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          <Panel flush title="Prompts" description="Each prompt with everything it triggered: model requests, subagents and tools. Prompt text is not collected.">
            {!data ? <div className="px-5 pb-5"><Skeleton className="h-24" /></div> : promptRows.length === 0 ? <Empty title="No prompts recorded" /> : (
              <div className="max-h-[560px] overflow-auto border-t border-hairline">
                <table className="w-full min-w-[820px] text-[13px]">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-hairline">
                      <SortHeader label="Time" sortKey="time" {...prompts} className="pl-5" />
                      <Th>Prompt</Th>
                      <SortHeader label="Usage value" sortKey="cost" {...prompts} className="w-[200px]" />
                      <SortHeader label="Requests" sortKey="requests" {...prompts} align="right" />
                      <SortHeader label="Peak context" sortKey="context" {...prompts} align="right" />
                      <Th className="pr-5">Tools</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {promptRows.map((p) => (
                      <tr key={p.prompt_id} className="border-b border-hairline align-top last:border-0">
                        <td className="py-2 pr-3 pl-5 text-xs whitespace-nowrap text-ink-2 tabular">{new Date(p.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                        <td className="px-3 py-2 text-xs text-muted">{p.command_name ? <span className="text-ink">/{p.command_name}</span> : p.prompt_length ? `${int(p.prompt_length)} characters` : "—"}</td>
                        <td className="px-3 py-2">
                          <div className="text-xs font-medium text-ink tabular">{usd(p.cost_usd)}</div>
                          <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-series" style={{ width: `${maxPromptCost ? Math.max(1, (p.cost_usd / maxPromptCost) * 100) : 0}%` }} /></div>
                        </td>
                        <td className="px-3 py-2 text-right tabular">{int(p.requests)}{p.subagent_requests > 0 && <div className="text-[11px] text-muted">{p.subagent_requests} subagent</div>}</td>
                        <td className="px-3 py-2 text-right tabular">{p.peak_context ? compact(p.peak_context) : "—"}</td>
                        <td className="py-2 pr-5 pl-3 text-xs text-muted">
                          {p.tool_calls ? `${p.tool_calls} calls` : "—"}{p.tool_failures > 0 && <span className="text-critical"> · {p.tool_failures} failed</span>}
                          {p.tools.length > 0 && <div className="max-w-[260px] truncate">{p.tools.join(", ")}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Models"><ModelsList models={data?.models} total={s?.cost_usd ?? 0} /></Panel>
            <Panel title="Where usage goes"><PurposeList kinds={data?.kinds} total={s?.cost_usd ?? 0} /></Panel>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel flush title="Tools"><ToolsTable tools={data?.tools} /></Panel>
            <Panel flush title="Errors"><ErrorsList errors={data?.errors} showPeople={false} maxHeight={320} /></Panel>
          </div>
          {data && data.compactions.length > 0 && (
            <Panel title="Compactions">
              <ul className="space-y-1.5 text-[13px]">
                {data.compactions.map((c, i) => (
                  <li key={i} className="flex flex-wrap justify-between gap-2">
                    <span className="text-ink">{c.trigger === "auto" ? "Automatic" : "Manual"} · {new Date(c.ts).toLocaleString()}</span>
                    <span className="text-muted tabular">{c.pre_tokens ? `${compact(c.pre_tokens)} → ${compact(c.post_tokens ?? 0)} tokens` : c.error ?? ""}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </Shell>
  );
}
