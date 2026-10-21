import { json, requestFilters } from "@/lib/api";
import { db } from "@/lib/db";
import { PERSON_SQL, rangeInfo, scope } from "@/lib/filters";
import { periodTotals, loadPrices, loadRequestRows, num } from "@/lib/queries";
import { buildReport } from "@/lib/report";
import { toolLoops } from "@/lib/session-analysis";

/** Period report: team summary, day-by-day totals, and lessons for the team and each person. */
export async function GET(req: Request) {
  const { f } = requestFilters(req);
  const sql = db();
  const person = sql.unsafe(PERSON_SQL);
  const [rows, prices, compactions, tools, prompts, teams, previous] = await Promise.all([
    loadRequestRows(sql, f),
    loadPrices(sql),
    sql`
      SELECT session_id, ts, attrs->>'trigger' AS trigger, (attrs->>'pre_tokens')::float8 AS pre_tokens
      FROM events WHERE ${scope(sql, f)} AND event_name = 'compaction' AND session_id IS NOT NULL ORDER BY ts`,
    sql`
      SELECT session_id, ts, tool_name, success FROM events
      WHERE ${scope(sql, f)} AND event_name = 'tool_result' AND session_id IS NOT NULL
      ORDER BY session_id, ts LIMIT 200000`,
    sql`
      SELECT session_id, count(*)::int AS n FROM events
      WHERE ${scope(sql, f)} AND event_name = 'user_prompt' AND session_id IS NOT NULL GROUP BY 1`,
    sql`SELECT ${person} AS dev, max(team) AS team FROM events WHERE ${scope(sql, f)} AND event_name = 'api_request' GROUP BY 1`,
    periodTotals(sql, f),
  ]);

  const compactionsBy = new Map<string, { ts: string; trigger: string | null; pre_tokens: number | null }[]>();
  for (const c of compactions) {
    const list = compactionsBy.get(c.session_id as string) ?? [];
    list.push({ ts: new Date(c.ts as Date).toISOString(), trigger: (c.trigger as string) ?? null, pre_tokens: c.pre_tokens === null ? null : num(c.pre_tokens) });
    compactionsBy.set(c.session_id as string, list);
  }
  const toolsBy = new Map<string, { ts: string; tool: string; success: boolean | null }[]>();
  for (const t of tools) {
    const list = toolsBy.get(t.session_id as string) ?? [];
    list.push({ ts: new Date(t.ts as Date).toISOString(), tool: (t.tool_name as string) ?? "unknown", success: t.success as boolean | null });
    toolsBy.set(t.session_id as string, list);
  }
  const loops = new Map([...toolsBy].map(([id, list]) => [id, toolLoops(list)]));

  const report = buildReport(
    rows, prices,
    { compactions: compactionsBy, loops, prompts: new Map(prompts.map((p) => [p.session_id as string, num(p.n)])) },
    f.tz,
    new Map(teams.map((t) => [t.dev as string, (t.team as string) ?? null])),
  );
  return json({ ...rangeInfo(f), generatedAt: new Date().toISOString(), previous, ...report });
}
