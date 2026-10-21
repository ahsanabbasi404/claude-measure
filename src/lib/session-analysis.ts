import { modelLabel } from "./analytics";

/*
 * Request-level analysis of a session: where each request's cost went (input, cache write, cache
 * read, output), where the prompt cache broke and why, which requests spiked, and how the model
 * changed along the way. Everything is derived from Claude Code's own token counts and cost.
 */

export type RequestRow = {
  ts: string;
  session_id: string;
  dev: string;
  model: string | null;
  kind: string;
  agent: string | null;
  effort: string | null;
  prompt_id: string | null;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cache_write_5m: number;
  cache_write_1h: number;
  cost_usd: number;
  duration_ms: number;
};

export type PriceRow = {
  model: string;
  input_per_mtok: number | null;
  output_per_mtok: number | null;
  cache_read_per_mtok: number | null;
  cache_write_per_mtok: number | null;
};

/** Relative token weights (input = 1). Absolute scale comes from the request's reported cost. */
type Weights = { input: number; output: number; read: number; write5m: number; write1h: number };

// Standard Anthropic multipliers, used when a model has no price row.
const DEFAULT_WEIGHTS: Weights = { input: 1, output: 5, read: 0.1, write5m: 1.25, write1h: 2 };

export function weightsFor(model: string | null, prices: Map<string, PriceRow>): Weights {
  const p = model ? prices.get(model) ?? prices.get(model.replace(/-\d{8}$/, "")) : undefined;
  if (!p?.input_per_mtok) return DEFAULT_WEIGHTS;
  const i = p.input_per_mtok;
  return {
    input: 1,
    output: (p.output_per_mtok ?? i * 5) / i,
    read: (p.cache_read_per_mtok ?? i * 0.1) / i,
    write5m: (p.cache_write_per_mtok ?? i * 1.25) / i,
    // One-hour cache writes cost twice the input price.
    write1h: 2,
  };
}

export type CostParts = { input: number; cache_write: number; cache_read: number; output: number };

/** Splits a request's reported cost into its components, scaled so the parts sum to the cost. */
export function costParts(r: RequestRow, w: Weights): CostParts & { perUnit: number } {
  const unknownWrite = Math.max(0, r.cache_write - r.cache_write_5m - r.cache_write_1h);
  const raw = {
    input: r.input * w.input,
    cache_write: (r.cache_write_5m + unknownWrite) * w.write5m + r.cache_write_1h * w.write1h,
    cache_read: r.cache_read * w.read,
    output: r.output * w.output,
  };
  const units = raw.input + raw.cache_write + raw.cache_read + raw.output;
  const perUnit = units > 0 ? r.cost_usd / units : 0;
  return {
    input: raw.input * perUnit, cache_write: raw.cache_write * perUnit,
    cache_read: raw.cache_read * perUnit, output: raw.output * perUnit, perUnit,
  };
}

export type BreakCause = "idle" | "model-switch" | "compaction" | "resumed" | "context-changed";

export const BREAK_LABEL: Record<BreakCause, string> = {
  idle: "Idle gap expired the cache",
  "model-switch": "Model switch",
  compaction: "After compaction",
  resumed: "Resumed session",
  "context-changed": "Context changed",
};

export const BREAK_HINT: Record<BreakCause, string> = {
  idle: "The prompt cache lives 5 minutes (1 hour in some clients). After a longer pause the whole conversation is written to cache again. After a long break, /compact or a fresh session is cheaper than continuing a large context.",
  "model-switch": "Each model has its own cache, so switching models mid-session rewrites the whole conversation. Choose the model at the start of a session.",
  compaction: "Compaction replaces the conversation with a summary, which is written to cache once. Expected, but compacting earlier keeps it cheaper.",
  resumed: "Resuming a conversation writes all of it to cache again. Resuming a very large session costs as much as many normal requests; start fresh when the old context is not needed.",
  "context-changed": "Something early in the context changed (CLAUDE.md, tools or MCP servers, or an edited/rewound message), so the cache could not be reused.",
};

export type CacheBreak = {
  n: number;
  ts: string;
  session_id: string;
  dev: string;
  cause: BreakCause;
  model: string | null;
  prev_model: string | null;
  gap_s: number | null;
  rewritten_tokens: number;
  context: number;
  cost_usd: number;
  /** Extra paid compared with reading the same tokens from cache. */
  extra_usd: number;
};

export type Spike = {
  n: number;
  ts: string;
  cost_usd: number;
  times_median: number;
  driver: "cache_write" | "cache_read" | "output" | "input";
  detail: string;
  model: string | null;
  kind: string;
};

export type Segment = { from: number; to: number; model: string; label: string; requests: number; cost_usd: number };

// A write this large relative to the context means the cached prefix was not reused.
const BREAK_MIN_TOKENS = 20_000;
const BREAK_MIN_SHARE = 0.3;
const RESUME_MIN_TOKENS = 60_000;

/**
 * Cache breaks on the main conversation of each session in `rows` (ordered by session, then time).
 * Subagents keep their own short-lived caches and are not judged here.
 */
export function findCacheBreaks(rows: (RequestRow & { n?: number })[], prices: Map<string, PriceRow>): CacheBreak[] {
  const out: CacheBreak[] = [];
  let session = "";
  let prev: RequestRow | null = null;
  let ttl = 300;
  let compactedSincePrev = false;
  rows.forEach((r, i) => {
    if (r.session_id !== session) {
      session = r.session_id;
      prev = null;
      ttl = 300;
      compactedSincePrev = false;
    }
    if (r.kind === "compaction") compactedSincePrev = true;
    if (r.kind !== "main") return;
    const w = weightsFor(r.model, prices);
    const parts = costParts(r, w);
    const isBreak = r.cache_write >= BREAK_MIN_TOKENS && r.cache_write >= BREAK_MIN_SHARE * (r.input + r.cache_read + r.cache_write);
    let cause: BreakCause | null = null;
    let gap: number | null = null;
    if (!prev) {
      if (r.cache_write >= RESUME_MIN_TOKENS) cause = "resumed";
    } else if (isBreak) {
      const p: RequestRow = prev;
      gap = (Date.parse(r.ts) - Date.parse(p.ts)) / 1000;
      if (compactedSincePrev) cause = "compaction";
      else if (p.model && r.model && p.model !== r.model) cause = "model-switch";
      else if (gap > ttl) cause = "idle";
      else cause = "context-changed";
    }
    if (cause) {
      const rereadWeight = w.read;
      const writeUnits = (r.cache_write - r.cache_write_1h) * w.write5m + r.cache_write_1h * w.write1h;
      const extra = Math.max(0, (writeUnits - r.cache_write * rereadWeight) * parts.perUnit);
      out.push({
        n: r.n ?? i + 1, ts: r.ts, session_id: r.session_id, dev: r.dev, cause,
        model: r.model, prev_model: prev?.model ?? null, gap_s: gap,
        rewritten_tokens: r.cache_write, context: r.input + r.cache_read + r.cache_write,
        cost_usd: r.cost_usd, extra_usd: extra,
      });
    }
    // The cache lifetime follows what the client writes: one-hour writes mean a one-hour cache.
    if (r.cache_write_1h > 0) ttl = 3600;
    else if (r.cache_write_5m > 0) ttl = 300;
    prev = r;
    compactedSincePrev = false;
  });
  return out;
}

function median(values: number[]): number {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(Math.round(n)));
const usd = (n: number) => `$${n >= 100 ? Math.round(n) : n.toFixed(2)}`;
const mins = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)}h` : `${Math.round(s / 60)}m`);

export type Lesson = { severity: "serious" | "warning" | "info"; title: string; detail: string; impact_usd: number | null };

/** Full analysis of one session's requests (ordered by time). */
export function analyzeSession(
  rows: RequestRow[],
  prices: Map<string, PriceRow>,
  extras: { compactions: { ts: string; trigger: string | null; pre_tokens: number | null }[]; toolLoops: { tool: string; count: number; ts: string }[] },
) {
  const numbered = rows.map((r, i) => ({ ...r, n: i + 1 }));
  let cumulative = 0;
  const requests = numbered.map((r) => {
    const parts = costParts(r, weightsFor(r.model, prices));
    cumulative += r.cost_usd;
    return {
      n: r.n, ts: r.ts, model: r.model, model_label: r.model ? modelLabel(r.model) : null, kind: r.kind,
      agent: r.agent, effort: r.effort, prompt_id: r.prompt_id,
      context: r.input + r.cache_read + r.cache_write, output_tokens: r.output,
      cache_read: r.cache_read, cache_write: r.cache_write, cost_usd: r.cost_usd, cumulative_cost: cumulative,
      duration_ms: r.duration_ms,
      parts: { input: parts.input, cache_write: parts.cache_write, cache_read: parts.cache_read, output: parts.output },
    };
  });

  const breaks = findCacheBreaks(numbered, prices);
  const breakAt = new Map(breaks.map((b) => [b.n, b]));

  // Spikes: requests far above the session's typical request.
  const typical = median(requests.filter((r) => r.kind === "main").map((r) => r.cost_usd)) || median(requests.map((r) => r.cost_usd));
  const spikes: Spike[] = requests
    .filter((r) => typical > 0 && r.cost_usd >= Math.max(5 * typical, 0.75))
    .map((r) => {
      const entries = Object.entries(r.parts) as [Spike["driver"], number][];
      const [driver] = entries.sort((a, b) => b[1] - a[1])[0];
      const b = breakAt.get(r.n);
      const detail =
        driver === "cache_write" ? (b ? `${BREAK_LABEL[b.cause]}: ${k(b.rewritten_tokens)} tokens rewritten` : `${k(r.cache_write)} tokens written to cache`)
        : driver === "output" ? `${k(r.output_tokens)} output tokens`
        : driver === "cache_read" ? `${k(r.cache_read)} tokens of context re-read`
        : `${k(r.context - r.cache_read - r.cache_write)} uncached input tokens`;
      return { n: r.n, ts: r.ts, cost_usd: r.cost_usd, times_median: r.cost_usd / typical, driver, detail, model: r.model_label, kind: r.kind };
    })
    .sort((a, b) => b.cost_usd - a.cost_usd)
    .slice(0, 15);

  // Model segments along the main conversation.
  const segments: Segment[] = [];
  for (const r of requests) {
    if (r.kind !== "main" || !r.model) continue;
    const last = segments[segments.length - 1];
    if (last && last.model === r.model) {
      last.to = r.n;
      last.requests += 1;
      last.cost_usd += r.cost_usd;
    } else {
      segments.push({ from: r.n, to: r.n, model: r.model, label: modelLabel(r.model), requests: 1, cost_usd: r.cost_usd });
    }
  }

  const totals = requests.reduce(
    (a, r) => ({
      input: a.input + r.parts.input, cache_write: a.cache_write + r.parts.cache_write,
      cache_read: a.cache_read + r.parts.cache_read, output: a.output + r.parts.output,
    }),
    { input: 0, cache_write: 0, cache_read: 0, output: 0 },
  );
  const total = totals.input + totals.cache_write + totals.cache_read + totals.output;
  const avoidable = breaks.filter((b) => b.cause !== "compaction").reduce((a, b) => a + b.extra_usd, 0);

  // ------------------------------------------------------------ lessons
  const lessons: Lesson[] = [];
  const byCause = new Map<BreakCause, CacheBreak[]>();
  for (const b of breaks) byCause.set(b.cause, [...(byCause.get(b.cause) ?? []), b]);
  const sum = (list: CacheBreak[] | undefined) => (list ?? []).reduce((a, b) => a + b.extra_usd, 0);

  const idle = byCause.get("idle");
  if (idle?.length) {
    const longest = Math.max(...idle.map((b) => b.gap_s ?? 0));
    lessons.push({
      severity: sum(idle) > 2 ? "serious" : "warning",
      title: `${idle.length} pause${idle.length > 1 ? "s" : ""} let the cache expire, costing ~${usd(sum(idle))} extra`,
      detail: `Longest pause ${mins(longest)}; each return rewrote up to ${k(Math.max(...idle.map((b) => b.rewritten_tokens)))} tokens. ${BREAK_HINT.idle}`,
      impact_usd: sum(idle),
    });
  }
  const switches = byCause.get("model-switch");
  if (switches?.length) {
    lessons.push({
      severity: sum(switches) > 2 ? "serious" : "warning",
      title: `${switches.length} model switch${switches.length > 1 ? "es" : ""} rebuilt the cache (~${usd(sum(switches))} extra)`,
      detail: `${switches.map((b) => `${b.prev_model ? modelLabel(b.prev_model) : "?"} → ${b.model ? modelLabel(b.model) : "?"} at request ${b.n}`).slice(0, 4).join(", ")}. ${BREAK_HINT["model-switch"]}`,
      impact_usd: sum(switches),
    });
  }
  const resumed = byCause.get("resumed");
  if (resumed?.length) {
    lessons.push({
      severity: sum(resumed) > 2 ? "warning" : "info",
      title: `Resumed with ${k(resumed[0].rewritten_tokens)} tokens of context (~${usd(sum(resumed))} to rebuild)`,
      detail: BREAK_HINT.resumed,
      impact_usd: sum(resumed),
    });
  }
  const changed = byCause.get("context-changed");
  if (changed?.length) {
    lessons.push({
      severity: sum(changed) > 2 ? "warning" : "info",
      title: `${changed.length} unexplained cache rebuild${changed.length > 1 ? "s" : ""} (~${usd(sum(changed))} extra)`,
      detail: BREAK_HINT["context-changed"],
      impact_usd: sum(changed),
    });
  }

  // Context growth: cost per request late in the session vs early.
  const main = requests.filter((r) => r.kind === "main");
  if (main.length >= 20) {
    const q = Math.floor(main.length / 4);
    const early = median(main.slice(0, q).map((r) => r.cost_usd));
    const late = median(main.slice(-q).map((r) => r.cost_usd));
    const lateCtx = median(main.slice(-q).map((r) => r.context));
    if (early > 0 && late > 1.8 * early) {
      lessons.push({
        severity: late > 3 * early ? "warning" : "info",
        title: `Late requests cost ${(late / early).toFixed(1)}× the early ones`,
        detail: `Typical request went from ${usd(early)} to ${usd(late)} as context grew to ~${k(lateCtx)} tokens. /clear between unrelated tasks, or /compact earlier, keeps every request cheap.`,
        impact_usd: null,
      });
    }
  }
  for (const threshold of [800_000, 400_000, 200_000]) {
    const first = main.find((r) => r.context >= threshold);
    if (first) {
      const above = main.filter((r) => r.context >= threshold);
      lessons.push({
        severity: threshold >= 400_000 ? "warning" : "info",
        title: `Context passed ${k(threshold)} tokens at request ${first.n}`,
        detail: `${above.length} requests ran with more than ${k(threshold)} tokens of context, costing ${usd(above.reduce((a, r) => a + r.cost_usd, 0))}. Each one re-reads the whole conversation.`,
        impact_usd: null,
      });
      break;
    }
  }
  if (total > 0 && totals.cache_read / total > 0.5) {
    lessons.push({
      severity: "info",
      title: `${Math.round((totals.cache_read / total) * 100)}% of this session's value was re-reading the conversation`,
      detail: "Cache reads are cheap per token, but a long context is re-read on every request. Shorter, focused sessions reduce this directly.",
      impact_usd: null,
    });
  }
  const sub = requests.filter((r) => r.kind === "subagent");
  const subCost = sub.reduce((a, r) => a + r.cost_usd, 0);
  if (total > 0 && subCost / total > 0.3) {
    const opusSub = sub.filter((r) => r.model?.includes("opus")).reduce((a, r) => a + r.cost_usd, 0);
    lessons.push({
      severity: subCost / total > 0.5 ? "warning" : "info",
      title: `Subagents spent ${usd(subCost)} (${Math.round((subCost / total) * 100)}% of the session)`,
      detail: `${sub.length} subagent requests${opusSub > 0 ? `, ${usd(opusSub)} of it on Opus` : ""}. Running routine subagents on Sonnet or Haiku (model: in the agent definition) costs far less.`,
      impact_usd: null,
    });
  }
  const maxEffort = requests.filter((r) => r.effort === "max");
  if (maxEffort.length >= 5 && maxEffort.length / requests.length > 0.2) {
    lessons.push({
      severity: "info",
      title: `${Math.round((maxEffort.length / requests.length) * 100)}% of requests used max effort`,
      detail: "Max effort spends many more tokens per answer; high suits most coding work.",
      impact_usd: null,
    });
  }
  for (const c of extras.compactions.filter((c) => c.trigger === "auto")) {
    lessons.push({
      severity: "info",
      title: `Auto-compacted at ${c.pre_tokens ? k(c.pre_tokens) : "?"} tokens`,
      detail: "The context window filled up. Compacting or clearing earlier, at a natural break between tasks, avoids paying for a full window.",
      impact_usd: null,
    });
  }
  for (const loop of extras.toolLoops.slice(0, 3)) {
    lessons.push({
      severity: loop.count >= 5 ? "warning" : "info",
      title: `${loop.tool} failed ${loop.count} times in a row`,
      detail: "A retry loop: each attempt is a full request with the whole context. Stepping in after two failures saves usage.",
      impact_usd: null,
    });
  }
  if (spikes.length) {
    const top = spikes[0];
    lessons.push({
      severity: top.times_median >= 15 ? "warning" : "info",
      title: `${spikes.length} spike${spikes.length > 1 ? "s" : ""}; the largest cost ${usd(top.cost_usd)} (${Math.round(top.times_median)}× a typical request)`,
      detail: `Request ${top.n}: ${top.detail}.`,
      impact_usd: null,
    });
  }
  const order = { serious: 0, warning: 1, info: 2 };
  lessons.sort((a, b) => order[a.severity] - order[b.severity] || (b.impact_usd ?? 0) - (a.impact_usd ?? 0));

  return {
    requests, breaks, spikes, segments, lessons,
    costSplit: { ...totals, total, avoidable_usd: avoidable, typical_request_usd: typical },
  };
}

/** Consecutive failures of the same tool (retry loops), from tool results ordered by time. */
export function toolLoops(results: { ts: string; tool: string; success: boolean | null }[], min = 3) {
  const loops: { tool: string; count: number; ts: string }[] = [];
  let run: { tool: string; count: number; ts: string } | null = null;
  for (const r of results) {
    if (r.success === false) {
      if (run && run.tool === r.tool) run.count += 1;
      else {
        if (run && run.count >= min) loops.push(run);
        run = { tool: r.tool, count: 1, ts: r.ts };
      }
    } else if (r.success === true && run && run.tool === r.tool) {
      if (run.count >= min) loops.push(run);
      run = null;
    }
  }
  if (run && run.count >= min) loops.push(run);
  return loops.sort((a, b) => b.count - a.count);
}
