import { db } from "@/lib/db";
import {
  avgContext, cacheHitRate, efficiency, humanDuration, MIN_CLAUDE_VERSION, modelLabel, planLabel,
  projectWeekly, sortInsights, teamBaselines, versionLess, WEEK_MS,
  type DevAggregate, type Insight, type LimitSnapshot,
} from "@/lib/analytics";

const RANGES = {
  "24h": { ms: 24 * 3600_000, bucket: "hour" },
  "7d": { ms: 7 * 86400_000, bucket: "day" },
  "30d": { ms: 30 * 86400_000, bucket: "day" },
} as const;
type RangeKey = keyof typeof RANGES;

// Limit snapshots older than the weekly window carry no current information.
const LIMIT_LOOKBACK_MS = 8 * 86400_000;

const TOKENS_SQL = `coalesce(input_tokens, 0) + coalesce(output_tokens, 0) + coalesce(cache_read_tokens, 0) + coalesce(cache_creation_tokens, 0)`;

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

export async function GET(req: Request) {
  const param = new URL(req.url).searchParams.get("range") ?? "7d";
  const range: RangeKey = param in RANGES ? (param as RangeKey) : "7d";
  const now = Date.now();
  const since = new Date(now - RANGES[range].ms);
  const weekAgo = new Date(now - WEEK_MS);
  const limitSince = new Date(now - LIMIT_LOOKBACK_MS);
  const bucket = RANGES[range].bucket;
  const sql = db();
  const tokens = sql.unsafe(TOKENS_SQL);

  const [
    devRows, devMetricRows, accountRows, account7dRows, accountMetaRows, limitRows, modelRows,
    seriesRows, devSeriesRows, devModelRows, errorRows, feedRows,
  ] = await Promise.all([
    sql`
      WITH e AS (
        SELECT *, coalesce(dev_name, host_name, '(unnamed)') AS dev FROM events
        WHERE ts >= ${since} AND event_name NOT LIKE 'ccm.%'
      )
      SELECT
        dev,
        max(team) AS team,
        array_remove(array_agg(DISTINCT user_email), NULL) AS emails,
        array_remove(array_agg(DISTINCT model) FILTER (WHERE event_name = 'api_request'), NULL) AS models,
        array_remove(array_agg(DISTINCT entrypoint), NULL) AS entrypoints,
        array_remove(array_agg(DISTINCT app_version), NULL) AS app_versions,
        array_remove(array_agg(DISTINCT host_name), NULL) AS hosts,
        count(DISTINCT session_id)::int AS sessions,
        count(*) FILTER (WHERE event_name = 'user_prompt')::int AS prompts,
        count(*) FILTER (WHERE event_name = 'api_request')::int AS requests,
        coalesce(sum(input_tokens) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS input_tokens,
        coalesce(sum(output_tokens) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS output_tokens,
        coalesce(sum(cache_read_tokens) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS cache_read_tokens,
        coalesce(sum(cache_creation_tokens) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS cache_creation_tokens,
        coalesce(sum(cost_usd) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS cost_usd,
        coalesce(sum(cost_usd) FILTER (WHERE event_name = 'api_request' AND query_source = 'subagent'), 0)::float8 AS subagent_cost_usd,
        count(*) FILTER (WHERE event_name = 'api_error')::int AS api_errors,
        count(*) FILTER (WHERE event_name = 'api_error' AND status_code = '429')::int AS rate_limited,
        count(*) FILTER (WHERE event_name = 'compaction')::int AS compactions,
        count(*) FILTER (WHERE event_name = 'compaction' AND attrs->>'trigger' = 'auto')::int AS auto_compactions,
        count(*) FILTER (WHERE event_name = 'tool_result')::int AS tool_calls,
        count(*) FILTER (WHERE event_name = 'tool_result' AND success = false)::int AS tool_failures,
        count(*) FILTER (WHERE event_name = 'tool_decision' AND attrs->>'decision' = 'reject')::int AS rejections,
        max(ts) AS last_seen
      FROM e
      GROUP BY dev`,
    sql`
      SELECT
        coalesce(dev_name, host_name, '(unnamed)') AS dev,
        coalesce(sum(value) FILTER (WHERE metric_name = 'active_time.total'), 0)::float8 AS active_seconds,
        coalesce(sum(value) FILTER (WHERE metric_name = 'lines_of_code.count' AND kind = 'added'), 0)::float8 AS lines_added,
        coalesce(sum(value) FILTER (WHERE metric_name = 'lines_of_code.count' AND kind = 'removed'), 0)::float8 AS lines_removed,
        coalesce(sum(value) FILTER (WHERE metric_name = 'commit.count'), 0)::float8 AS commits,
        coalesce(sum(value) FILTER (WHERE metric_name = 'pull_request.count'), 0)::float8 AS pull_requests
      FROM metric_points WHERE ts >= ${since}
      GROUP BY 1`,
    sql`
      SELECT
        user_email,
        array_remove(array_agg(DISTINCT coalesce(dev_name, host_name)), NULL) AS devs,
        count(DISTINCT session_id)::int AS sessions,
        count(*) FILTER (WHERE event_name = 'api_request')::int AS requests,
        coalesce(sum(${tokens}) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS total_tokens,
        coalesce(sum(cost_usd) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS cost_usd,
        count(*) FILTER (WHERE event_name = 'api_error' AND status_code = '429')::int AS rate_limited,
        max(ts) AS last_seen
      FROM events
      WHERE ts >= ${since} AND user_email IS NOT NULL AND event_name NOT LIKE 'ccm.%'
      GROUP BY user_email`,
    sql`
      SELECT user_email, coalesce(sum(cost_usd), 0)::float8 AS cost_7d, coalesce(sum(${tokens}), 0)::float8 AS tokens_7d
      FROM events
      WHERE ts >= ${weekAgo} AND event_name = 'api_request' AND user_email IS NOT NULL
      GROUP BY user_email`,
    sql`SELECT user_email, organization_type, rate_limit_tier, display_name, last_seen, last_dev_name FROM accounts`,
    // Status line snapshots carry the email directly; older ones are attributed through their session.
    sql`
      WITH s AS (
        SELECT DISTINCT ON (session_id) session_id, user_email FROM events
        WHERE ts >= ${limitSince} AND user_email IS NOT NULL AND session_id IS NOT NULL
        ORDER BY session_id, ts DESC
      )
      SELECT DISTINCT ON (coalesce(l.user_email, s.user_email))
        coalesce(l.user_email, s.user_email) AS user_email,
        l.five_hour_pct, l.five_hour_resets_at, l.seven_day_pct, l.seven_day_resets_at, l.ts
      FROM limit_snapshots l LEFT JOIN s USING (session_id)
      WHERE l.ts >= ${limitSince} AND l.seven_day_pct IS NOT NULL
        AND coalesce(l.user_email, s.user_email) IS NOT NULL
      ORDER BY coalesce(l.user_email, s.user_email), l.ts DESC`,
    sql`
      SELECT
        coalesce(e.model, 'unknown') AS model,
        count(*)::int AS requests,
        coalesce(sum(${tokens}), 0)::float8 AS total_tokens,
        coalesce(sum(e.output_tokens), 0)::float8 AS output_tokens,
        coalesce(sum(e.cost_usd), 0)::float8 AS cost_usd,
        count(DISTINCT coalesce(e.dev_name, e.host_name))::int AS developers,
        min(e.ts) AS first_seen
      FROM events e
      WHERE e.ts >= ${since} AND e.event_name = 'api_request'
      GROUP BY 1
      ORDER BY cost_usd DESC`,
    sql`
      SELECT date_trunc(${bucket}, ts) AS bucket, count(*)::int AS requests,
        coalesce(sum(${tokens}), 0)::float8 AS total_tokens, coalesce(sum(cost_usd), 0)::float8 AS cost_usd
      FROM events WHERE ts >= ${since} AND event_name = 'api_request'
      GROUP BY 1 ORDER BY 1`,
    sql`
      SELECT coalesce(dev_name, host_name, '(unnamed)') AS dev, date_trunc(${bucket}, ts) AS bucket,
        count(*)::int AS requests, coalesce(sum(${tokens}), 0)::float8 AS total_tokens,
        coalesce(sum(cost_usd), 0)::float8 AS cost_usd
      FROM events WHERE ts >= ${since} AND event_name = 'api_request'
      GROUP BY 1, 2 ORDER BY 2`,
    sql`
      SELECT coalesce(dev_name, host_name, '(unnamed)') AS dev, coalesce(model, 'unknown') AS model,
        count(*)::int AS requests, coalesce(sum(${tokens}), 0)::float8 AS total_tokens,
        coalesce(sum(cost_usd), 0)::float8 AS cost_usd
      FROM events WHERE ts >= ${since} AND event_name = 'api_request'
      GROUP BY 1, 2 ORDER BY cost_usd DESC`,
    sql`
      SELECT event_name, coalesce(status_code, '') AS status_code, left(coalesce(error, ''), 200) AS error,
        count(*)::int AS count, max(ts) AS last_seen,
        array_remove(array_agg(DISTINCT coalesce(dev_name, host_name)), NULL) AS devs
      FROM events
      WHERE ts >= ${since} AND (event_name IN ('api_error', 'api_retries_exhausted', 'internal_error', 'api_refusal')
        OR (event_name = 'compaction' AND error IS NOT NULL)
        OR (event_name = 'mcp_server_connection' AND attrs->>'status' = 'failed'))
      GROUP BY 1, 2, 3 ORDER BY count DESC LIMIT 20`,
    sql`
      SELECT id::text, ts, event_name, coalesce(dev_name, host_name) AS dev, user_email, model,
        (${tokens})::float8 AS tokens, cost_usd, tool_name, success, left(error, 200) AS error, status_code,
        duration_ms, attrs->>'trigger' AS trigger, attrs->>'pre_tokens' AS pre_tokens, attrs->>'post_tokens' AS post_tokens,
        attrs->>'prompt_length' AS prompt_length
      FROM events
      WHERE ts >= ${since} AND (event_name IN ('user_prompt', 'api_error', 'api_retries_exhausted', 'api_refusal',
          'compaction', 'internal_error', 'auth', 'subagent_completed')
        OR (event_name = 'api_request' AND cost_usd >= 0.05)
        OR (event_name = 'tool_result' AND success = false)
        OR (event_name = 'tool_decision' AND attrs->>'decision' = 'reject')
        OR (event_name = 'mcp_server_connection' AND attrs->>'status' = 'failed'))
      ORDER BY ts DESC LIMIT 60`,
  ]);

  // ---------------------------------------------------------------- accounts
  const accountMeta = new Map(accountMetaRows.map((a) => [a.user_email as string, a]));
  const cost7d = new Map(account7dRows.map((a) => [a.user_email as string, a]));
  const limitByEmail = new Map(limitRows.map((l) => [l.user_email as string, l as unknown as LimitSnapshot]));
  const emails = new Set<string>([
    ...accountRows.map((a) => a.user_email as string),
    ...limitRows.map((l) => l.user_email as string),
  ]);
  const accountsInRange = new Map(accountRows.map((a) => [a.user_email as string, a]));
  const accounts = [...emails].map((email) => {
    const a = accountsInRange.get(email) ?? {};
    const meta = accountMeta.get(email);
    const lim = limitByEmail.get(email);
    return {
      user_email: email,
      plan: planLabel(meta?.rate_limit_tier as string, meta?.organization_type as string),
      devs: (a.devs as string[]) ?? (meta?.last_dev_name ? [meta.last_dev_name as string] : []),
      sessions: num(a.sessions),
      requests: num(a.requests),
      total_tokens: num(a.total_tokens),
      cost_usd: num(a.cost_usd),
      cost_7d: num(cost7d.get(email)?.cost_7d),
      rate_limited: num(a.rate_limited),
      last_seen: (a.last_seen as Date) ?? (meta?.last_seen as Date) ?? null,
      five_hour: lim && lim.five_hour_pct !== null
        ? { pct: lim.five_hour_pct, resetsAt: lim.five_hour_resets_at, asOf: lim.ts }
        : null,
      weekly: projectWeekly(lim, now),
    };
  }).sort((x, y) => (y.weekly?.pct ?? -1) - (x.weekly?.pct ?? -1) || y.cost_7d - x.cost_7d);
  const accountByEmail = new Map(accounts.map((a) => [a.user_email, a]));

  // ---------------------------------------------------------------- developers
  const metricsByDev = new Map(devMetricRows.map((m) => [m.dev as string, m]));
  const aggregates: (DevAggregate & Row)[] = devRows.map((d) => {
    const m = metricsByDev.get(d.dev as string) ?? {};
    return {
      ...d,
      dev: d.dev as string,
      requests: num(d.requests), prompts: num(d.prompts), sessions: num(d.sessions),
      input_tokens: num(d.input_tokens), output_tokens: num(d.output_tokens),
      cache_read_tokens: num(d.cache_read_tokens), cache_creation_tokens: num(d.cache_creation_tokens),
      cost_usd: num(d.cost_usd), api_errors: num(d.api_errors), rate_limited: num(d.rate_limited),
      compactions: num(d.compactions), auto_compactions: num(d.auto_compactions),
      tool_calls: num(d.tool_calls), tool_failures: num(d.tool_failures), rejections: num(d.rejections),
      active_seconds: num(m.active_seconds), lines_added: num(m.lines_added), lines_removed: num(m.lines_removed),
      commits: num(m.commits), pull_requests: num(m.pull_requests),
    };
  });
  const base = teamBaselines(aggregates);
  const teamCost = base.costShareTotal;

  const developers = aggregates.map((d) => {
    const devEmails = (d.emails as string[]) ?? [];
    // The account closest to its weekly limit is the one that constrains this developer.
    const weekly = devEmails
      .map((e) => accountByEmail.get(e)?.weekly)
      .filter((w): w is NonNullable<typeof w> => !!w)
      .sort((a, b) => b.pct - a.pct)[0] ?? null;
    return {
      ...d,
      share: teamCost > 0 ? d.cost_usd / teamCost : 0,
      cost_per_active_hour: d.active_seconds > 60 ? d.cost_usd / (d.active_seconds / 3600) : null,
      cost_per_prompt: d.prompts > 0 ? d.cost_usd / d.prompts : null,
      cache_hit: cacheHitRate(d),
      avg_context: avgContext(d),
      efficiency: efficiency(d, base),
      weekly,
    };
  }).sort((a, b) => b.cost_usd - a.cost_usd);

  // ---------------------------------------------------------------- insights
  const insights: Insight[] = [];
  for (const a of accounts) {
    const w = a.weekly;
    const who = a.devs.length ? ` · used by ${a.devs.join(", ")}` : "";
    if (w?.hitsLimitAt) {
      const until = new Date(w.hitsLimitAt).getTime() - now;
      insights.push({
        severity: "critical", kind: "limit-projection", subject: a.user_email,
        title: until <= 0 ? `${a.user_email} hit its weekly limit` : `${a.user_email} will hit its weekly limit in ~${humanDuration(until)}`,
        detail: `${Math.round(w.pct)}% used, resets in ${humanDuration(new Date(w.resetsAt).getTime() - now)} at the current pace of ${w.pacePerDay?.toFixed(0)}%/day${who}`,
      });
    } else if (w && w.pct >= 80) {
      insights.push({
        severity: "serious", kind: "limit-high", subject: a.user_email,
        title: `${a.user_email} is at ${Math.round(w.pct)}% of its weekly limit`,
        detail: `Resets in ${humanDuration(new Date(w.resetsAt).getTime() - now)}${who}`,
      });
    }
    if (a.devs.length > 1) {
      insights.push({
        severity: "info", kind: "shared-account", subject: a.user_email,
        title: `${a.user_email} is shared by ${a.devs.length} people`,
        detail: `${a.devs.join(", ")} draw from the same weekly limit`,
      });
    }
  }
  for (const d of developers) {
    const emailsUsed = ((d as Row).emails as string[]) ?? [];
    if (d.rate_limited > 0) {
      insights.push({
        severity: "serious", kind: "rate-limited", subject: d.dev,
        title: `${d.dev} was rate-limited ${d.rate_limited} time${d.rate_limited > 1 ? "s" : ""}`,
        detail: "Requests rejected with HTTP 429: a usage limit was reached during work",
      });
    }
    if (emailsUsed.length > 1) {
      insights.push({
        severity: "warning", kind: "account-switching", subject: d.dev,
        title: `${d.dev} switched between ${emailsUsed.length} accounts`,
        detail: emailsUsed.join(", "),
      });
    }
    if (d.avg_context !== null && d.avg_context > 150_000 && d.requests >= 15) {
      insights.push({
        severity: "warning", kind: "large-context", subject: d.dev,
        title: `${d.dev} runs very large contexts (~${Math.round(d.avg_context / 1000)}K tokens per request)`,
        detail: "Long sessions resend the whole conversation on every request. /clear between tasks cuts usage sharply",
      });
    }
    if (d.sessions > 0 && d.auto_compactions / d.sessions > 1) {
      insights.push({
        severity: "warning", kind: "auto-compaction", subject: d.dev,
        title: `${d.dev} hits auto-compaction ${(d.auto_compactions / d.sessions).toFixed(1)}× per session`,
        detail: `${d.auto_compactions} auto-compactions in ${d.sessions} sessions: sessions regularly fill the context window`,
      });
    }
    if (d.efficiency.score !== null && d.efficiency.score < 55) {
      const worst = [...d.efficiency.parts].sort((x, y) => x.score - y.score)[0];
      insights.push({
        severity: "warning", kind: "low-efficiency", subject: d.dev,
        title: `${d.dev} has a low efficiency score (${d.efficiency.score})`,
        detail: worst ? `Weakest area: ${worst.label.toLowerCase()} (${worst.value})` : "",
      });
    }
    const versions = ((d as Row).app_versions as string[]) ?? [];
    const old = versions.filter((v) => /^\d+\.\d+\.\d+$/.test(v) && versionLess(v, MIN_CLAUDE_VERSION));
    if (old.length) {
      insights.push({
        severity: "info", kind: "outdated-client", subject: d.dev,
        title: `${d.dev} uses an outdated Claude Code (${old.join(", ")})`,
        detail: "Update with: claude update, or update the IDE extension",
      });
    }
  }
  const top = developers[0];
  if (top && developers.length >= 3 && top.share > 0.4) {
    insights.push({
      severity: "info", kind: "concentration", subject: top.dev,
      title: `${top.dev} accounts for ${Math.round(top.share * 100)}% of team usage`,
      detail: `API-equivalent value ${top.cost_usd.toFixed(2)} USD in this period`,
    });
  }

  // ---------------------------------------------------------------- totals
  const sum = (f: (d: (typeof developers)[number]) => number) => developers.reduce((a, d) => a + f(d), 0);
  const totals = {
    cost_usd: sum((d) => d.cost_usd),
    tokens: sum((d) => d.input_tokens + d.output_tokens + d.cache_read_tokens + d.cache_creation_tokens),
    output_tokens: sum((d) => d.output_tokens),
    requests: sum((d) => d.requests),
    prompts: sum((d) => d.prompts),
    sessions: sum((d) => d.sessions),
    active_seconds: sum((d) => d.active_seconds),
    compactions: sum((d) => d.compactions),
    auto_compactions: sum((d) => d.auto_compactions),
    api_errors: sum((d) => d.api_errors),
    rate_limited: sum((d) => d.rate_limited),
    tool_calls: sum((d) => d.tool_calls),
    tool_failures: sum((d) => d.tool_failures),
    rejections: sum((d) => d.rejections),
    lines_changed: sum((d) => d.lines_added + d.lines_removed),
    cache_hit: (() => {
      const read = sum((d) => d.cache_read_tokens);
      const all = sum((d) => d.input_tokens + d.cache_read_tokens + d.cache_creation_tokens);
      return all > 0 ? read / all : null;
    })(),
    developers: developers.length,
    accounts: accounts.length,
    active_now: developers.filter((d) => now - new Date((d as Row).last_seen as Date).getTime() < 15 * 60_000).length,
  };

  return Response.json(
    {
      range, bucket, since, generatedAt: new Date(now),
      totals,
      insights: sortInsights(insights),
      developers,
      accounts,
      models: modelRows.map((m) => ({ ...m, label: modelLabel(m.model as string) })),
      series: seriesRows,
      devSeries: devSeriesRows,
      devModels: devModelRows.map((m) => ({ ...m, label: modelLabel(m.model as string) })),
      errors: errorRows,
      feed: feedRows,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
