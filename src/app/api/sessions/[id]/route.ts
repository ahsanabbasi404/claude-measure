import { allTime, decodeParam, json, requestFilters } from "@/lib/api";
import { modelLabel } from "@/lib/analytics";
import { db } from "@/lib/db";
import { CONTEXT_SQL, USAGE_KIND_SQL } from "@/lib/filters";
import { breakdowns, errorGroups, num, sessionsList } from "@/lib/queries";

/** One session: every request with its context size, per-prompt cost, compactions, tools and errors. */
export async function GET(req: Request, ctx: RouteContext<"/api/sessions/[id]">) {
  const id = decodeParam((await ctx.params).id);
  const { f } = requestFilters(req);
  const all = allTime(f);
  const sql = db();
  const o = { session: id };
  const context = sql.unsafe(CONTEXT_SQL);
  const kind = sql.unsafe(USAGE_KIND_SQL);

  const [summary, requests, prompts, compactions, mix, errors] = await Promise.all([
    sessionsList(sql, all, o, "cost", 1),
    sql`
      SELECT ts, model, ${kind} AS kind, (${context})::float8 AS context, coalesce(output_tokens, 0)::float8 AS output_tokens,
        coalesce(cost_usd, 0)::float8 AS cost_usd, duration_ms, attrs->>'effort' AS effort, attrs->>'agent.name' AS agent, prompt_id
      FROM events WHERE session_id = ${id} AND event_name = 'api_request'
      ORDER BY ts LIMIT 5000`,
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
    breakdowns(sql, all, o),
    errorGroups(sql, all, o),
  ]);

  let cumulative = 0;
  return json({
    generatedAt: new Date().toISOString(),
    session: summary[0] ?? null,
    requests: requests.map((r) => {
      cumulative += num(r.cost_usd);
      return {
        ts: new Date(r.ts as Date).toISOString(), model: r.model ? modelLabel(r.model as string) : null, kind: r.kind,
        context: num(r.context), output_tokens: num(r.output_tokens), cost_usd: num(r.cost_usd), cumulative_cost: cumulative,
        duration_ms: num(r.duration_ms), effort: r.effort, agent: r.agent, prompt_id: r.prompt_id,
      };
    }),
    prompts: prompts.map((p) => ({
      ...p, ts: new Date(p.ts as Date).toISOString(), last_ts: new Date(p.last_ts as Date).toISOString(),
      cost_usd: num(p.cost_usd), peak_context: p.peak_context === null ? null : num(p.peak_context),
    })),
    compactions: compactions.map((c) => ({ ...c, ts: new Date(c.ts as Date).toISOString() })),
    ...mix,
    errors,
  });
}
