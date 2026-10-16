import { db } from "@/lib/db";
import { MIN_PASSWORD_LENGTH } from "@/lib/login-limit";

/** Reports which server settings are present and whether the database is reachable. */
export async function GET() {
  const env = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    INGEST_TOKEN: !!process.env.INGEST_TOKEN,
    DASHBOARD_PASSWORD: !!process.env.DASHBOARD_PASSWORD,
    AUTH_SECRET: !!process.env.AUTH_SECRET,
  };
  let database: "ok" | "unreachable" | "schema missing" | "not configured" = "not configured";
  if (env.DATABASE_URL) {
    try {
      const [row] = await db()`SELECT to_regclass('public.events') IS NOT NULL AS ready`;
      database = row.ready ? "ok" : "schema missing";
    } catch (err) {
      console.error("[health] database check failed", err);
      database = "unreachable";
    }
  }
  const ok = Object.values(env).every(Boolean) && database === "ok";
  // Reported separately: a short password disables dashboard login but not telemetry ingestion.
  const passwordStrongEnough = (process.env.DASHBOARD_PASSWORD ?? "").length >= MIN_PASSWORD_LENGTH;
  return Response.json({ ok, env, database, passwordStrongEnough }, { status: ok ? 200 : 503 });
}
