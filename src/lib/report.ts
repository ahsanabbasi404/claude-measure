import { modelLabel } from "./analytics";
import {
  analyzeSession, BREAK_HINT, type BreakCause, type CostParts as CostSplit, type PriceRow, type RequestRow,
} from "./session-analysis";

/*
 * Period report: every session in the range is analyzed (cache breaks, spikes, context growth),
 * then rolled up per person and for the team into lessons with an estimated cost where one exists.
 */

export type ReportLesson = {
  severity: "serious" | "warning" | "info";
  kind: string;
  title: string;
  detail: string;
  impact_usd: number | null;
  session_id?: string;
  people?: string[];
};

const BIN_MS = 10 * 60_000;
const LARGE_CONTEXT = 400_000;
const CAUSES: BreakCause[] = ["idle", "model-switch", "resumed", "context-changed", "compaction"];

const usd = (n: number) => `$${n >= 100 ? Math.round(n) : n.toFixed(2)}`;
const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(Math.round(n)));
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
const mins = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)}h` : `${Math.round(s / 60)}m`);
const median = (v: number[]) => {
  const s = v.filter((x) => x > 0).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

type Extras = {
  compactions: Map<string, { ts: string; trigger: string | null; pre_tokens: number | null }[]>;
  loops: Map<string, { tool: string; count: number; ts: string }[]>;
  prompts: Map<string, number>;
};

function emptySplit(): CostSplit {
  return { input: 0, cache_write: 0, cache_read: 0, output: 0 };
}

export function buildReport(rows: RequestRow[], prices: Map<string, PriceRow>, extras: Extras, tz: string, teams: Map<string, string | null>) {
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const bySession = new Map<string, RequestRow[]>();
  for (const r of rows) bySession.set(r.session_id, [...(bySession.get(r.session_id) ?? []), r]);

  type Acc = {
    dev: string;
    cost: number; requests: number; prompts: number; sessions: number;
    split: CostSplit; avoidable: number;
    breaks: Record<BreakCause, { count: number; extra: number; longestGap: number; worst: { session_id: string; extra: number } | null }>;
    spikes: number; biggestSpike: { session_id: string; n: number; cost: number; detail: string; times: number } | null;
    largeCtxCost: number; peakContext: number; largeCtxWorst: { session_id: string; cost: number } | null;
    subagentCost: number; subagentOpusCost: number; maxEffort: number; xhigh: number;
    autoCompactions: number; loops: { tool: string; count: number; session_id: string }[];
    bins: Map<number, Set<string>>;
    models: Map<string, number>;
    sessionList: { session_id: string; cost: number; avoidable: number; first_ts: string; last_ts: string; requests: number; lessons: number; top: string | null }[];
  };
  const people = new Map<string, Acc>();
  const days = new Map<string, { cost: number; people: Set<string>; sessions: Set<string>; avoidable: number; byPerson: Map<string, number> }>();

  const acc = (dev: string): Acc => {
    let a = people.get(dev);
    if (!a) {
      a = {
        dev, cost: 0, requests: 0, prompts: 0, sessions: 0, split: emptySplit(), avoidable: 0,
        breaks: Object.fromEntries(CAUSES.map((c) => [c, { count: 0, extra: 0, longestGap: 0, worst: null }])) as Acc["breaks"],
        spikes: 0, biggestSpike: null, largeCtxCost: 0, peakContext: 0, largeCtxWorst: null,
        subagentCost: 0, subagentOpusCost: 0, maxEffort: 0, xhigh: 0, autoCompactions: 0, loops: [],
        bins: new Map(), models: new Map(), sessionList: [],
      };
      people.set(dev, a);
    }
    return a;
  };

  for (const [sessionId, list] of bySession) {
    const dev = list[0].dev;
    const a = acc(dev);
    const comps = extras.compactions.get(sessionId) ?? [];
    const loops = extras.loops.get(sessionId) ?? [];
    const s = analyzeSession(list, prices, { compactions: comps, toolLoops: loops });
    const sessionCost = s.costSplit.total;
    a.sessions += 1;
    a.prompts += extras.prompts.get(sessionId) ?? 0;
    a.cost += sessionCost;
    a.requests += list.length;
    for (const key of ["input", "cache_write", "cache_read", "output"] as const) a.split[key] += s.costSplit[key];
    a.avoidable += s.costSplit.avoidable_usd;
    for (const b of s.breaks) {
      const slot = a.breaks[b.cause];
      slot.count += 1;
      slot.extra += b.extra_usd;
      slot.longestGap = Math.max(slot.longestGap, b.gap_s ?? 0);
      const sessionExtra = s.breaks.filter((x) => x.cause === b.cause).reduce((t, x) => t + x.extra_usd, 0);
      if (!slot.worst || sessionExtra > slot.worst.extra) slot.worst = { session_id: sessionId, extra: sessionExtra };
    }
    a.spikes += s.spikes.length;
    const top = s.spikes[0];
    if (top && (!a.biggestSpike || top.cost_usd > a.biggestSpike.cost)) {
      a.biggestSpike = { session_id: sessionId, n: top.n, cost: top.cost_usd, detail: top.detail, times: top.times_median };
    }
    let largeHere = 0;
    for (const r of s.requests) {
      if (r.kind === "main") {
        a.peakContext = Math.max(a.peakContext, r.context);
        if (r.context >= LARGE_CONTEXT) largeHere += r.cost_usd;
      }
      if (r.kind === "subagent") {
        a.subagentCost += r.cost_usd;
        if (r.model?.includes("opus")) a.subagentOpusCost += r.cost_usd;
      }
      if (r.effort === "max") a.maxEffort += 1;
      if (r.effort === "xhigh") a.xhigh += 1;
      if (r.model) a.models.set(r.model, (a.models.get(r.model) ?? 0) + r.cost_usd);
      const bin = Math.floor(Date.parse(r.ts) / BIN_MS);
      const set = a.bins.get(bin) ?? new Set<string>();
      set.add(sessionId);
      a.bins.set(bin, set);
      const day = dayFmt.format(new Date(r.ts));
      const d = days.get(day) ?? { cost: 0, people: new Set(), sessions: new Set(), avoidable: 0, byPerson: new Map() };
      d.cost += r.cost_usd;
      d.people.add(dev);
      d.sessions.add(sessionId);
      d.byPerson.set(dev, (d.byPerson.get(dev) ?? 0) + r.cost_usd);
      days.set(day, d);
    }
    for (const b of s.breaks) {
      if (b.cause === "compaction") continue;
      const d = days.get(dayFmt.format(new Date(b.ts)));
      if (d) d.avoidable += b.extra_usd;
    }
    a.largeCtxCost += largeHere;
    if (largeHere > 0 && (!a.largeCtxWorst || largeHere > a.largeCtxWorst.cost)) a.largeCtxWorst = { session_id: sessionId, cost: largeHere };
    a.autoCompactions += comps.filter((c) => c.trigger === "auto").length;
    for (const l of loops) a.loops.push({ tool: l.tool, count: l.count, session_id: sessionId });
    a.sessionList.push({
      session_id: sessionId, cost: sessionCost, avoidable: s.costSplit.avoidable_usd,
      first_ts: list[0].ts, last_ts: list[list.length - 1].ts, requests: list.length,
      lessons: s.lessons.filter((l) => l.severity !== "info").length, top: s.lessons[0]?.title ?? null,
    });
  }

  // ------------------------------------------------------------ per person
  const summaries = [...people.values()].map((a) => {
    const activeBins = a.bins.size;
    const activeHours = (activeBins * BIN_MS) / 3600_000;
    const parallel = [...a.bins.values()].map((s) => s.size);
    return {
      a,
      dev: a.dev,
      team: teams.get(a.dev) ?? null,
      cost_usd: a.cost, requests: a.requests, prompts: a.prompts, sessions: a.sessions,
      active_hours: activeHours,
      cost_per_active_hour: activeHours > 0 ? a.cost / activeHours : null,
      max_parallel: parallel.length ? Math.max(...parallel) : 0,
      avg_parallel: parallel.length ? parallel.reduce((x, y) => x + y, 0) / parallel.length : 0,
      split: a.split, avoidable_usd: a.avoidable,
      breaks: Object.fromEntries(CAUSES.map((c) => [c, { count: a.breaks[c].count, extra_usd: a.breaks[c].extra }])) as Record<BreakCause, { count: number; extra_usd: number }>,
      spikes: a.spikes,
      peak_context: a.peakContext,
      large_context_usd: a.largeCtxCost,
      subagent_usd: a.subagentCost,
      models: [...a.models.entries()].sort((x, y) => y[1] - x[1]).map(([model, cost]) => ({ model, label: modelLabel(model), cost_usd: cost })),
      sessions_list: a.sessionList.sort((x, y) => y.cost - x.cost).slice(0, 8),
    };
  }).sort((x, y) => y.cost_usd - x.cost_usd);

  const medianHourly = median(summaries.filter((p) => p.requests >= 15).map((p) => p.cost_per_active_hour ?? 0));
  const teamSize = summaries.filter((p) => p.requests >= 15).length;

  const personLessons = (p: (typeof summaries)[number]): ReportLesson[] => {
    const a = p.a;
    const out: ReportLesson[] = [];
    const idle = a.breaks.idle;
    if (idle.count) {
      out.push({
        severity: idle.extra > 3 ? "serious" : "warning", kind: "idle",
        title: `${idle.count} cache expir${idle.count > 1 ? "ies" : "y"} after pauses cost ~${usd(idle.extra)}`,
        detail: `Longest pause ${mins(idle.longestGap)}. ${BREAK_HINT.idle}`,
        impact_usd: idle.extra, session_id: idle.worst?.session_id,
      });
    }
    const sw = a.breaks["model-switch"];
    if (sw.count) {
      out.push({
        severity: sw.extra > 3 ? "serious" : "warning", kind: "model-switch",
        title: `${sw.count} mid-session model switch${sw.count > 1 ? "es" : ""} cost ~${usd(sw.extra)}`,
        detail: BREAK_HINT["model-switch"], impact_usd: sw.extra, session_id: sw.worst?.session_id,
      });
    }
    const res = a.breaks.resumed;
    if (res.count && res.extra > 0.5) {
      out.push({
        severity: res.extra > 3 ? "warning" : "info", kind: "resumed",
        title: `Resumed ${res.count} large session${res.count > 1 ? "s" : ""} (~${usd(res.extra)} to rebuild)`,
        detail: BREAK_HINT.resumed, impact_usd: res.extra, session_id: res.worst?.session_id,
      });
    }
    const ch = a.breaks["context-changed"];
    if (ch.count && ch.extra > 0.5) {
      out.push({
        severity: ch.extra > 3 ? "warning" : "info", kind: "context-changed",
        title: `${ch.count} cache rebuild${ch.count > 1 ? "s" : ""} from changed context (~${usd(ch.extra)})`,
        detail: BREAK_HINT["context-changed"], impact_usd: ch.extra, session_id: ch.worst?.session_id,
      });
    }
    if (a.largeCtxCost > 0 && a.largeCtxCost / Math.max(a.cost, 1e-9) > 0.25) {
      out.push({
        severity: a.largeCtxCost / a.cost > 0.5 ? "warning" : "info", kind: "large-context",
        title: `${pct(a.largeCtxCost, a.cost)} of usage (${usd(a.largeCtxCost)}) ran with over ${k(LARGE_CONTEXT)} tokens of context`,
        detail: `Peak ${k(a.peakContext)} tokens. Every request re-reads the whole conversation; /clear between unrelated tasks, or /compact earlier, keeps requests cheap.`,
        impact_usd: null, session_id: a.largeCtxWorst?.session_id,
      });
    }
    if (p.max_parallel >= 3) {
      out.push({
        severity: p.max_parallel >= 5 ? "warning" : "info", kind: "parallel",
        title: `Ran up to ${p.max_parallel} sessions at the same time`,
        detail: `${p.avg_parallel.toFixed(1)} sessions on average while active${p.cost_per_active_hour ? `, ${usd(p.cost_per_active_hour)} per active hour` : ""}. Parallel sessions multiply the burn on one shared limit.`,
        impact_usd: null,
      });
    }
    if (medianHourly && p.cost_per_active_hour && teamSize >= 3 && p.cost_per_active_hour > 2 * medianHourly && p.requests >= 15) {
      out.push({
        severity: p.cost_per_active_hour > 3 * medianHourly ? "serious" : "warning", kind: "burn-rate",
        title: `Burns ${usd(p.cost_per_active_hour)} per active hour, ${(p.cost_per_active_hour / medianHourly).toFixed(1)}× the team median`,
        detail: `Team median ${usd(medianHourly)} per active hour. Usually parallel sessions, subagents, large contexts or high effort; see the other items.`,
        impact_usd: null,
      });
    }
    if (a.subagentCost / Math.max(a.cost, 1e-9) > 0.3) {
      out.push({
        severity: a.subagentCost / a.cost > 0.5 ? "warning" : "info", kind: "subagents",
        title: `Subagents spent ${usd(a.subagentCost)} (${pct(a.subagentCost, a.cost)} of usage)`,
        detail: `${a.subagentOpusCost > 0 ? `${usd(a.subagentOpusCost)} of it on Opus. ` : ""}Routine subagents (search, exploration) run well on Sonnet or Haiku: set model: in the agent definition.`,
        impact_usd: null,
      });
    }
    if (a.requests >= 20 && a.maxEffort / a.requests > 0.2) {
      out.push({
        severity: "info", kind: "max-effort",
        title: `${pct(a.maxEffort, a.requests)} of requests at max effort`,
        detail: "Max effort spends many more tokens per answer; high suits most coding work.", impact_usd: null,
      });
    }
    if (a.autoCompactions) {
      out.push({
        severity: a.autoCompactions >= 3 ? "warning" : "info", kind: "auto-compaction",
        title: `Context window filled up ${a.autoCompactions} time${a.autoCompactions > 1 ? "s" : ""} (auto-compaction)`,
        detail: "Compacting or clearing at a natural break between tasks avoids paying for a full window.", impact_usd: null,
      });
    }
    const loops = a.loops.sort((x, y) => y.count - x.count);
    if (loops.length) {
      out.push({
        severity: loops[0].count >= 5 ? "warning" : "info", kind: "tool-loops",
        title: `${loops.length} tool retry loop${loops.length > 1 ? "s" : ""} (worst: ${loops[0].tool} failed ${loops[0].count}× in a row)`,
        detail: "Each attempt is a full request with the whole context. Stepping in after two failures saves usage.",
        impact_usd: null, session_id: loops[0].session_id,
      });
    }
    if (a.biggestSpike && a.biggestSpike.times >= 10) {
      out.push({
        severity: "info", kind: "spike",
        title: `${a.spikes} spike${a.spikes > 1 ? "s" : ""}; the largest cost ${usd(a.biggestSpike.cost)} (${Math.round(a.biggestSpike.times)}× typical)`,
        detail: `${a.biggestSpike.detail}.`, impact_usd: null, session_id: a.biggestSpike.session_id,
      });
    }
    const order = { serious: 0, warning: 1, info: 2 };
    return out.sort((x, y) => order[x.severity] - order[y.severity] || (y.impact_usd ?? 0) - (x.impact_usd ?? 0));
  };

  const peopleOut = summaries.map((p) => {
    const lessons = personLessons(p);
    const { a: _omit, ...rest } = p;
    void _omit;
    return { ...rest, lessons };
  });

  // ------------------------------------------------------------ team
  const sum = (f: (p: (typeof peopleOut)[number]) => number) => peopleOut.reduce((x, p) => x + f(p), 0);
  const total = sum((p) => p.cost_usd);
  const teamSplit = emptySplit();
  for (const p of peopleOut) for (const key of ["input", "cache_write", "cache_read", "output"] as const) teamSplit[key] += p.split[key];
  const breakTotals = Object.fromEntries(CAUSES.map((c) => [c, {
    count: sum((p) => p.breaks[c].count), extra_usd: sum((p) => p.breaks[c].extra_usd),
    people: peopleOut.filter((p) => p.breaks[c].count > 0).sort((x, y) => y.breaks[c].extra_usd - x.breaks[c].extra_usd).map((p) => p.dev),
  }])) as Record<BreakCause, { count: number; extra_usd: number; people: string[] }>;

  const teamLessons: ReportLesson[] = [];
  const avoidable = sum((p) => p.avoidable_usd);
  if (avoidable > 0.5) {
    const worst = [...peopleOut].sort((x, y) => y.avoidable_usd - x.avoidable_usd).filter((p) => p.avoidable_usd > 0.1);
    teamLessons.push({
      severity: avoidable / Math.max(total, 1e-9) > 0.1 ? "serious" : "warning", kind: "avoidable",
      title: `~${usd(avoidable)} (${pct(avoidable, total)}) went to rebuilding the prompt cache`,
      detail: `Idle pauses ${usd(breakTotals.idle.extra_usd)}, model switches ${usd(breakTotals["model-switch"].extra_usd)}, resumed sessions ${usd(breakTotals.resumed.extra_usd)}, changed context ${usd(breakTotals["context-changed"].extra_usd)}. Most: ${worst.slice(0, 4).map((p) => `${p.dev} ${usd(p.avoidable_usd)}`).join(", ")}.`,
      impact_usd: avoidable, people: worst.map((p) => p.dev),
    });
  }
  const large = sum((p) => p.large_context_usd);
  if (large / Math.max(total, 1e-9) > 0.25) {
    const who = [...peopleOut].sort((x, y) => y.large_context_usd - x.large_context_usd).filter((p) => p.large_context_usd > 0);
    teamLessons.push({
      severity: large / total > 0.5 ? "warning" : "info", kind: "large-context",
      title: `${pct(large, total)} of usage ran with over ${k(LARGE_CONTEXT)} tokens of context`,
      detail: `${who.slice(0, 4).map((p) => `${p.dev} ${usd(p.large_context_usd)}`).join(", ")}. Long sessions re-read everything on each request; shorter, focused sessions are the biggest single saving.`,
      impact_usd: null, people: who.map((p) => p.dev),
    });
  }
  const parallel = peopleOut.filter((p) => p.max_parallel >= 3);
  if (parallel.length) {
    teamLessons.push({
      severity: "info", kind: "parallel",
      title: `${parallel.length} ${parallel.length > 1 ? "people" : "person"} ran 3 or more sessions at once`,
      detail: parallel.map((p) => `${p.dev} up to ${p.max_parallel}`).join(", "),
      impact_usd: null, people: parallel.map((p) => p.dev),
    });
  }
  const sub = sum((p) => p.subagent_usd);
  if (sub / Math.max(total, 1e-9) > 0.2) {
    const who = [...peopleOut].sort((x, y) => y.subagent_usd - x.subagent_usd).filter((p) => p.subagent_usd > 0);
    teamLessons.push({
      severity: "info", kind: "subagents",
      title: `Subagents spent ${usd(sub)} (${pct(sub, total)})`,
      detail: `${who.slice(0, 4).map((p) => `${p.dev} ${usd(p.subagent_usd)}`).join(", ")}. Setting a cheaper model for routine agents is the easiest saving here.`,
      impact_usd: null, people: who.map((p) => p.dev),
    });
  }
  if (total > 0 && teamSplit.cache_read / total > 0.5) {
    teamLessons.push({
      severity: "info", kind: "re-reading",
      title: `${pct(teamSplit.cache_read, total)} of usage was re-reading conversations`,
      detail: "Cache reads are cheap per token, but large contexts are re-read on every request. Context size, not output, is what drains the limits.",
      impact_usd: null,
    });
  }

  const dayRows = [...days.entries()].sort((x, y) => (x[0] < y[0] ? 1 : -1)).map(([day, d]) => {
    const top = [...d.byPerson.entries()].sort((x, y) => y[1] - x[1])[0];
    return { day, cost_usd: d.cost, people: d.people.size, sessions: d.sessions.size, avoidable_usd: d.avoidable, top_person: top?.[0] ?? null, top_cost_usd: top?.[1] ?? 0 };
  });

  return {
    totals: {
      cost_usd: total, requests: sum((p) => p.requests), prompts: sum((p) => p.prompts), sessions: sum((p) => p.sessions),
      people: peopleOut.length, active_hours: sum((p) => p.active_hours), avoidable_usd: avoidable, split: teamSplit,
      median_cost_per_active_hour: medianHourly,
    },
    breaks: breakTotals,
    lessons: teamLessons,
    days: dayRows,
    people: peopleOut,
  };
}
