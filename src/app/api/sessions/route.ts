import { json, pick, requestFilters } from "@/lib/api";
import { db } from "@/lib/db";
import { rangeInfo } from "@/lib/filters";
import { median, SESSION_SORTS, sessionsList } from "@/lib/queries";

/** Sessions in the selected range, sortable by value, recency, duration, peak context or requests. */
export async function GET(req: Request) {
  const { f, params } = requestFilters(req);
  const sort = pick(params.get("sort"), SESSION_SORTS, "cost");
  const limit = Math.min(500, Math.max(10, Number(params.get("limit")) || 200));
  const sessions = await sessionsList(db(), f, {}, sort, limit);
  return json({
    ...rangeInfo(f),
    generatedAt: new Date().toISOString(),
    sort,
    sessions,
    summary: {
      count: sessions.length,
      median_cost: median(sessions.map((s) => s.cost_usd)),
      median_duration_s: median(sessions.map((s) => s.duration_s)),
      median_peak_context: median(sessions.map((s) => s.peak_context ?? 0)),
    },
  });
}
