import { allTime, decodeParam, json, requestFilters } from "@/lib/api";
import { db } from "@/lib/db";
import { CONTEXT_SQL, USAGE_KIND_SQL } from "@/lib/filters";
import { breakdowns, errorGroups, loadPrices, loadRequestRows, num, sessionsList } from "@/lib/queries";
import { analyzeSession, BREAK_HINT, BREAK_LABEL, toolLoops } from "@/lib/session-analysis";

/**
 * One session: every request with its cost split and context size, cache breaks and their causes,
 * spikes, model segments, lessons, per-prompt cost, compactions, tools and errors.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/sessions/[id]">) {
  const id = decodeParam((await ctx.params).id);
  const { f } = requestFilters(req);
  const all = allTime(f);
  const sql = db();
  const o = { session: id };
  const context = sql.unsafe(CONTEXT_SQL);
  const kind = sql.unsafe(USAGE_KIND_SQL);

  const [summary, rows, prices, prompts, compactions, tools, mix, errors] = await Promise.all([
    sessionsList(sql, all, o, "cost", 1),
    loadRequestRows(sql, all, o),
    loadPrices(sql),
    sql`
      SELECT prompt_id,
        min(ts) AS ts, max(ts) AS last_ts,
        max((attrs->>'prompt_length')::int) FILTER (WHERE event_name = 'user_prompt') AS prompt_length,
        max(attrs->>'command_name') FILTER (WHERE event_name = 'user_prompt') AS command_name,
        count(*) FILTER (WHERE event_name = 'api_request')::int AS requests,
        coalesce(sum(cost_usd) FILTER (WHERE event_name = 'api_request'), 0)::float8 AS cost_usd,
        max(${context}) FILTER (WHERE event_name = 'api_request')::float8 AS peak_context,
        count(*) FILTER (WHERE event_name = 'tool_result')::int AS tool_calls,
        count(*) FILTER (WHERE event_name = 'tool_result' AND success = false)::int AS tool_failures,
        coalesce(array_remove(array_agg(DISTINCT tool_name) FILTER (WHERE event_name = 'tool_result'), NULL), '{}') AS tools,
        count(*) FILTER (WHERE event_name = 'api_request' AND ${kind} = 'subagent')::int AS subagent_requests
      FROM events
      WHERE session_id = ${id} AND prompt_id IS NOT NULL
        AND event_name IN ('user_prompt', 'api_request', 'tool_result')
      GROUP BY prompt_id
      ORDER BY ts`,
    sql`
      SELECT ts, attrs->>'trigger' AS trigger, (attrs->>'pre_tokens')::float8 AS pre_tokens,
        (attrs->>'post_tokens')::float8 AS post_tokens, error
      FROM events WHERE session_id = ${id} AND event_name = 'compaction' ORDER BY ts`,
    sql`
      SELECT ts, tool_name, success FROM events
      WHERE session_id = ${id} AND event_name = 'tool_result' ORDER BY ts LIMIT 20000`,
    breakdowns(sql, all, o),
    errorGroups(sql, all, o),
  ]);

  const compactionList = compactions.map((c) => ({
    ts: new Date(c.ts as Date).toISOString(), trigger: (c.trigger as string) ?? null,
    pre_tokens: c.pre_tokens === null ? null : num(c.pre_tokens), post_tokens: c.post_tokens === null ? null : num(c.post_tokens),
    error: (c.error as string) ?? null,
  }));
  const loops = toolLoops(tools.map((t) => ({ ts: new Date(t.ts as Date).toISOString(), tool: (t.tool_name as string) ?? "unknown", success: t.success as boolean | null })));
  const analysis = analyzeSession(rows, prices, { compactions: compactionList, toolLoops: loops });

  return json({
    generatedAt: new Date().toISOString(),
    session: summary[0] ?? null,
    ...analysis,
    breakLabels: BREAK_LABEL,
    breakHints: BREAK_HINT,
    prompts: prompts.map((p) => ({
      ...p, ts: new Date(p.ts as Date).toISOString(), last_ts: new Date(p.last_ts as Date).toISOString(),
      cost_usd: num(p.cost_usd), peak_context: p.peak_context === null ? null : num(p.peak_context),
    })),
    compactions: compactionList,
    ...mix,
    errors,
  });
}
