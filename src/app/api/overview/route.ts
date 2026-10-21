import { json, pick, requestFilters } from "@/lib/api";
import { db } from "@/lib/db";
import { rangeInfo } from "@/lib/filters";
import { buildInsights } from "@/lib/insights";
import {
  BREAKDOWNS, breakdowns, buildAccounts, buildPeople, errorGroups, heatmap, liveNow, periodTotals, series, sessionsList,
} from "@/lib/queries";

/** Team overview: totals with the previous period, usage over time, attention items and breakdowns. */
export async function GET(req: Request) {
  const { f, params } = requestFilters(req);
  const by = pick(params.get("by"), BREAKDOWNS, "none");
  const sql = db();
  const now = Date.now();

  const accountsPromise = buildAccounts(sql, f);
  const [accounts, { people }, prev, timeline, heat, mix, topSessions, live, errors] = await Promise.all([
    accountsPromise,
    buildPeople(sql, f, accountsPromise),
    periodTotals(sql, f),
    series(sql, f, by),
    heatmap(sql, f),
    breakdowns(sql, f),
    sessionsList(sql, f, {}, "cost", 10),
    liveNow(sql, f),
    errorGroups(sql, f),
  ]);

  const sum = (fn: (p: (typeof people)[number]) => number) => people.reduce((a, p) => a + fn(p), 0);
  const context = sum((p) => p.input_tokens + p.cache_read_tokens + p.cache_creation_tokens);
  const totals = {
    cost_usd: sum((p) => p.cost_usd),
    tokens: sum((p) => p.input_tokens + p.output_tokens + p.cache_read_tokens + p.cache_creation_tokens),
    output_tokens: sum((p) => p.output_tokens),
    requests: sum((p) => p.requests),
    prompts: sum((p) => p.prompts),
    sessions: sum((p) => p.sessions),
    people: people.filter((p) => p.requests > 0).length,
    known_people: people.length,
    accounts: accounts.filter((a) => a.requests > 0).length,
    active_seconds: sum((p) => p.active_seconds),
    lines_changed: sum((p) => p.lines_added + p.lines_removed),
    commits: sum((p) => p.commits),
    compactions: sum((p) => p.compactions),
    auto_compactions: sum((p) => p.auto_compactions),
    api_errors: sum((p) => p.api_errors),
    rate_limited: sum((p) => p.rate_limited),
    tool_calls: sum((p) => p.tool_calls),
    tool_failures: sum((p) => p.tool_failures),
    rejections: sum((p) => p.rejections),
    cache_hit: context > 0 ? sum((p) => p.cache_read_tokens) / context : null,
    subagent_cost_usd: sum((p) => p.subagent_cost_usd),
    opus_cost_usd: sum((p) => p.opus_cost_usd),
  };

  return json({
    ...rangeInfo(f),
    generatedAt: new Date(now).toISOString(),
    by,
    totals,
    previous: prev,
    series: timeline,
    insights: buildInsights(people, accounts, topSessions, now),
    people,
    accounts,
    heatmap: heat,
    ...mix,
    sessions: topSessions,
    live,
    errors: errors.slice(0, 8),
  });
}
