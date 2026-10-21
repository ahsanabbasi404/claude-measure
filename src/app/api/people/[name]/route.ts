import { decodeParam, json, pick, requestFilters } from "@/lib/api";
import { db } from "@/lib/db";
import { rangeInfo } from "@/lib/filters";
import { buildInsights } from "@/lib/insights";
import {
  BREAKDOWNS, breakdowns, buildAccounts, buildPeople, errorGroups, feed, heatmap, median, periodTotals, series, sessionsList,
} from "@/lib/queries";

/** One person: usage, comparison with the team, accounts, models, sessions, tools and errors. */
export async function GET(req: Request, ctx: RouteContext<"/api/people/[name]">) {
  const name = decodeParam((await ctx.params).name);
  const { f, params } = requestFilters(req);
  const by = pick(params.get("by"), BREAKDOWNS, "model");
  const sql = db();
  const now = Date.now();
  const o = { person: name };

  const accountsPromise = buildAccounts(sql, f);
  const [accounts, { people }, prev, timeline, heat, mix, topSessions, recentSessions, errors, activity, devices] = await Promise.all([
    accountsPromise,
    buildPeople(sql, f, accountsPromise),
    periodTotals(sql, f, o),
    series(sql, f, by, o),
    heatmap(sql, f, o),
    breakdowns(sql, f, o),
    sessionsList(sql, f, o, "cost", 25),
    sessionsList(sql, f, o, "recent", 25),
    errorGroups(sql, f, o),
    feed(sql, f, o, 60),
    sql`
      SELECT device_id, host_name, os_type, os_version, agent_version, claude_versions, last_heartbeat, first_seen
      FROM devices WHERE coalesce(dev_name, host_name, '(unnamed)') = ${name} ORDER BY last_heartbeat DESC`,
  ]);

  const person = people.find((p) => p.dev === name) ?? null;
  const active = people.filter((p) => p.requests >= 15);
  const rankBy = (get: (p: (typeof people)[number]) => number) =>
    person ? [...people].sort((a, b) => get(b) - get(a)).findIndex((p) => p.dev === name) + 1 : null;
  const team = {
    people: people.filter((p) => p.requests > 0).length,
    median: {
      cost_usd: median(active.map((p) => p.cost_usd)),
      cost_per_prompt: median(active.map((p) => p.cost_per_prompt ?? 0)),
      cost_per_active_day: median(active.map((p) => p.cost_per_active_day ?? 0)),
      avg_context: median(active.map((p) => p.avg_context ?? 0)),
      cache_hit: median(active.map((p) => p.cache_hit ?? 0)),
      efficiency: median(active.map((p) => p.efficiency.score ?? 0)),
      opus_share: median(active.map((p) => p.opus_share ?? 0)),
    },
    rank: { usage: rankBy((p) => p.cost_usd), efficiency: rankBy((p) => p.efficiency.score ?? -1) },
  };

  const insights = buildInsights(people, accounts, topSessions, now)
    .filter((i) => (i.subjectType === "person" && i.subject === name) || i.subjectType === "session"
      || (i.subjectType === "account" && person?.emails.includes(i.subject)));

  return json({
    ...rangeInfo(f),
    generatedAt: new Date(now).toISOString(),
    name, by, person, previous: prev, team,
    accounts: accounts.filter((a) => person?.emails.includes(a.user_email)).map((a) => ({
      ...a, person_cost_usd: a.people.find((p) => p.dev === name)?.cost_usd ?? 0,
    })),
    series: timeline, heatmap: heat, ...mix,
    sessions: { top: topSessions, recent: recentSessions },
    errors, activity, devices, insights,
  });
}
