import type postgres from "postgres";
import {
  avgContext, cacheHitRate, efficiency, modelLabel, planLabel, projectWeekly, teamBaselines,
  type DevAggregate, type LimitSnapshot, type WeeklyProjection,
} from "./analytics";
import {
  bucketSql, CLIENT_SQL, CONTEXT_SQL, daySql, PERSON_SQL, scope, TOKENS_SQL, USAGE_KIND_SQL,
  type Filters, type ScopeOptions,
} from "./filters";
import type { PriceRow, RequestRow } from "./session-analysis";

/*
 * Aggregations shared by the analytics endpoints. Every function takes the parsed filters plus
 * optional extra scope (a person, an account or a session for detail pages).
 */

type Row = Record<string, unknown>;
export const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown) => (v ? new Date(v as Date).toISOString() : null);

/** Events that analytics read. Hook, plugin and settings events are diagnostic noise here. */
const ANALYTIC_EVENTS = [
  "api_request", "user_prompt", "api_error", "api_retries_exhausted", "api_refusal", "internal_error",
  "compaction", "tool_result", "tool_decision", "subagent_completed",
];

function fragments(sql: postgres.Sql) {
  return {
    person: sql.unsafe(PERSON_SQL),
    tokens: sql.unsafe(TOKENS_SQL),
    context: sql.unsafe(CONTEXT_SQL),
    kind: sql.unsafe(USAGE_KIND_SQL),
    client: sql.unsafe(CLIENT_SQL),
  };
}

// ---------------------------------------------------------------- people

export type PersonAggregate = DevAggregate & {
  team: string | null;
  emails: string[];
  models: string[];
  clients: string[];
  app_versions: string[];
  hosts: string[];
  subagent_cost_usd: number;
  opus_cost_usd: number;
  max_effort_requests: number;
  peak_context: number | null;
  credit_errors: number;
  active_days: number;
  first_seen: string | null;
  last_seen: string | null;
  commits: number;
  pull_requests: number;
};

async function personRows(sql: postgres.Sql, f: Filters, o: ScopeOptions = {}) {
  const { person, context, kind } = fragments(sql);
  const day = daySql(sql, f);
  const [events, metrics] = await Promise.all([
    sql`
      SELECT
        ${person} AS dev,
        max(team) AS team,
        array_remove(array_agg(DISTINCT user_email), NULL) AS emails,
        array_remove(array_agg(DISTINCT model) FILTER (WHERE event_name = 'api_request'), NULL) AS models,
        array_remove(array_agg(DISTINCT entrypoint), NULL) AS clients,
        array_remove(array_agg(DISTINCT app_version), NULL) AS app_versions,
        array_remove(array_agg(DISTINCT host_name), NULL) AS hosts,
        count(DISTINCT session_id) FILTER (WHERE event_name IN ('api_request', 'user_prompt'))::int AS sessions,
        count(*) FILTER (WHERE event_name = 'user_prompt')::int AS prompts,
        count(*) FILTER (WHERE event_name = 'api_request')::int AS requests,
        coalesce(sum(input_tokens) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS input_tokens,
        coalesce(sum(output_tokens) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS output_tokens,
        coalesce(sum(cache_read_tokens) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS cache_read_tokens,
        coalesce(sum(cache_creation_tokens) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS cache_creation_tokens,
        coalesce(sum(cost_usd) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS cost_usd,
        coalesce(sum(cost_usd) FILTER (WHERE event_name = 'api_request' AND ${kind} = 'subagent'), 0)::float8 AS subagent_cost_usd,
        coalesce(sum(cost_usd) FILTER (WHERE event_name = 'api_request' AND model ILIKE '%opus%'), 0)::float8 AS opus_cost_usd,
        count(*) FILTER (WHERE event_name = 'api_request' AND attrs->>'effort' = 'max')::int AS max_effort_requests,
        count(*) FILTER (WHERE event_name = 'api_request' AND ${kind} = 'main')::int AS main_requests,
        coalesce(sum(${context}) FILTER (WHERE event_name = 'api_request' AND ${kind} = 'main'), 0)::float8 AS main_context,
        max(${context}) FILTER (WHERE event_name = 'api_request' AND ${kind} = 'main')::float8 AS peak_context,
        count(*) FILTER (WHERE event_name = 'api_error')::int AS api_errors,
        count(*) FILTER (WHERE event_name = 'api_error' AND status_code = '429')::int AS rate_limited,
        count(*) FILTER (WHERE event_name = 'api_error' AND error ILIKE '%credit balance%')::int AS credit_errors,
        count(*) FILTER (WHERE event_name = 'compaction')::int AS compactions,
        count(*) FILTER (WHERE event_name = 'compaction' AND attrs->>'trigger' = 'auto')::int AS auto_compactions,
        count(*) FILTER (WHERE event_name = 'tool_result')::int AS tool_calls,
        count(*) FILTER (WHERE event_name = 'tool_result' AND success = false)::int AS tool_failures,
        count(*) FILTER (WHERE event_name = 'tool_decision' AND attrs->>'decision' = 'reject')::int AS rejections,
        count(DISTINCT ${day}) FILTER (WHERE event_name = 'api_request')::int AS active_days,
        min(ts) AS first_seen,
        max(ts) AS last_seen
      FROM events
      WHERE ${scope(sql, f, o)} AND event_name = ANY(${ANALYTIC_EVENTS})
      GROUP BY 1`,
    sql`
      SELECT
        ${person} AS dev,
        coalesce(sum(value) FILTER (WHERE metric_name = 'active_time.total'), 0)::float8 AS active_seconds,
        coalesce(sum(value) FILTER (WHERE metric_name = 'lines_of_code.count' AND kind = 'added'), 0)::float8 AS lines_added,
        coalesce(sum(value) FILTER (WHERE metric_name = 'lines_of_code.count' AND kind = 'removed'), 0)::float8 AS lines_removed,
        coalesce(sum(value) FILTER (WHERE metric_name = 'commit.count'), 0)::float8 AS commits,
        coalesce(sum(value) FILTER (WHERE metric_name = 'pull_request.count'), 0)::float8 AS pull_requests
      FROM metric_points
      WHERE ${scope(sql, f, { ...o, ignoreModel: true })}
      GROUP BY 1`,
  ]);
  const metricsByDev = new Map(metrics.map((m) => [m.dev as string, m]));
  return events.map((d): PersonAggregate => {
    const m = metricsByDev.get(d.dev as string) ?? {};
    return {
      dev: d.dev as string,
      team: (d.team as string) ?? null,
      emails: (d.emails as string[]) ?? [],
      models: (d.models as string[]) ?? [],
      clients: (d.clients as string[]) ?? [],
      app_versions: (d.app_versions as string[]) ?? [],
      hosts: (d.hosts as string[]) ?? [],
      sessions: num(d.sessions), prompts: num(d.prompts), requests: num(d.requests),
      input_tokens: num(d.input_tokens), output_tokens: num(d.output_tokens),
      cache_read_tokens: num(d.cache_read_tokens), cache_creation_tokens: num(d.cache_creation_tokens),
      cost_usd: num(d.cost_usd), subagent_cost_usd: num(d.subagent_cost_usd), opus_cost_usd: num(d.opus_cost_usd),
      max_effort_requests: num(d.max_effort_requests),
      main_requests: num(d.main_requests), main_context: num(d.main_context), peak_context: numOrNull(d.peak_context),
      api_errors: num(d.api_errors), rate_limited: num(d.rate_limited), credit_errors: num(d.credit_errors),
      compactions: num(d.compactions), auto_compactions: num(d.auto_compactions),
      tool_calls: num(d.tool_calls), tool_failures: num(d.tool_failures), rejections: num(d.rejections),
      active_days: num(d.active_days), first_seen: iso(d.first_seen), last_seen: iso(d.last_seen),
      active_seconds: num(m.active_seconds), lines_added: num(m.lines_added), lines_removed: num(m.lines_removed),
      commits: num(m.commits), pull_requests: num(m.pull_requests),
    };
  });
}

/** Lightweight totals for the comparison period. */
export async function periodTotals(sql: postgres.Sql, f: Filters, o: ScopeOptions = {}) {
  const { person, tokens } = fragments(sql);
  const [[row], [m]] = await Promise.all([sql`
    SELECT
      coalesce(sum(cost_usd) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS cost_usd,
      coalesce(sum(${tokens}) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS tokens,
      count(*) FILTER (WHERE event_name = 'api_request')::int AS requests,
      count(*) FILTER (WHERE event_name = 'user_prompt')::int AS prompts,
      count(DISTINCT session_id) FILTER (WHERE event_name IN ('api_request', 'user_prompt'))::int AS sessions,
      count(DISTINCT ${person}) FILTER (WHERE event_name = 'api_request')::int AS people,
      count(*) FILTER (WHERE event_name = 'api_error')::int AS api_errors,
      count(*) FILTER (WHERE event_name = 'api_error' AND status_code = '429')::int AS rate_limited,
      count(*) FILTER (WHERE event_name = 'compaction' AND attrs->>'trigger' = 'auto')::int AS auto_compactions,
      coalesce(sum(cache_read_tokens) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS cache_read_tokens,
      coalesce(sum(coalesce(input_tokens, 0) + coalesce(cache_read_tokens, 0) + coalesce(cache_creation_tokens, 0))
        FILTER (WHERE event_name = 'api_request'), 0)::float8 AS context_tokens
    FROM events
    WHERE ${scope(sql, f, { ...o, previous: true })}
      AND event_name IN ('api_request', 'user_prompt', 'api_error', 'compaction')`,
  sql`
    SELECT
      coalesce(sum(value) FILTER (WHERE metric_name = 'active_time.total'), 0)::float8 AS active_seconds,
      coalesce(sum(value) FILTER (WHERE metric_name = 'lines_of_code.count'), 0)::float8 AS lines_changed
    FROM metric_points WHERE ${scope(sql, f, { ...o, previous: true, ignoreModel: true })}`]);
  return {
    cost_usd: num(row.cost_usd), tokens: num(row.tokens), requests: num(row.requests), prompts: num(row.prompts),
    sessions: num(row.sessions), people: num(row.people), api_errors: num(row.api_errors),
    rate_limited: num(row.rate_limited), auto_compactions: num(row.auto_compactions),
    cache_hit: num(row.context_tokens) > 0 ? num(row.cache_read_tokens) / num(row.context_tokens) : null,
    active_seconds: num(m.active_seconds), lines_changed: num(m.lines_changed),
  };
}

// ---------------------------------------------------------------- accounts & limits

export type AccountLimit = {
  user_email: string;
  plan: string | null;
  display_name: string | null;
  weekly: WeeklyProjection | null;
  five_hour: { pct: number; resetsAt: string | null; asOf: string } | null;
  /** True when no status line snapshot exists at all (the account is used only from IDE extensions). */
  never_reported: boolean;
};

// Limit snapshots older than the weekly window carry no current information.
const LIMIT_LOOKBACK = "8 days";

/** Current limit state and plan for every known account. Not range-filtered: limits are "now". */
export async function accountLimits(sql: postgres.Sql, now: number): Promise<Map<string, AccountLimit>> {
  const [meta, latest, ever] = await Promise.all([
    sql`SELECT user_email, organization_type, rate_limit_tier, display_name FROM accounts`,
    // Status line snapshots carry the email directly; older ones are attributed through their session.
    sql`
      WITH s AS (
        SELECT DISTINCT ON (session_id) session_id, user_email FROM events
        WHERE ts >= now() - ${LIMIT_LOOKBACK}::interval AND user_email IS NOT NULL AND session_id IS NOT NULL
          AND event_name = 'api_request'
        ORDER BY session_id, ts DESC
      )
      SELECT DISTINCT ON (coalesce(l.user_email, s.user_email))
        coalesce(l.user_email, s.user_email) AS user_email,
        l.five_hour_pct, l.five_hour_resets_at, l.seven_day_pct, l.seven_day_resets_at, l.ts
      FROM limit_snapshots l LEFT JOIN s USING (session_id)
      WHERE l.ts >= now() - ${LIMIT_LOOKBACK}::interval AND l.seven_day_pct IS NOT NULL
        AND coalesce(l.user_email, s.user_email) IS NOT NULL
      ORDER BY coalesce(l.user_email, s.user_email), l.ts DESC`,
    sql`SELECT DISTINCT user_email FROM limit_snapshots WHERE seven_day_pct IS NOT NULL AND user_email IS NOT NULL`,
  ]);
  const reported = new Set(ever.map((r) => r.user_email as string));
  const byEmail = new Map(latest.map((l) => [l.user_email as string, l as unknown as LimitSnapshot]));
  const out = new Map<string, AccountLimit>();
  const emails = new Set([...meta.map((m) => m.user_email as string), ...byEmail.keys()]);
  const metaBy = new Map(meta.map((m) => [m.user_email as string, m]));
  for (const email of emails) {
    const m = metaBy.get(email);
    const l = byEmail.get(email);
    const fiveFresh = l && l.five_hour_pct !== null && (!l.five_hour_resets_at || new Date(l.five_hour_resets_at).getTime() > now);
    out.set(email, {
      user_email: email,
      plan: planLabel(m?.rate_limit_tier as string, m?.organization_type as string),
      display_name: (m?.display_name as string) ?? null,
      weekly: projectWeekly(l, now),
      five_hour: fiveFresh ? { pct: l!.five_hour_pct as number, resetsAt: iso(l!.five_hour_resets_at), asOf: iso(l!.ts)! } : null,
      never_reported: !reported.has(email),
    });
  }
  return out;
}

/**
 * Real-time burn per account, independent of the selected range: value used in the last hour,
 * 5 hours, 24 hours, 7 days, and within the current weekly window when its reset time is known.
 */
export async function accountBurn(sql: postgres.Sql, limits: Map<string, AccountLimit>) {
  const rows = await sql`
    SELECT user_email, date_trunc('hour', ts) AS hour, coalesce(sum(cost_usd), 0)::float8 AS cost_usd
    FROM events
    WHERE event_name = 'api_request' AND user_email IS NOT NULL AND ts >= now() - interval '8 days'
    GROUP BY 1, 2`;
  const now = Date.now();
  const out = new Map<string, { cost_1h: number; cost_5h: number; cost_24h: number; cost_7d: number; cost_window: number | null }>();
  for (const r of rows) {
    const email = r.user_email as string;
    const t = new Date(r.hour as Date).getTime();
    const c = num(r.cost_usd);
    const acc = out.get(email) ?? { cost_1h: 0, cost_5h: 0, cost_24h: 0, cost_7d: 0, cost_window: null };
    const age = now - t;
    if (age < 3600_000) acc.cost_1h += c;
    if (age < 5 * 3600_000) acc.cost_5h += c;
    if (age < 24 * 3600_000) acc.cost_24h += c;
    if (age < 7 * 86400_000) acc.cost_7d += c;
    const w = limits.get(email)?.weekly;
    if (w) {
      const start = new Date(w.resetsAt).getTime() - 7 * 86400_000;
      if (t + 3600_000 > start) acc.cost_window = (acc.cost_window ?? 0) + c;
    }
    out.set(email, acc);
  }
  return out;
}

export async function accountRows(sql: postgres.Sql, f: Filters, o: ScopeOptions = {}) {
  const { person, tokens } = fragments(sql);
  const [accounts, split] = await Promise.all([
    sql`
      SELECT
        user_email,
        count(DISTINCT session_id) FILTER (WHERE event_name IN ('api_request', 'user_prompt'))::int AS sessions,
        count(*) FILTER (WHERE event_name = 'user_prompt')::int AS prompts,
        count(*) FILTER (WHERE event_name = 'api_request')::int AS requests,
        coalesce(sum(${tokens}) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS total_tokens,
        coalesce(sum(cost_usd) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS cost_usd,
        coalesce(sum(cost_usd) FILTER (WHERE event_name = 'api_request' AND model ILIKE '%opus%'), 0)::float8 AS opus_cost_usd,
        count(*) FILTER (WHERE event_name = 'api_error' AND status_code = '429')::int AS rate_limited,
        array_remove(array_agg(DISTINCT entrypoint), NULL) AS clients,
        min(ts) FILTER (WHERE event_name = 'api_request') AS first_seen,
        max(ts) AS last_seen
      FROM events
      WHERE ${scope(sql, f, o)} AND user_email IS NOT NULL AND event_name IN ('api_request', 'user_prompt', 'api_error')
      GROUP BY 1`,
    sql`
      SELECT user_email, ${person} AS dev,
        coalesce(sum(cost_usd), 0)::float8 AS cost_usd,
        count(*)::int AS requests,
        count(DISTINCT session_id)::int AS sessions,
        max(ts) AS last_seen
      FROM events
      WHERE ${scope(sql, f, o)} AND user_email IS NOT NULL AND event_name = 'api_request'
      GROUP BY 1, 2
      ORDER BY cost_usd DESC`,
  ]);
  const people = new Map<string, { dev: string; cost_usd: number; requests: number; sessions: number; last_seen: string | null }[]>();
  for (const s of split) {
    const list = people.get(s.user_email as string) ?? [];
    list.push({ dev: s.dev as string, cost_usd: num(s.cost_usd), requests: num(s.requests), sessions: num(s.sessions), last_seen: iso(s.last_seen) });
    people.set(s.user_email as string, list);
  }
  return accounts.map((a) => ({
    user_email: a.user_email as string,
    sessions: num(a.sessions), prompts: num(a.prompts), requests: num(a.requests),
    total_tokens: num(a.total_tokens), cost_usd: num(a.cost_usd), opus_cost_usd: num(a.opus_cost_usd),
    rate_limited: num(a.rate_limited), clients: (a.clients as string[]) ?? [],
    first_seen: iso(a.first_seen), last_seen: iso(a.last_seen),
    people: people.get(a.user_email as string) ?? [],
  }));
}

/** Accounts merged with limits and burn; accounts with no activity in range are kept when unfiltered. */
export async function buildAccounts(sql: postgres.Sql, f: Filters, o: ScopeOptions = {}, includeIdle = true) {
  const now = Date.now();
  const rowsPromise = accountRows(sql, f, o);
  const limits = await accountLimits(sql, now);
  const [rows, burn] = await Promise.all([rowsPromise, accountBurn(sql, limits)]);
  const byEmail = new Map(rows.map((r) => [r.user_email, r]));
  const emails = new Set(rows.map((r) => r.user_email));
  if (includeIdle) {
    for (const email of limits.keys()) {
      if (f.accounts.length === 0 || f.accounts.includes(email)) emails.add(email);
    }
  }
  const total = rows.reduce((a, r) => a + r.cost_usd, 0);
  return [...emails].map((email) => {
    const r = byEmail.get(email);
    const l = limits.get(email);
    const b = burn.get(email);
    return {
      user_email: email,
      plan: l?.plan ?? null,
      display_name: l?.display_name ?? null,
      weekly: l?.weekly ?? null,
      five_hour: l?.five_hour ?? null,
      never_reported: l?.never_reported ?? true,
      sessions: r?.sessions ?? 0, prompts: r?.prompts ?? 0, requests: r?.requests ?? 0,
      total_tokens: r?.total_tokens ?? 0, cost_usd: r?.cost_usd ?? 0, opus_cost_usd: r?.opus_cost_usd ?? 0,
      share: total > 0 ? (r?.cost_usd ?? 0) / total : 0,
      rate_limited: r?.rate_limited ?? 0, clients: r?.clients ?? [],
      first_seen: r?.first_seen ?? null, last_seen: r?.last_seen ?? null,
      people: r?.people ?? [],
      burn: b ?? { cost_1h: 0, cost_5h: 0, cost_24h: 0, cost_7d: 0, cost_window: null },
    };
  }).sort((x, y) => (y.weekly?.pct ?? -1) - (x.weekly?.pct ?? -1) || y.burn.cost_7d - x.burn.cost_7d || y.cost_usd - x.cost_usd);
}
export type AccountSummary = Awaited<ReturnType<typeof buildAccounts>>[number];

// ---------------------------------------------------------------- people, enriched

/** Daily value per person (local days), used for sparklines and spike detection. */
export async function personDays(sql: postgres.Sql, f: Filters, o: ScopeOptions = {}) {
  const { person } = fragments(sql);
  const rows = await sql`
    SELECT ${person} AS dev, ${daySql(sql, f)} AS day, coalesce(sum(cost_usd), 0)::float8 AS cost_usd, count(*)::int AS requests
    FROM events WHERE ${scope(sql, f, o)} AND event_name = 'api_request'
    GROUP BY 1, 2`;
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = out.get(r.dev as string) ?? new Map<string, number>();
    m.set(r.day as string, num(r.cost_usd));
    out.set(r.dev as string, m);
  }
  return out;
}

/** People known from installed devices, so people with no usage in the range still appear. */
async function knownPeople(sql: postgres.Sql, f: Filters) {
  const rows = await sql`
    SELECT coalesce(dev_name, host_name, '(unnamed)') AS dev, max(team) AS team, max(last_heartbeat) AS last_heartbeat
    FROM devices GROUP BY 1`;
  return rows
    .filter((r) => (f.people.length === 0 || f.people.includes(r.dev as string)) && (f.teams.length === 0 || f.teams.includes(r.team as string)))
    .map((r) => ({ dev: r.dev as string, team: (r.team as string) ?? null, last_heartbeat: iso(r.last_heartbeat) }));
}

const EMPTY_AGG = {
  emails: [], models: [], clients: [], app_versions: [], hosts: [],
  sessions: 0, prompts: 0, requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0,
  cost_usd: 0, subagent_cost_usd: 0, opus_cost_usd: 0, max_effort_requests: 0, main_requests: 0, main_context: 0,
  peak_context: null, api_errors: 0, rate_limited: 0, credit_errors: 0, compactions: 0, auto_compactions: 0,
  tool_calls: 0, tool_failures: 0, rejections: 0, active_days: 0, first_seen: null, last_seen: null,
  active_seconds: 0, lines_added: 0, lines_removed: 0, commits: 0, pull_requests: 0,
};

export async function buildPeople(
  sql: postgres.Sql, f: Filters, accountsInput: AccountSummary[] | Promise<AccountSummary[]>, o: ScopeOptions = {},
) {
  const filtersOnlyPeople = f.accounts.length + f.models.length + f.clients.length === 0;
  const [rows, prev, days, known] = await Promise.all([
    personRows(sql, f, o),
    sql`
      SELECT ${sql.unsafe(PERSON_SQL)} AS dev, coalesce(sum(cost_usd), 0)::float8 AS cost_usd
      FROM events WHERE ${scope(sql, f, { ...o, previous: true })} AND event_name = 'api_request'
      GROUP BY 1`,
    personDays(sql, f, o),
    // Idle people are only meaningful when the filter does not restrict usage itself.
    filtersOnlyPeople && o.person === undefined && o.account === undefined ? knownPeople(sql, f) : Promise.resolve([]),
  ]);
  const accounts = await accountsInput;
  const prevBy = new Map(prev.map((p) => [p.dev as string, num(p.cost_usd)]));
  const all: PersonAggregate[] = [...rows];
  for (const k of known) {
    if (!rows.some((r) => r.dev === k.dev)) all.push({ ...EMPTY_AGG, dev: k.dev, team: k.team } as PersonAggregate);
  }
  const base = teamBaselines(all);
  const accountBy = new Map(accounts.map((a) => [a.user_email, a]));
  const total = base.costShareTotal;
  return {
    base,
    people: all.map((d) => {
      const weekly = d.emails
        .map((e) => accountBy.get(e)?.weekly)
        .filter((w): w is NonNullable<typeof w> => !!w)
        .sort((a, b) => b.pct - a.pct)[0] ?? null;
      const daily = days.get(d.dev);
      const dailyValues = daily ? [...daily.values()] : [];
      return {
        ...d,
        share: total > 0 ? d.cost_usd / total : 0,
        prev_cost_usd: prevBy.get(d.dev) ?? 0,
        cost_per_active_hour: d.active_seconds > 60 ? d.cost_usd / (d.active_seconds / 3600) : null,
        cost_per_prompt: d.prompts > 0 ? d.cost_usd / d.prompts : null,
        cost_per_active_day: d.active_days > 0 ? d.cost_usd / d.active_days : null,
        peak_day_cost: dailyValues.length ? Math.max(...dailyValues) : 0,
        cache_hit: cacheHitRate(d),
        avg_context: avgContext(d),
        opus_share: d.cost_usd > 0 ? d.opus_cost_usd / d.cost_usd : null,
        subagent_share: d.cost_usd > 0 ? d.subagent_cost_usd / d.cost_usd : null,
        max_effort_share: d.requests > 0 ? d.max_effort_requests / d.requests : null,
        efficiency: efficiency(d, base),
        weekly,
        daily: daily ? Object.fromEntries(daily) : {},
      };
    }).sort((a, b) => b.cost_usd - a.cost_usd),
  };
}
export type PersonSummary = Awaited<ReturnType<typeof buildPeople>>["people"][number];

// ---------------------------------------------------------------- breakdowns

export const BREAKDOWNS = ["none", "person", "account", "model", "client", "kind"] as const;
export type Breakdown = (typeof BREAKDOWNS)[number];

/** Time series of value, tokens and requests per bucket, optionally split by a dimension. */
export async function series(sql: postgres.Sql, f: Filters, by: Breakdown, o: ScopeOptions = {}) {
  const { person, tokens, kind, client } = fragments(sql);
  const key =
    by === "person" ? person
    : by === "account" ? sql`coalesce(user_email, '(unknown)')`
    : by === "model" ? sql`coalesce(model, 'unknown')`
    : by === "client" ? client
    : by === "kind" ? kind
    : sql`'total'`;
  const rows = await sql`
    SELECT ${bucketSql(sql, f)} AS bucket, ${key} AS key,
      coalesce(sum(cost_usd), 0)::float8 AS cost_usd,
      coalesce(sum(${tokens}), 0)::float8 AS tokens,
      count(*)::int AS requests
    FROM events WHERE ${scope(sql, f, o)} AND event_name = 'api_request'
    GROUP BY 1, 2 ORDER BY 1`;
  return rows.map((r) => ({
    bucket: r.bucket as string, key: r.key as string,
    cost_usd: num(r.cost_usd), tokens: num(r.tokens), requests: num(r.requests),
  }));
}

/** Value by local weekday (1 = Monday) and hour. */
export async function heatmap(sql: postgres.Sql, f: Filters, o: ScopeOptions = {}) {
  const rows = await sql`
    SELECT extract(isodow FROM ts AT TIME ZONE ${f.tz})::int AS dow, extract(hour FROM ts AT TIME ZONE ${f.tz})::int AS hour,
      coalesce(sum(cost_usd), 0)::float8 AS cost_usd, count(*)::int AS requests
    FROM events WHERE ${scope(sql, f, o)} AND event_name = 'api_request'
    GROUP BY 1, 2`;
  return rows.map((r) => ({ dow: num(r.dow), hour: num(r.hour), cost_usd: num(r.cost_usd), requests: num(r.requests) }));
}

export async function breakdowns(sql: postgres.Sql, f: Filters, o: ScopeOptions = {}) {
  const { person, tokens, kind, client, context } = fragments(sql);
  const where = sql`${scope(sql, f, o)} AND event_name = 'api_request'`;
  const [models, effort, kinds, clients, agents, tools] = await Promise.all([
    sql`
      SELECT coalesce(model, 'unknown') AS key, count(*)::int AS requests,
        coalesce(sum(${tokens}), 0)::float8 AS tokens, coalesce(sum(output_tokens), 0)::float8 AS output_tokens,
        coalesce(sum(cost_usd), 0)::float8 AS cost_usd, count(DISTINCT ${person})::int AS people,
        avg(duration_ms)::float8 AS avg_ms
      FROM events WHERE ${where} GROUP BY 1 ORDER BY cost_usd DESC`,
    sql`
      SELECT coalesce(attrs->>'effort', 'default') AS key, count(*)::int AS requests, coalesce(sum(cost_usd), 0)::float8 AS cost_usd
      FROM events WHERE ${where} GROUP BY 1 ORDER BY cost_usd DESC`,
    sql`
      SELECT ${kind} AS key, count(*)::int AS requests, coalesce(sum(cost_usd), 0)::float8 AS cost_usd,
        avg(${context})::float8 AS avg_context
      FROM events WHERE ${where} GROUP BY 1 ORDER BY cost_usd DESC`,
    sql`
      SELECT ${client} AS key, count(*)::int AS requests, coalesce(sum(cost_usd), 0)::float8 AS cost_usd, count(DISTINCT ${person})::int AS people
      FROM events WHERE ${where} GROUP BY 1 ORDER BY cost_usd DESC`,
    sql`
      SELECT coalesce(attrs->>'agent.name', split_part(query_source, ':', 3)) AS key, count(*)::int AS requests,
        coalesce(sum(cost_usd), 0)::float8 AS cost_usd
      FROM events WHERE ${where} AND query_source LIKE 'agent:%' GROUP BY 1 ORDER BY cost_usd DESC LIMIT 12`,
    sql`
      SELECT coalesce(tool_name, 'unknown') AS key, count(*)::int AS calls,
        count(*) FILTER (WHERE success = false)::int AS failures,
        avg(duration_ms)::float8 AS avg_ms,
        coalesce(sum((attrs->>'tool_result_size_bytes')::float8), 0)::float8 AS result_bytes
      FROM events WHERE ${scope(sql, f, o)} AND event_name = 'tool_result'
      GROUP BY 1 ORDER BY calls DESC LIMIT 15`,
  ]);
  const map = (rows: Row[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === "key" ? v : num(v)])));
  return {
    models: models.map((m) => ({ ...map([m])[0], label: modelLabel(m.key as string) })),
    effort: map(effort),
    kinds: map(kinds),
    clients: map(clients),
    agents: map(agents),
    tools: map(tools),
  };
}

// ---------------------------------------------------------------- sessions

export const SESSION_SORTS = ["cost", "recent", "duration", "context", "requests"] as const;
export type SessionSort = (typeof SESSION_SORTS)[number];

export async function sessionsList(sql: postgres.Sql, f: Filters, o: ScopeOptions = {}, sort: SessionSort = "cost", limit = 100) {
  const { person, tokens, context, kind } = fragments(sql);
  const order =
    sort === "recent" ? sql`last_ts DESC`
    : sort === "duration" ? sql`(last_ts - first_ts) DESC`
    : sort === "context" ? sql`peak_context DESC NULLS LAST`
    : sort === "requests" ? sql`requests DESC`
    : sql`cost_usd DESC`;
  const rows = await sql`
    SELECT session_id,
      min(${person}) AS dev,
      (array_agg(user_email ORDER BY ts DESC) FILTER (WHERE user_email IS NOT NULL))[1] AS user_email,
      min(entrypoint) AS client,
      array_remove(array_agg(DISTINCT model) FILTER (WHERE event_name = 'api_request'), NULL) AS models,
      min(ts) AS first_ts, max(ts) AS last_ts,
      count(*) FILTER (WHERE event_name = 'user_prompt')::int AS prompts,
      count(*) FILTER (WHERE event_name = 'api_request')::int AS requests,
      coalesce(sum(cost_usd) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS cost_usd,
      coalesce(sum(${tokens}) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS tokens,
      max(${context}) FILTER (WHERE event_name = 'api_request' AND ${kind} = 'main')::float8 AS peak_context,
      count(*) FILTER (WHERE event_name = 'compaction')::int AS compactions,
      count(*) FILTER (WHERE event_name = 'compaction' AND attrs->>'trigger' = 'auto')::int AS auto_compactions,
      count(*) FILTER (WHERE event_name IN ('api_error', 'api_retries_exhausted', 'internal_error')
        OR (event_name = 'tool_result' AND success = false))::int AS errors,
      count(*) FILTER (WHERE event_name = 'api_error' AND status_code = '429')::int AS rate_limited,
      count(*) FILTER (WHERE event_name = 'api_request' AND ${kind} = 'subagent')::int AS subagent_requests
    FROM events
    WHERE ${scope(sql, f, o)} AND session_id IS NOT NULL AND event_name = ANY(${ANALYTIC_EVENTS})
    GROUP BY session_id
    HAVING count(*) FILTER (WHERE event_name = 'api_request') > 0
    ORDER BY ${order}
    LIMIT ${limit}`;
  return rows.map((r) => ({
    session_id: r.session_id as string,
    dev: r.dev as string, user_email: (r.user_email as string) ?? null, client: (r.client as string) ?? null,
    models: ((r.models as string[]) ?? []).map((m) => ({ id: m, label: modelLabel(m) })),
    first_ts: iso(r.first_ts)!, last_ts: iso(r.last_ts)!,
    duration_s: (new Date(r.last_ts as Date).getTime() - new Date(r.first_ts as Date).getTime()) / 1000,
    prompts: num(r.prompts), requests: num(r.requests), cost_usd: num(r.cost_usd), tokens: num(r.tokens),
    peak_context: numOrNull(r.peak_context), compactions: num(r.compactions), auto_compactions: num(r.auto_compactions),
    errors: num(r.errors), rate_limited: num(r.rate_limited), subagent_requests: num(r.subagent_requests),
  }));
}
export type SessionSummary = Awaited<ReturnType<typeof sessionsList>>[number];

// ---------------------------------------------------------------- activity

export async function errorGroups(sql: postgres.Sql, f: Filters, o: ScopeOptions = {}) {
  const { person } = fragments(sql);
  const rows = await sql`
    SELECT event_name, coalesce(status_code, '') AS status_code, left(coalesce(error, attrs->>'error_type', ''), 240) AS error,
      count(*)::int AS count, max(ts) AS last_seen,
      array_remove(array_agg(DISTINCT ${person}), NULL) AS people,
      array_remove(array_agg(DISTINCT tool_name), NULL) AS tools
    FROM events
    WHERE ${scope(sql, f, o)} AND (event_name IN ('api_error', 'api_retries_exhausted', 'internal_error', 'api_refusal')
      OR (event_name = 'compaction' AND error IS NOT NULL)
      OR (event_name = 'tool_result' AND success = false)
      OR (event_name = 'mcp_server_connection' AND attrs->>'status' = 'failed'))
    GROUP BY 1, 2, 3 ORDER BY count DESC LIMIT 40`;
  return rows.map((r) => ({
    event_name: r.event_name as string, status_code: r.status_code as string, error: r.error as string,
    count: num(r.count), last_seen: iso(r.last_seen)!, people: (r.people as string[]) ?? [], tools: (r.tools as string[]) ?? [],
  }));
}

export async function feed(sql: postgres.Sql, f: Filters, o: ScopeOptions = {}, limit = 100) {
  const { person, tokens } = fragments(sql);
  const rows = await sql`
    SELECT id::text, ts, event_name, ${person} AS dev, user_email, model, session_id,
      (${tokens})::float8 AS tokens, cost_usd, tool_name, success, left(error, 200) AS error, status_code,
      duration_ms, attrs->>'trigger' AS trigger, attrs->>'pre_tokens' AS pre_tokens, attrs->>'post_tokens' AS post_tokens,
      attrs->>'prompt_length' AS prompt_length, attrs->>'command_name' AS command_name, attrs->>'agent_type' AS agent_type,
      attrs->>'action' AS action
    FROM events
    WHERE ${scope(sql, f, o)} AND (event_name IN ('user_prompt', 'api_error', 'api_retries_exhausted', 'api_refusal',
        'compaction', 'internal_error', 'auth', 'subagent_completed')
      OR (event_name = 'api_request' AND cost_usd >= 0.5)
      OR (event_name = 'tool_result' AND success = false)
      OR (event_name = 'tool_decision' AND attrs->>'decision' = 'reject')
      OR (event_name = 'mcp_server_connection' AND attrs->>'status' = 'failed'))
    ORDER BY ts DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    ...r,
    ts: iso(r.ts)!, tokens: num(r.tokens), cost_usd: numOrNull(r.cost_usd), duration_ms: numOrNull(r.duration_ms),
  }));
}

/** People active in the last 15 minutes and what they are spending right now. */
export async function liveNow(sql: postgres.Sql, f: Filters) {
  const { person } = fragments(sql);
  const now = Date.now();
  const live: Filters = { ...f, from: new Date(now - 3600_000), to: new Date(now + 60_000) };
  const rows = await sql`
    SELECT ${person} AS dev,
      max(ts) AS last_seen,
      coalesce(sum(cost_usd) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS cost_1h,
      coalesce(sum(cost_usd) FILTER (WHERE event_name = 'api_request' AND ts >= now() - interval '15 minutes'), 0)::float8 AS cost_15m,
      count(*) FILTER (WHERE event_name = 'api_request')::int AS requests_1h,
      (array_agg(user_email ORDER BY ts DESC) FILTER (WHERE user_email IS NOT NULL))[1] AS user_email,
      (array_agg(model ORDER BY ts DESC) FILTER (WHERE event_name = 'api_request' AND model IS NOT NULL))[1] AS model,
      (array_agg(session_id ORDER BY ts DESC) FILTER (WHERE session_id IS NOT NULL))[1] AS session_id,
      (array_agg(entrypoint ORDER BY ts DESC) FILTER (WHERE entrypoint IS NOT NULL))[1] AS client
    FROM events
    WHERE ${scope(sql, live)} AND event_name IN ('api_request', 'user_prompt', 'tool_result')
    GROUP BY 1
    HAVING max(ts) >= now() - interval '15 minutes'
    ORDER BY cost_1h DESC`;
  return rows.map((r) => ({
    dev: r.dev as string, last_seen: iso(r.last_seen)!, cost_1h: num(r.cost_1h), cost_15m: num(r.cost_15m),
    requests_1h: num(r.requests_1h), user_email: (r.user_email as string) ?? null,
    model: r.model ? modelLabel(r.model as string) : null, session_id: (r.session_id as string) ?? null,
    client: (r.client as string) ?? null,
  }));
}

/** Median of positive values; null when empty. */
export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// ---------------------------------------------------------------- request-level analysis

export async function loadPrices(sql: postgres.Sql) {
  const rows = await sql<PriceRow[]>`
    SELECT model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok FROM model_prices`;
  return new Map(rows.map((r) => [r.model, r]));
}

/**
 * Requests in time order per session, with the token split needed for cache analysis.
 * `mainOnly` keeps just the conversation and compaction requests (enough to find cache breaks).
 */
export async function loadRequestRows(sql: postgres.Sql, f: Filters, o: ScopeOptions = {}, mainOnly = false): Promise<RequestRow[]> {
  const { person, kind } = fragments(sql);
  const rows = await sql`
    SELECT ts, session_id, ${person} AS dev, model, ${kind} AS kind, attrs->>'agent.name' AS agent, attrs->>'effort' AS effort, prompt_id,
      coalesce(input_tokens, 0)::float8 AS input, coalesce(output_tokens, 0)::float8 AS output,
      coalesce(cache_read_tokens, 0)::float8 AS cache_read, coalesce(cache_creation_tokens, 0)::float8 AS cache_write,
      coalesce((attrs->>'cache_creation_5m_tokens')::float8, 0) AS cache_write_5m,
      coalesce((attrs->>'cache_creation_1h_tokens')::float8, 0) AS cache_write_1h,
      coalesce(cost_usd, 0)::float8 AS cost_usd, coalesce(duration_ms, 0)::float8 AS duration_ms
    FROM events
    WHERE ${scope(sql, f, o)} AND event_name = 'api_request' AND session_id IS NOT NULL
      ${mainOnly ? sql`AND ${kind} IN ('main', 'compaction')` : sql``}
    ORDER BY session_id, ts
    LIMIT 200000`;
  return rows.map((r) => ({ ...(r as unknown as RequestRow), ts: new Date(r.ts as Date).toISOString() }));
}
