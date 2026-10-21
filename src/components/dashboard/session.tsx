"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { compact, duration, int, percent, usd } from "@/lib/format";
import { decodeSegment, useApi, useFilters, useOptions } from "./hooks";
import { clientLabel, colorFor, COST_PARTS, dimensionOrder, KIND_LABEL } from "./labels";
import { AccountLink, ErrorsList, ModelsList, PersonLink, PurposeList, ToolsTable } from "./panels";
import { Shell } from "./shell";
import type { CacheBreak, SessionDetail } from "./types";
import {
  Empty, PageHeader, Panel, Pill, Segmented, SeverityIcon, Skeleton, SortHeader, StatGrid, StatTile, Swatch, Th, useSort,
} from "./ui";

type Req = SessionDetail["requests"][number];

const PARTS = COST_PARTS;

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const gapText = (s: number | null) => (s === null ? "—" : s >= 3600 ? `${(s / 3600).toFixed(1)}h` : s >= 60 ? `${Math.round(s / 60)}m` : `${Math.round(s)}s`);

function RequestTooltip({ active, payload, breaks, labels }: {
  active?: boolean;
  payload?: { payload: Req }[];
  breaks: Map<number, CacheBreak>;
  labels: SessionDetail["breakLabels"] | undefined;
}) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  const b = breaks.get(r.n);
  return (
    <div className="max-w-[300px] rounded-lg bg-surface px-3 py-2 text-xs shadow-[0_0_0_1px_var(--hairline),0_6px_18px_-6px_rgba(0,0,0,0.2)]">
      <div className="text-muted">Request {r.n} · {new Date(r.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}</div>
      <div className="mt-0.5 flex items-baseline gap-2"><span className="text-[15px] font-semibold text-ink">{usd(r.cost_usd)}</span><span className="text-muted">{compact(r.context)} context</span></div>
      <div className="text-muted">{[r.model_label, KIND_LABEL[r.kind] ?? r.kind, r.agent, r.effort && `${r.effort} effort`].filter(Boolean).join(" · ")}</div>
      <ul className="mt-1.5 space-y-0.5">
        {PARTS.map((p) => r.parts[p.key] > 0.0005 && (
          <li key={p.key} className="flex items-center gap-2"><Swatch color={p.color} shape="line" /><span className="flex-1 text-ink-2">{p.label}</span><span className="font-medium text-ink tabular">{usd(r.parts[p.key])}</span></li>
        ))}
      </ul>
      {b && labels && (
        <div className="mt-1.5 flex gap-1.5 border-t border-hairline pt-1.5 text-ink">
          <SeverityIcon severity="serious" size={13} />
          <span>{labels[b.cause]}: {compact(b.rewritten_tokens)} tokens rewritten, ~{usd(b.extra_usd)} extra{b.gap_s !== null && b.cause === "idle" ? ` after a ${gapText(b.gap_s)} pause` : ""}</span>
        </div>
      )}
      <div className="mt-1 text-muted">{usd(r.cumulative_cost)} so far in this session</div>
    </div>
  );
}

type PromptSort = "time" | "cost" | "requests" | "context";

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const id = decodeSegment(params.id);
  const { data, error } = useApi<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`);
  const { data: options } = useOptions();
  const { href } = useFilters();
  const [scope, setScope] = useState<"main" | "all">("main");
  const prompts = useSort<PromptSort>("time");
  const s = data?.session;
  const split = data?.costSplit;
  const modelOrder = dimensionOrder("model", options);

  const breakAt = useMemo(() => new Map((data?.breaks ?? []).map((b) => [b.n, b])), [data]);
  const plotted = useMemo(() => (data?.requests ?? []).filter((r) => scope === "all" || r.kind === "main"), [data, scope]);
  const byN = useMemo(() => new Map((data?.requests ?? []).map((r) => [r.n, r])), [data]);
  // Compactions mark the first request after them.
  const compactionMarks = useMemo(() => (data?.compactions ?? []).map((c) => {
    const t = Date.parse(c.ts);
    return { ...c, n: data?.requests.find((r) => Date.parse(r.ts) >= t)?.n ?? null };
  }).filter((c) => c.n !== null), [data]);
  const spikeLine = split ? Math.max(5 * split.typical_request_usd, 0.75) : null;

  const promptRows = useMemo(() => {
    const get: Record<PromptSort, (p: SessionDetail["prompts"][number]) => number> = {
      time: (p) => Date.parse(p.ts), cost: (p) => p.cost_usd, requests: (p) => p.requests, context: (p) => p.peak_context ?? 0,
    };
    const rows = (data?.prompts ?? []).filter((p) => p.requests > 0 || p.prompt_length);
    return rows.sort((a, b) => (prompts.desc ? -1 : 1) * (get[prompts.sort](a) - get[prompts.sort](b)));
  }, [data, prompts.sort, prompts.desc]);
  const maxPromptCost = Math.max(0, ...(data?.prompts ?? []).map((p) => p.cost_usd));

  const xAxis = (
    <XAxis dataKey="n" type="number" domain={["dataMin", "dataMax"]} allowDecimals={false}
      tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={{ stroke: "var(--axis)" }} tickLine={false} />
  );
  const scopeToggle = (
    <Segmented label="Requests" value={scope} onChange={setScope} options={[{ value: "main", label: "Conversation" }, { value: "all", label: "All requests" }]} />
  );

  return (
    <Shell updatedAt={data?.generatedAt} error={error ? error.message : null} filters={false}>
      <div className="text-xs text-muted"><Link href={href("/sessions")} className="hover:text-ink">Sessions</Link> / {id.slice(0, 8)}</div>
      <PageHeader
        title={s ? <>Session by <PersonLink name={s.dev} /></> : "Session"}
        meta={s && (
          <>
            <span>{when(s.first_ts)} – {when(s.last_ts)}</span>
            {s.user_email && <AccountLink email={s.user_email} />}
            <Pill>{clientLabel(s.client)}</Pill>
            {s.models.map((m) => <Pill key={m.id}>{m.label}</Pill>)}
          </>
        )}
      />

      {data && !s ? <Panel><Empty title="Session not found">It may be older than the retention period.</Empty></Panel> : (
        <>
          <StatGrid className="grid-cols-2 md:grid-cols-4">
            <StatTile label="Usage value" value={s ? usd(s.cost_usd) : "–"} sub={s ? `${int(s.requests)} requests over ${duration(s.duration_s)} · ${int(s.prompts)} prompts` : undefined} />
            <StatTile
              label="Lost to cache rebuilds"
              hint="Extra paid for rewriting context that could have been read from cache (idle gaps, model switches, resumes, context changes)"
              value={split ? usd(split.avoidable_usd) : "–"}
              tone={split && split.avoidable_usd > 2 ? "bad" : undefined}
              sub={data ? `${data.breaks.filter((b) => b.cause !== "compaction").length} cache breaks · ${percent(split && split.total ? (split.avoidable_usd / split.total) * 100 : null)} of the session` : undefined}
            />
            <StatTile label="Typical request" value={split ? usd(split.typical_request_usd) : "–"} sub={data ? `${data.spikes.length} spikes above ${usd(spikeLine ?? 0)}` : undefined} />
            <StatTile label="Peak context" value={s?.peak_context ? compact(s.peak_context) : "–"} sub={s ? `${s.compactions} compactions (${s.auto_compactions} automatic)` : undefined} />
          </StatGrid>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Panel flush title="What to learn from this session" description="Patterns that cost usage, with an estimate of the extra spent">
              {!data ? <div className="px-5 pb-5"><Skeleton className="h-32" /></div> : data.lessons.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-ink-2">A clean session: no cache breaks, spikes or runaway context.</p>
              ) : (
                <ul className="border-t border-hairline">
                  {data.lessons.map((l, i) => (
                    <li key={i} className="flex gap-3 border-b border-hairline px-5 py-3 last:border-0">
                      <span className="mt-0.5"><SeverityIcon severity={l.severity} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-ink">{l.title}</div>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted">{l.detail}</p>
                      </div>
                      {l.impact_usd !== null && l.impact_usd > 0 && <span className="shrink-0 text-xs font-medium text-ink tabular">~{usd(l.impact_usd)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Where the money went" description="Usage value split by what each request paid for">
              {!split ? <Skeleton className="h-32" /> : (
                <>
                  <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
                    {PARTS.map((p) => split[p.key] > 0 && <div key={p.key} style={{ width: `${(split[p.key] / split.total) * 100}%`, background: p.color }} title={p.label} />)}
                  </div>
                  <ul className="mt-3 space-y-2.5">
                    {PARTS.map((p) => (
                      <li key={p.key} className="flex items-start gap-2.5">
                        <span className="mt-1"><Swatch color={p.color} /></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between gap-2 text-[13px]"><span className="text-ink">{p.label}</span><span className="font-medium text-ink tabular">{usd(split[p.key])} <span className="font-normal text-muted">{percent(split.total ? (split[p.key] / split.total) * 100 : null)}</span></span></div>
                          <div className="text-[11px] text-muted">{p.hint}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Panel>
          </div>

          <Panel
            title="Context size and model per request"
            description="Each request resends the conversation so far. Shaded bands show the model in use; dots mark cache breaks, dashed lines compactions."
            action={scopeToggle}
          >
            {!data ? <Skeleton className="h-64" /> : plotted.length === 0 ? <Empty title="No requests" /> : (
              <>
                <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {data.segments.reduce<{ model: string; label: string; requests: number; cost: number }[]>((acc, seg) => {
                    const e = acc.find((a) => a.model === seg.model);
                    if (e) { e.requests += seg.requests; e.cost += seg.cost_usd; } else acc.push({ model: seg.model, label: seg.label, requests: seg.requests, cost: seg.cost_usd });
                    return acc;
                  }, []).map((m) => (
                    <li key={m.model} className="inline-flex items-center gap-1.5"><Swatch color={colorFor(modelOrder, m.model)} /><span className="text-ink-2">{m.label}</span><span className="text-muted tabular">{int(m.requests)} requests · {usd(m.cost)}</span></li>
                  ))}
                  {data.breaks.length > 0 && <li className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full ring-2 ring-surface" style={{ background: "var(--ink)" }} /><span className="text-ink-2">Cache break</span></li>}
                  {data.segments.length > 1 && <li className="text-muted">{data.segments.length - 1} model change{data.segments.length > 2 ? "s" : ""}</li>}
                </ul>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={plotted} margin={{ top: 18, right: 16, bottom: 0, left: 4 }}>
                      <CartesianGrid vertical={false} stroke="var(--grid)" />
                      {data.segments.map((seg, i) => (
                        <ReferenceArea key={i} x1={seg.from} x2={Math.max(seg.to, seg.from + 0.5)} fill={colorFor(modelOrder, seg.model)} fillOpacity={0.13} strokeOpacity={0}
                          label={seg.to - seg.from > plotted.length / 12 ? { value: seg.label, position: "insideTopLeft", fill: "var(--ink-2)", fontSize: 11 } : undefined} />
                      ))}
                      {xAxis}
                      <YAxis tickFormatter={(v) => compact(v)} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
                      <Tooltip content={<RequestTooltip breaks={breakAt} labels={data.breakLabels} />} cursor={{ stroke: "var(--axis)" }} />
                      {compactionMarks.map((c, i) => <ReferenceLine key={i} x={c.n!} stroke="var(--muted)" strokeDasharray="3 3" />)}
                      <Line type="linear" dataKey="context" stroke="var(--ink-2)" strokeWidth={1.5} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2, fill: "var(--ink)" }} isAnimationActive={false} />
                      {data.breaks.filter((b) => scope === "all" || byN.get(b.n)?.kind === "main").map((b) => (
                        <ReferenceDot key={b.n} x={b.n} y={b.context} r={5} fill="var(--ink)" stroke="var(--surface)" strokeWidth={2} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </Panel>

          <Panel
            title="Cost per request"
            description={spikeLine ? `Stacked by what each request paid for. The dashed line is the spike threshold (${usd(spikeLine)}, 5× a typical request).` : undefined}
            action={scopeToggle}
          >
            {!data ? <Skeleton className="h-56" /> : (
              <>
                <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {PARTS.map((p) => <li key={p.key} className="inline-flex items-center gap-1.5"><Swatch color={p.color} /><span className="text-ink-2">{p.label}</span></li>)}
                </ul>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={plotted.map((r) => ({ ...r, ...r.parts }))} margin={{ top: 8, right: 16, bottom: 0, left: 4 }} barCategoryGap={plotted.length > 200 ? 0 : "15%"}>
                      <CartesianGrid vertical={false} stroke="var(--grid)" />
                      {xAxis}
                      <YAxis tickFormatter={(v) => usd(v)} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
                      <Tooltip content={<RequestTooltip breaks={breakAt} labels={data.breakLabels} />} cursor={{ fill: "var(--surface-2)" }} />
                      {PARTS.map((p) => <Bar key={p.key} dataKey={p.key} stackId="cost" fill={p.color} isAnimationActive={false} />)}
                      {spikeLine && <ReferenceLine y={spikeLine} stroke="var(--muted)" strokeDasharray="4 4" />}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel flush title="Cache breaks" description="Requests that rewrote context instead of reading it from cache">
              {!data ? <div className="px-5 pb-5"><Skeleton className="h-24" /></div> : data.breaks.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-ink-2">No cache breaks: the cache was reused throughout.</p>
              ) : (
                <div className="max-h-[420px] overflow-auto border-t border-hairline">
                  <table className="w-full min-w-[560px] text-[13px]">
                    <thead className="sticky top-0 bg-surface"><tr className="border-b border-hairline"><Th className="pl-5">Request</Th><Th>Cause</Th><Th align="right">Pause</Th><Th align="right">Rewritten</Th><Th align="right" className="pr-5">Extra</Th></tr></thead>
                    <tbody>
                      {data.breaks.map((b) => (
                        <tr key={b.n} className="border-b border-hairline align-top last:border-0">
                          <td className="py-2 pr-3 pl-5 whitespace-nowrap"><span className="text-ink">#{b.n}</span><div className="text-[11px] text-muted">{when(b.ts)}</div></td>
                          <td className="px-3 py-2" title={data.breakHints[b.cause]}>
                            <span className="text-ink">{data.breakLabels[b.cause]}</span>
                            {b.cause === "model-switch" && <div className="text-[11px] text-muted">{byN.get(b.n - 1)?.model_label ?? b.prev_model} → {byN.get(b.n)?.model_label}</div>}
                          </td>
                          <td className="px-3 py-2 text-right tabular">{gapText(b.gap_s)}</td>
                          <td className="px-3 py-2 text-right tabular">{compact(b.rewritten_tokens)}</td>
                          <td className={`py-2 pr-5 pl-3 text-right font-medium tabular ${b.cause === "compaction" ? "text-muted" : "text-ink"}`}>{usd(b.extra_usd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            <Panel flush title="Spikes" description="Requests far above this session's typical request, and what drove them">
              {!data ? <div className="px-5 pb-5"><Skeleton className="h-24" /></div> : data.spikes.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-ink-2">No spikes: request costs stayed steady.</p>
              ) : (
                <div className="max-h-[420px] overflow-auto border-t border-hairline">
                  <table className="w-full min-w-[520px] text-[13px]">
                    <thead className="sticky top-0 bg-surface"><tr className="border-b border-hairline"><Th className="pl-5">Request</Th><Th align="right">Cost</Th><Th className="pr-5">Driver</Th></tr></thead>
                    <tbody>
                      {data.spikes.map((sp) => (
                        <tr key={sp.n} className="border-b border-hairline align-top last:border-0">
                          <td className="py-2 pr-3 pl-5 whitespace-nowrap"><span className="text-ink">#{sp.n}</span><div className="text-[11px] text-muted">{when(sp.ts)} · {sp.model ?? "—"}{sp.kind !== "main" ? ` · ${KIND_LABEL[sp.kind] ?? sp.kind}` : ""}</div></td>
                          <td className="px-3 py-2 text-right whitespace-nowrap tabular"><span className="font-medium text-ink">{usd(sp.cost_usd)}</span><div className="text-[11px] text-muted">{Math.round(sp.times_median)}× typical</div></td>
                          <td className="py-2 pr-5 pl-3"><span className="inline-flex items-center gap-1.5"><Swatch color={PARTS.find((p) => p.key === sp.driver)!.color} /><span className="text-ink-2">{sp.detail}</span></span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

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
                        <td className="py-2 pr-3 pl-5 text-xs whitespace-nowrap text-ink-2 tabular">{when(p.ts)}</td>
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
        </>
      )}
    </Shell>
  );
}
