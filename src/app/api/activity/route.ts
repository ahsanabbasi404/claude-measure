import { json, requestFilters } from "@/lib/api";
import { db } from "@/lib/db";
import { rangeInfo } from "@/lib/filters";
import { errorGroups, feed, liveNow } from "@/lib/queries";

/** Live feed of notable events, grouped errors, and who is active right now. */
export async function GET(req: Request) {
  const { f } = requestFilters(req);
  const sql = db();
  const [events, errors, live] = await Promise.all([feed(sql, f, {}, 200), errorGroups(sql, f), liveNow(sql, f)]);
  return json({ ...rangeInfo(f), generatedAt: new Date().toISOString(), feed: events, errors, live });
}
