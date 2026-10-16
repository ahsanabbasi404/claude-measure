import { db } from "./db";

/*
 * Brute-force protection for the dashboard login. State lives in Postgres because serverless
 * instances do not share memory.
 */

const WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_IP = 5;
// Caps attempts spread across many addresses (distributed guessing).
const MAX_FAILURES_GLOBAL = 50;
export const FAILURE_DELAY_MS = 800;
export const MIN_PASSWORD_LENGTH = 12;

/** Client address as reported by Vercel's edge; falls back to the first forwarded hop. */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

export type LimitStatus =
  | { blocked: false; remaining: number }
  | { blocked: true; retryAfterSeconds: number; scope: "ip" | "global" };

export async function checkLoginLimit(ip: string): Promise<LimitStatus> {
  const sql = db();
  const [row] = await sql<{ ip_failures: number; ip_oldest: Date | null; global_failures: number; global_oldest: Date | null }[]>`
    SELECT
      count(*) FILTER (WHERE ip = ${ip})::int AS ip_failures,
      min(ts) FILTER (WHERE ip = ${ip}) AS ip_oldest,
      count(*)::int AS global_failures,
      min(ts) AS global_oldest
    FROM login_attempts
    WHERE success = false AND ts > now() - make_interval(mins => ${WINDOW_MINUTES})`;

  const retryAfter = (oldest: Date | null) =>
    Math.max(1, Math.ceil(((oldest ? new Date(oldest).getTime() : Date.now()) + WINDOW_MINUTES * 60_000 - Date.now()) / 1000));

  if (row.ip_failures >= MAX_FAILURES_PER_IP) {
    return { blocked: true, retryAfterSeconds: retryAfter(row.ip_oldest), scope: "ip" };
  }
  if (row.global_failures >= MAX_FAILURES_GLOBAL) {
    return { blocked: true, retryAfterSeconds: retryAfter(row.global_oldest), scope: "global" };
  }
  return { blocked: false, remaining: MAX_FAILURES_PER_IP - row.ip_failures };
}

export async function recordLoginAttempt(ip: string, success: boolean) {
  const sql = db();
  await sql`INSERT INTO login_attempts (ip, success) VALUES (${ip}, ${success})`;
  // A successful login clears that address's failure history.
  if (success) await sql`DELETE FROM login_attempts WHERE ip = ${ip} AND success = false`;
}
