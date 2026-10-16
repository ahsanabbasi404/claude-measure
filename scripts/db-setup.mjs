// Applies db/schema.sql to DATABASE_URL. Run with: npm run db:setup
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local first.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");

try {
  await sql.unsafe(schema);
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('events', 'metric_points', 'limit_snapshots', 'devices', 'model_prices', 'accounts')
    ORDER BY table_name`;
  console.log("Schema applied. Tables:", tables.map((t) => t.table_name).join(", "));
} catch (err) {
  console.error("Schema setup failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
