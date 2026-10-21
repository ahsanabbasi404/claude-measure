import { json, requestFilters } from "@/lib/api";
import { db } from "@/lib/db";
import { rangeInfo } from "@/lib/filters";
import { buildAccounts, buildPeople } from "@/lib/queries";

/** Everyone in the selected range with usage, efficiency, limits and a daily trend. */
export async function GET(req: Request) {
  const { f } = requestFilters(req);
  const sql = db();
  const { people, base } = await buildPeople(sql, f, buildAccounts(sql, f));
  return json({ ...rangeInfo(f), generatedAt: new Date().toISOString(), people, baseline: base });
}
