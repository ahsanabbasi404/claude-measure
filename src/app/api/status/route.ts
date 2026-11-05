import { json } from "@/lib/api";
import { db } from "@/lib/db";

// No events for this long while devices keep checking in means ingestion is failing.
const STALL_MS = 2 * 3600_000;

/** Ingestion health for the dashboard banner: is telemetry still being stored, and how big is the database. */
export async function GET() {
  const sql = db();
  const [[events], [devices], [size]] = await Promise.all([
    sql`SELECT max(ts) AS last_event FROM events WHERE event_name NOT LIKE 'ccm.%'`,
    sql`SELECT count(*)::int AS recent FROM devices WHERE last_heartbeat > now() - interval '2 hours'`,
    sql`SELECT pg_database_size(current_database())::float8 AS bytes`,
  ]);
  const lastEvent = events.last_event ? new Date(events.last_event as Date) : null;
  const stalled = (devices.recent as number) > 0 && (!lastEvent || Date.now() - lastEvent.getTime() > STALL_MS);
  const limitMb = Number(process.env.DATABASE_SIZE_LIMIT_MB) || null;
  const bytes = size.bytes as number;
  return json({
    last_event_at: lastEvent?.toISOString() ?? null,
    devices_checking_in: devices.recent,
    ingest_stalled: stalled,
    database_bytes: bytes,
    database_limit_bytes: limitMb ? limitMb * 1024 * 1024 : null,
    database_nearly_full: limitMb ? bytes > 0.85 * limitMb * 1024 * 1024 : false,
  });
}
