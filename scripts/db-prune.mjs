// Removes stored telemetry that the storage policy no longer keeps, and frees the space for reuse.
//   npm run db:prune            report what would be removed (no changes)
//   npm run db:prune:apply      remove it (same as passing --yes)
// Deleted rows are gone for good. Everything the dashboard reads is kept.
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { DROPPED_EVENTS, REDUNDANT_ATTRS, STORED_METRICS } from "../src/lib/storage-policy.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local first.");
  process.exit(1);
}
const apply = process.argv.includes("--yes");
const BATCH = 20_000;
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

// Secondary indexes dropped first when the database is full: VACUUM itself needs a little free space
// to record reusable pages. db/schema.sql recreates them at the end (smaller, after the prune).
const SECONDARY_INDEXES = ["events_device_ts_idx", "events_email_ts_idx", "events_dev_ts_idx", "metric_points_email_idx", "metric_points_dev_ts_idx"];

async function recreateIndexes() {
  const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
  await sql.unsafe(schema);
}

const mb = (bytes) => `${(Number(bytes) / 1024 / 1024).toFixed(0)} MB`;
const droppedEvents = sql`(
  event_name = ANY(${DROPPED_EVENTS})
  OR (event_name = 'tool_decision' AND coalesce(attrs->>'decision', '') <> 'reject')
  OR (event_name = 'mcp_server_connection' AND coalesce(attrs->>'status', '') <> 'failed'))`;
const droppedMetrics = sql`NOT (metric_name = ANY(${STORED_METRICS}))`;
const redundant = sql`attrs ?| ${REDUNDANT_ATTRS}::text[]`;

async function sizes() {
  const [r] = await sql`
    SELECT pg_database_size(current_database()) AS db,
      pg_total_relation_size('events') AS events, pg_total_relation_size('metric_points') AS metrics`;
  return r;
}

/** Deletes (or rewrites) matching rows in id batches so each transaction stays small. */
async function inBatches(label, table, where, action) {
  const [{ lo, hi }] = await sql`SELECT min(id) AS lo, max(id) AS hi FROM ${sql(table)} WHERE ${where}`;
  if (lo === null) return 0;
  let done = 0;
  for (let start = BigInt(lo); start <= BigInt(hi); start += BigInt(BATCH)) {
    const end = start + BigInt(BATCH);
    const res = await action(sql`id >= ${String(start)} AND id < ${String(end)} AND ${where}`);
    done += res.count;
    process.stdout.write(`\r  ${label}: ${done.toLocaleString()} rows`);
    // Plain VACUUM marks the space reusable without needing free space itself.
    if (res.count > 0) await sql.unsafe(`VACUUM ${table}`);
  }
  process.stdout.write("\n");
  return done;
}

try {
  const before = await sizes();
  console.log(`Database ${mb(before.db)} (events ${mb(before.events)}, metric_points ${mb(before.metrics)})\n`);

  const [ev] = await sql`
    SELECT count(*)::int AS n, coalesce(sum(pg_column_size(e.*)), 0)::bigint AS bytes FROM events e WHERE ${droppedEvents}`;
  const [mp] = await sql`
    SELECT count(*)::int AS n, coalesce(sum(pg_column_size(m.*)), 0)::bigint AS bytes FROM metric_points m WHERE ${droppedMetrics}`;
  const [slim] = await sql`
    SELECT count(*)::int AS n,
      coalesce(sum(pg_column_size(attrs) - pg_column_size(attrs - ${REDUNDANT_ATTRS}::text[])), 0)::bigint AS bytes
    FROM events WHERE NOT ${droppedEvents} AND ${redundant}`;

  console.log("Unused events (hooks, plugins, responses, accepted tool decisions, MCP connects):");
  console.log(`  ${ev.n.toLocaleString()} rows, about ${mb(ev.bytes)}`);
  console.log("Unused metrics (token and cost counters, duplicated by request events):");
  console.log(`  ${mp.n.toLocaleString()} rows, about ${mb(mp.bytes)}`);
  console.log("Duplicate attributes in kept events (already stored as columns):");
  console.log(`  ${slim.n.toLocaleString()} rows, about ${mb(slim.bytes)}`);

  if (!apply) {
    console.log("\nNothing changed. Run \"npm run db:prune:apply\" to remove the rows above. They cannot be recovered.");
  } else {
    console.log("\nMaking room: dropping secondary indexes (rebuilt at the end)...");
    for (const index of SECONDARY_INDEXES) await sql.unsafe(`DROP INDEX IF EXISTS ${index}`);
    console.log("Removing...");
    await inBatches("events deleted", "events", droppedEvents, (w) => sql`DELETE FROM events WHERE ${w}`);
    await inBatches("metric points deleted", "metric_points", droppedMetrics, (w) => sql`DELETE FROM metric_points WHERE ${w}`);
    await inBatches("events slimmed", "events", redundant,
      (w) => sql`UPDATE events SET attrs = attrs - ${REDUNDANT_ATTRS}::text[] WHERE ${w}`);
    await inBatches("metric points slimmed", "metric_points", redundant,
      (w) => sql`UPDATE metric_points SET attrs = attrs - ${REDUNDANT_ATTRS}::text[] WHERE ${w}`);
    await sql.unsafe("VACUUM ANALYZE events");
    await sql.unsafe("VACUUM ANALYZE metric_points");
    console.log("Rebuilding indexes...");
    await recreateIndexes();
    const after = await sizes();
    const [live] = await sql`
      SELECT coalesce(sum(pg_column_size(e.*)), 0)::bigint AS events FROM events e`;
    console.log(`\nDone. Live event data is now about ${mb(live.events)}.`);
    console.log(`Files: database ${mb(after.db)}. Freed space inside the tables is reused by new telemetry,`);
    console.log("so the database file size changes little, but ingestion works again.");
  }
} catch (err) {
  console.error("\nPrune failed:", err.message);
  if (apply) {
    // Rows already removed stay removed; put the indexes back so the dashboard stays fast.
    try {
      await recreateIndexes();
      console.error("Indexes restored. Rows removed so far stay removed; run the command again to continue.");
    } catch (e) {
      console.error(`Indexes could not be rebuilt yet (${e.message}). Run "npm run db:setup" once space is free.`);
    }
  }
  process.exitCode = 1;
} finally {
  await sql.end();
}
