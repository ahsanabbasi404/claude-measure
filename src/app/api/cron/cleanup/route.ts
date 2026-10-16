import { db } from "@/lib/db";
import { syncModelPrices } from "@/lib/pricing";

/** Daily maintenance (see vercel.json): refresh fallback model prices, apply RETENTION_DAYS. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let prices: number | string;
  try {
    prices = await syncModelPrices();
  } catch (err) {
    prices = `failed: ${(err as Error).message}`;
  }

  await db()`DELETE FROM login_attempts WHERE ts < now() - interval '1 day'`;

  const days = Number(process.env.RETENTION_DAYS);
  if (!Number.isInteger(days) || days <= 0) {
    return Response.json({ prices, retention: "RETENTION_DAYS not set" });
  }
  const sql = db();
  const cutoff = sql`now() - make_interval(days => ${days})`;
  const events = await sql`DELETE FROM events WHERE ts < ${cutoff}`;
  const metrics = await sql`DELETE FROM metric_points WHERE ts < ${cutoff}`;
  const limits = await sql`DELETE FROM limit_snapshots WHERE ts < ${cutoff}`;
  return Response.json({
    prices,
    deleted: { events: events.count, metric_points: metrics.count, limit_snapshots: limits.count },
  });
}
