import postgres from "postgres";

declare global {
  var __ccmSql: postgres.Sql | undefined;
}

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, {
    // Poolers such as Neon's "-pooler" endpoint (PgBouncer, transaction mode) do not support prepared statements.
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
}

/** Lazily created client, reused across hot reloads and warm serverless invocations. */
export function db(): postgres.Sql {
  globalThis.__ccmSql ??= createClient();
  return globalThis.__ccmSql;
}
