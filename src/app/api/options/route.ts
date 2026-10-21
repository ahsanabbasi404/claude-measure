import { json } from "@/lib/api";
import { modelLabel } from "@/lib/analytics";
import { db } from "@/lib/db";
import { PERSON_SQL } from "@/lib/filters";

/**
 * Values for the filter controls, plus a stable order for each dimension. Chart colors follow this
 * order (by long-run usage), so an entity keeps its color whatever the current filter is.
 */
export async function GET() {
  const sql = db();
  const person = sql.unsafe(PERSON_SQL);
  const [people, devices, accounts, models, clients] = await Promise.all([
    sql`
      SELECT ${person} AS key, max(team) AS team, coalesce(sum(cost_usd), 0)::float8 AS cost_usd, max(ts) AS last_seen
      FROM events WHERE event_name = 'api_request' AND ts >= now() - interval '90 days'
      GROUP BY 1 ORDER BY cost_usd DESC`,
    sql`SELECT coalesce(dev_name, host_name, '(unnamed)') AS key, max(team) AS team FROM devices GROUP BY 1`,
    sql`
      SELECT a.user_email AS key, a.rate_limit_tier, a.organization_type, coalesce(e.cost_usd, 0)::float8 AS cost_usd
      FROM accounts a
      FULL JOIN (
        SELECT user_email, sum(cost_usd) AS cost_usd FROM events
        WHERE event_name = 'api_request' AND user_email IS NOT NULL AND ts >= now() - interval '90 days'
        GROUP BY 1
      ) e USING (user_email)
      ORDER BY cost_usd DESC`,
    sql`
      SELECT model AS key, coalesce(sum(cost_usd), 0)::float8 AS cost_usd FROM events
      WHERE event_name = 'api_request' AND model IS NOT NULL AND ts >= now() - interval '90 days'
      GROUP BY 1 ORDER BY cost_usd DESC`,
    sql`
      SELECT coalesce(entrypoint, 'unknown') AS key, count(*)::int AS n FROM events
      WHERE event_name = 'api_request' AND ts >= now() - interval '90 days'
      GROUP BY 1 ORDER BY n DESC`,
  ]);

  const personList = people.map((p) => ({ key: p.key as string, team: (p.team as string) ?? null }));
  for (const d of devices) {
    if (!personList.some((p) => p.key === d.key)) personList.push({ key: d.key as string, team: (d.team as string) ?? null });
  }
  const teams = [...new Set(personList.map((p) => p.team).filter((t): t is string => !!t))].sort();

  return json({
    people: personList,
    accounts: accounts.filter((a) => a.key).map((a) => ({ key: a.key as string })),
    teams: teams.map((t) => ({ key: t })),
    models: models.map((m) => ({ key: m.key as string, label: modelLabel(m.key as string) })),
    clients: clients.map((c) => ({ key: c.key as string })),
  });
}
