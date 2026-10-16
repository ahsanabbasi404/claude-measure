/*
 * Derived analytics: weekly-limit projection, efficiency scoring and attention items.
 * Every number here is explainable from fields shown on the dashboard.
 */

export const WEEK_MS = 7 * 86400_000;
const MIN_REQUESTS_FOR_SCORE = 15;
export const MIN_CLAUDE_VERSION = "2.1.200";

export type LimitSnapshot = {
  five_hour_pct: number | null;
  five_hour_resets_at: string | Date | null;
  seven_day_pct: number | null;
  seven_day_resets_at: string | Date | null;
  ts: string | Date;
};

export type WeeklyProjection = {
  pct: number;
  resetsAt: string;
  asOf: string;
  /** Percentage expected at reset if the pace since the window started continues. */
  projectedPct: number | null;
  /** When the limit would be reached at the current pace; null when it would not be reached before reset. */
  hitsLimitAt: string | null;
  /** Usage pace in percentage points per day. */
  pacePerDay: number | null;
};

/** Linear projection of the 7-day window from the latest snapshot. */
export function projectWeekly(s: LimitSnapshot | null | undefined, now: number): WeeklyProjection | null {
  if (!s || s.seven_day_pct === null || !s.seven_day_resets_at) return null;
  const resets = new Date(s.seven_day_resets_at).getTime();
  const asOf = new Date(s.ts).getTime();
  if (resets <= now) return null; // window already reset; the snapshot no longer applies
  const start = resets - WEEK_MS;
  const elapsed = asOf - start;
  const pct = s.seven_day_pct;
  const base = { pct, resetsAt: new Date(resets).toISOString(), asOf: new Date(asOf).toISOString() };
  // Too early in the window for a meaningful pace.
  if (elapsed < 6 * 3600_000 || pct <= 0) return { ...base, projectedPct: null, hitsLimitAt: null, pacePerDay: null };
  const perMs = pct / elapsed;
  const projectedPct = perMs * WEEK_MS;
  const hitMs = asOf + (100 - pct) / perMs;
  return {
    ...base,
    projectedPct,
    hitsLimitAt: pct >= 100 ? base.asOf : hitMs < resets ? new Date(hitMs).toISOString() : null,
    pacePerDay: perMs * 86400_000,
  };
}

export type DevAggregate = {
  dev: string;
  requests: number;
  prompts: number;
  sessions: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
  api_errors: number;
  rate_limited: number;
  compactions: number;
  auto_compactions: number;
  tool_calls: number;
  tool_failures: number;
  rejections: number;
  active_seconds: number;
  lines_added: number;
  lines_removed: number;
};

export type ScorePart = { key: string; label: string; score: number; value: string; hint: string; weight: number };
export type Efficiency = { score: number | null; label: "Efficient" | "Average" | "Wasteful" | "Not enough data"; parts: ScorePart[] };

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const contextTokens = (d: DevAggregate) => d.input_tokens + d.cache_read_tokens + d.cache_creation_tokens;
export const cacheHitRate = (d: DevAggregate) => {
  const total = contextTokens(d);
  return total > 0 ? d.cache_read_tokens / total : null;
};
export const avgContext = (d: DevAggregate) => (d.requests > 0 ? contextTokens(d) / d.requests : null);
export const linesPerDollar = (d: DevAggregate) =>
  d.cost_usd > 0 ? (d.lines_added + d.lines_removed) / d.cost_usd : null;

function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function teamBaselines(devs: DevAggregate[]) {
  const eligible = devs.filter((d) => d.requests >= MIN_REQUESTS_FOR_SCORE);
  return {
    linesPerDollar: median(eligible.map(linesPerDollar).filter((x): x is number => x !== null && x > 0)),
    costShareTotal: devs.reduce((a, d) => a + d.cost_usd, 0),
  };
}

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(Math.round(n)));

/**
 * Efficiency score 0-100, weighted from five parts. Parts without data are left out and the
 * remaining weights are renormalized.
 */
export function efficiency(d: DevAggregate, base: ReturnType<typeof teamBaselines>): Efficiency {
  if (d.requests < MIN_REQUESTS_FOR_SCORE) return { score: null, label: "Not enough data", parts: [] };
  const parts: ScorePart[] = [];

  const hit = cacheHitRate(d);
  if (hit !== null) {
    parts.push({
      key: "cache", label: "Cache reuse", weight: 0.2,
      score: clamp(((hit - 0.5) / 0.45) * 100),
      value: `${Math.round(hit * 100)}%`,
      hint: "Share of context served from prompt cache. Low values mean context is rebuilt often (frequent restarts, idle gaps over 5 minutes).",
    });
  }

  const ctx = avgContext(d);
  if (ctx !== null) {
    parts.push({
      key: "context", label: "Context size", weight: 0.25,
      score: clamp(100 - ((ctx - 60_000) / 140_000) * 100),
      value: `${k(ctx)} tokens/request`,
      hint: "Average tokens sent per request. Large contexts burn limits fastest; /clear between unrelated tasks keeps it small.",
    });
  }

  const lpd = linesPerDollar(d);
  if (lpd !== null && base.linesPerDollar) {
    parts.push({
      key: "output", label: "Output per $", weight: 0.25,
      score: clamp(50 * (lpd / base.linesPerDollar)),
      value: `${Math.round(lpd)} lines/$ (team median ${Math.round(base.linesPerDollar)})`,
      hint: "Lines changed per API-equivalent dollar, relative to the team median. Research-heavy work scores lower by nature.",
    });
  }

  const waste = (d.api_errors + d.tool_failures + d.rejections) / Math.max(1, d.requests + d.tool_calls);
  parts.push({
    key: "reliability", label: "Errors & rejections", weight: 0.15,
    score: clamp(100 - waste * 500),
    value: `${(waste * 100).toFixed(1)}% of actions`,
    hint: "API errors, failed tool calls and rejected tool uses. Each one is usage spent without progress.",
  });

  const autoPerSession = d.auto_compactions / Math.max(1, d.sessions);
  parts.push({
    key: "compaction", label: "Auto-compactions", weight: 0.15,
    score: clamp(100 - autoPerSession * 50),
    value: `${autoPerSession.toFixed(2)} per session`,
    hint: "Sessions that run until the context window fills. Each compaction re-summarizes the whole conversation.",
  });

  const totalWeight = parts.reduce((a, p) => a + p.weight, 0);
  const score = Math.round(parts.reduce((a, p) => a + p.score * p.weight, 0) / totalWeight);
  const label = score >= 75 ? "Efficient" : score >= 55 ? "Average" : "Wasteful";
  return { score, label, parts };
}

export type Severity = "critical" | "serious" | "warning" | "info";
export type Insight = { severity: Severity; title: string; detail: string; subject: string; kind: string };

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, serious: 1, warning: 2, info: 3 };

export function sortInsights(items: Insight[]): Insight[] {
  return items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function versionLess(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

export function humanDuration(ms: number): string {
  const h = ms / 3600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

/** Friendly model label derived from the id, so new models need no code change. */
export function modelLabel(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(id);
  if (!m) return id;
  const family = m[1][0].toUpperCase() + m[1].slice(1);
  return `${family} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

export function planLabel(tier: string | null | undefined, orgType: string | null | undefined): string | null {
  const t = `${tier ?? ""} ${orgType ?? ""}`.toLowerCase();
  if (t.includes("max_20x")) return "Max 20x";
  if (t.includes("max_5x")) return "Max 5x";
  if (t.includes("max")) return "Max";
  if (t.includes("pro")) return "Pro";
  if (t.includes("team")) return "Team";
  if (t.includes("enterprise")) return "Enterprise";
  return tier || orgType || null;
}
