import { json, requestFilters } from "@/lib/api";
import { db } from "@/lib/db";
import { rangeInfo } from "@/lib/filters";
import { buildAccounts, series } from "@/lib/queries";

/** Every Claude account: plan, limits, real-time burn, and who used it in the selected range. */
export async function GET(req: Request) {
  const { f } = requestFilters(req);
  const sql = db();
  const [accounts, timeline] = await Promise.all([buildAccounts(sql, f), series(sql, f, "account")]);
  return json({ ...rangeInfo(f), generatedAt: new Date().toISOString(), accounts, series: timeline });
}
