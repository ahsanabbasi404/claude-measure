"use client";

import { useEffect, useMemo } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { ago, compact, duration, int, percent, resetsIn, usd } from "@/lib/format";
import { EfficiencyBadge } from "./people-table";
import type { Account, Developer, Stats } from "./types";
import { Meter, Pill } from "./ui";

export type SheetTarget = { kind: "dev" | "account"; id: string } | null;

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold text-ink">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-hairline px-6 py-5">
      <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

function DevDetail({ d, stats, now, onSelect }: { d: Developer; stats: Stats; now: number; onSelect: (t: SheetTarget) => void }) {
  const series = useMemo(() => stats.devSeries.filter((s) => s.dev === d.dev), [stats.devSeries, d.dev]);
  const models = stats.devModels.filter((m) => m.dev === d.dev);
  const modelTotal = models.reduce((a, m) => a + m.cost_usd, 0);
  const accounts = stats.accounts.filter((a) => d.emails.includes(a.user_email));

  return (
    <>
      <div className="px-6 pt-6 pb-5">
        <div className="text-xs text-muted">{[d.team, d.hosts.join(", ")].filter(Boolean).join(" · ")}</div>
        <h2 className="mt-0.5 text-xl font-semibold text-ink">{d.dev}</h2>
        <div className="mt-2"><EfficiencyBadge e={d.efficiency} /></div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Usage value" value={usd(d.cost_usd)} sub={`${percent(d.share * 100)} of team`} />
          <Stat label="Per active hour" value={d.cost_per_active_hour === null ? "—" : usd(d.cost_per_active_hour)} sub={`${duration(d.active_seconds)} active`} />
          <Stat label="Per prompt" value={d.cost_per_prompt === null ? "—" : usd(d.cost_per_prompt)} sub={`${int(d.prompts)} prompts`} />
          <Stat label="Sessions" value={int(d.sessions)} sub={`${int(d.requests)} requests`} />
          <Stat label="Lines changed" value={compact(d.lines_added + d.lines_removed)} sub={`${d.commits} commits · ${d.pull_requests} PRs`} />
          <Stat label="Subagents" value={percent(d.cost_usd ? (d.subagent_cost_usd / d.cost_usd) * 100 : null)} sub="of usage value" />
        </div>
      </div>

      {d.efficiency.parts.length > 0 && (
        <Section title="Efficiency breakdown">
          <ul className="space-y-3.5">
            {d.efficiency.parts.map((p) => (
              <li key={p.key}>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="font-medium text-ink">{p.label}</span>
                  <span className="text-xs text-muted">{p.value}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-surface-2">
                    <div
                      className="h-1.5 rounded-full"
                      style={{ width: `${Math.max(3, p.score)}%`, background: p.score >= 70 ? "var(--series)" : p.score >= 45 ? "var(--warning)" : "var(--critical)" }}
                    />
                  </div>
                  <span className="w-7 text-right text-xs text-ink-2 tabular-nums">{Math.round(p.score)}</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">{p.hint}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Usage over time">
        {series.length === 0 ? (
          <p className="text-xs text-muted">No requests in this period.</p>
        ) : (
          <div className="h-[120px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <XAxis
                  dataKey="bucket"
                  tickFormatter={(v) => new Date(v).toLocaleDateString([], stats.bucket === "hour" ? { hour: "numeric" } : { month: "short", day: "numeric" })}
                  tick={{ fill: "var(--muted)", fontSize: 10 }}
                  axisLine={{ stroke: "var(--axis)" }}
                  tickLine={false}
                  minTickGap={20}
                />
                <Tooltip
                  cursor={{ fill: "var(--surface-2)" }}
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <div className="rounded-lg bg-surface px-2.5 py-1.5 text-xs shadow-panel">
                        <div className="text-muted">{new Date(payload[0].payload.bucket).toLocaleString([], { month: "short", day: "numeric", hour: stats.bucket === "hour" ? "numeric" : undefined })}</div>
                        <div className="font-semibold text-ink">{usd(payload[0].payload.cost_usd)}</div>
                      </div>
                    ) : null
                  }
                />
                <Bar dataKey="cost_usd" fill="var(--series)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      <Section title="Accounts used">
        {accounts.length === 0 ? (
          <p className="text-xs text-muted">No account information yet.</p>
        ) : (
          <ul className="space-y-3">
            {accounts.map((a) => (
              <li key={a.user_email}>
                <button onClick={() => onSelect({ kind: "account", id: a.user_email })} className="w-full text-left">
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="truncate font-medium text-ink hover:underline">{a.user_email}</span>
                    {a.plan && <Pill>{a.plan}</Pill>}
                  </div>
                  {a.weekly ? (
                    <>
                      <div className="mt-1.5"><Meter value={a.weekly.pct} projected={a.weekly.projectedPct} /></div>
                      <div className="mt-1 text-[11px] text-muted">{Math.round(a.weekly.pct)}% weekly · {resetsIn(a.weekly.resetsAt, now)}</div>
                    </>
                  ) : (
                    <div className="mt-1 text-[11px] text-muted">No weekly limit data yet</div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Models">
        <ul className="space-y-2.5">
          {models.map((m) => (
            <li key={m.model}>
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="text-ink">{m.label}</span>
                <span className="text-xs text-muted tabular-nums">{usd(m.cost_usd)} · {int(m.requests)} req</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-2">
                <div className="h-1.5 rounded-full bg-series" style={{ width: `${Math.max(2, modelTotal ? (m.cost_usd / modelTotal) * 100 : 0)}%` }} />
              </div>
            </li>
          ))}
          {models.length === 0 && <li className="text-xs text-muted">No requests in this period.</li>}
        </ul>
      </Section>

      <Section title="Waste signals">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
          {[
            ["Rate-limited (429)", d.rate_limited],
            ["API errors", d.api_errors],
            ["Failed tool calls", d.tool_failures],
            ["Rejected tool uses", d.rejections],
            ["Auto-compactions", d.auto_compactions],
            ["Manual compactions", d.compactions - d.auto_compactions],
          ].map(([k, v]) => (
            <div key={k as string} className="flex justify-between border-b border-hairline pb-1.5">
              <dt className="text-muted">{k}</dt>
              <dd className={`tabular-nums ${k === "Rate-limited (429)" && Number(v) > 0 ? "text-critical" : "text-ink"}`}>{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Clients">
        <div className="flex flex-wrap gap-1.5">
          {d.entrypoints.map((e) => <Pill key={e}>{e === "claude-vscode" ? "VS Code extension" : e === "cli" ? "CLI" : e}</Pill>)}
          {d.app_versions.map((v) => <Pill key={v}>v{v}</Pill>)}
        </div>
        <p className="mt-2 text-[11px] text-muted">Last active {ago(d.last_seen, now)}</p>
      </Section>
    </>
  );
}

function AccountDetail({ a, now, onSelect }: { a: Account; now: number; onSelect: (t: SheetTarget) => void }) {
  return (
    <>
      <div className="px-6 pt-6 pb-5">
        <div className="text-xs text-muted">Claude account</div>
        <h2 className="mt-0.5 flex items-center gap-2 text-xl font-semibold break-all text-ink">{a.user_email}</h2>
        {a.plan && <div className="mt-2"><Pill>{a.plan}</Pill></div>}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Value, last 7 days" value={usd(a.cost_7d)} />
          <Stat label="Sessions" value={int(a.sessions)} sub="in this period" />
          <Stat label="Rate-limited" value={int(a.rate_limited)} sub="HTTP 429 responses" />
        </div>
      </div>
      <Section title="Limits">
        {a.weekly ? (
          <div>
            <div className="flex justify-between text-[13px]"><span className="font-medium text-ink">Weekly</span><span className="text-muted">{resetsIn(a.weekly.resetsAt, now)}</span></div>
            <div className="mt-1.5"><Meter value={a.weekly.pct} projected={a.weekly.projectedPct} height={8} /></div>
            <p className="mt-1.5 text-xs text-muted">
              {Math.round(a.weekly.pct)}% used
              {a.weekly.pacePerDay !== null && ` · ${a.weekly.pacePerDay.toFixed(0)}% per day`}
              {a.weekly.projectedPct !== null && ` · on pace for ${Math.round(a.weekly.projectedPct)}% at reset`}
              {` · as of ${ago(a.weekly.asOf, now)}`}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted">No weekly limit data yet. It is reported by the status line, which runs in terminal sessions.</p>
        )}
        {a.five_hour && (
          <div className="mt-4">
            <div className="flex justify-between text-[13px]"><span className="font-medium text-ink">5-hour window</span><span className="text-muted">{resetsIn(a.five_hour.resetsAt, now)}</span></div>
            <div className="mt-1.5"><Meter value={a.five_hour.pct} height={8} /></div>
          </div>
        )}
      </Section>
      <Section title="Used by">
        <ul className="space-y-1.5">
          {a.devs.map((dev) => (
            <li key={dev}>
              <button onClick={() => onSelect({ kind: "dev", id: dev })} className="text-[13px] text-ink hover:underline">{dev}</button>
            </li>
          ))}
          {a.devs.length === 0 && <li className="text-xs text-muted">No activity in this period.</li>}
        </ul>
      </Section>
    </>
  );
}

export function DetailSheet({ target, stats, now, onSelect }: { target: SheetTarget; stats: Stats | undefined; now: number; onSelect: (t: SheetTarget) => void }) {
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onSelect(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, onSelect]);

  if (!target || !stats) return null;
  const dev = target.kind === "dev" ? stats.developers.find((d) => d.dev === target.id) : undefined;
  const account = target.kind === "account" ? stats.accounts.find((a) => a.user_email === target.id) : undefined;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      <button aria-label="Close" className="absolute inset-0 bg-black/25" onClick={() => onSelect(null)} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col overflow-y-auto bg-surface shadow-panel">
        <div className="sticky top-0 z-10 flex justify-end bg-surface/90 px-4 pt-3 backdrop-blur">
          <button onClick={() => onSelect(null)} className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-ink">
            Close
          </button>
        </div>
        {dev ? (
          <DevDetail d={dev} stats={stats} now={now} onSelect={onSelect} />
        ) : account ? (
          <AccountDetail a={account} now={now} onSelect={onSelect} />
        ) : (
          <p className="px-6 py-10 text-sm text-muted">No data for {target.id} in this period.</p>
        )}
      </aside>
    </div>
  );
}
