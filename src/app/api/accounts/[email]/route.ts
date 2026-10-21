import { decodeParam, json, pick, requestFilters } from "@/lib/api";
import { db } from "@/lib/db";
import { rangeInfo } from "@/lib/filters";
import { buildInsights } from "@/lib/insights";
import {
  BREAKDOWNS, breakdowns, buildAccounts, buildPeople, errorGroups, heatmap, periodTotals, series, sessionsList,
} from "@/lib/queries";

/** One Claude account: limit state and history, who draws from it, and how. */
export async function GET(req: Request, ctx: RouteContext<"/api/accounts/[email]">) {
  const email = decodeParam((await ctx.params).email);
  const { f, params } = requestFilters(req);
  const by = pick(params.get("by"), BREAKDOWNS, "person");
  const sql = db();
  const now = Date.now();
  const o = { account: email };

  const all = await buildAccounts(sql, f);
  const account = all.find((a) => a.user_email === email) ?? null;
  const scoped = all.filter((a) => a.user_email === email);
  const [{ people }, prev, timeline, heat, mix, topSessions, errors, history, meta] = await Promise.all([
    buildPeople(sql, f, scoped, o),
    periodTotals(sql, f, o),
    series(sql, f, by, o),
    heatmap(sql, f, o),
    breakdowns(sql, f, o),
    sessionsList(sql, f, o, "cost", 25),
    errorGroups(sql, f, o),
    sql`
      SELECT ts, seven_day_pct, five_hour_pct, seven_day_resets_at, dev_name
      FROM limit_snapshots
      WHERE user_email = ${email} AND ts >= now() - interval '30 days' AND (seven_day_pct IS NOT NULL OR five_hour_pct IS NOT NULL)
      ORDER BY ts`,
    sql`SELECT account_uuid, organization_type, rate_limit_tier, first_seen, last_seen, last_dev_name FROM accounts WHERE user_email = ${email}`,
  ]);

  const insights = buildInsights(people, scoped, topSessions, now)
    .filter((i) => i.subjectType !== "person" || people.some((p) => p.dev === i.subject && p.requests > 0));

  return json({
    ...rangeInfo(f),
    generatedAt: new Date(now).toISOString(),
    email, by, account, meta: meta[0] ?? null, previous: prev,
    people: people.filter((p) => p.requests > 0),
    series: timeline, heatmap: heat, ...mix,
    sessions: topSessions, errors,
    history: history.map((h) => ({
      ts: new Date(h.ts as Date).toISOString(), weekly: h.seven_day_pct, five_hour: h.five_hour_pct, dev: h.dev_name,
    })),
    insights,
  });
}
