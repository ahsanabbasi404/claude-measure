import { db } from "./db";
import { isValidIngestRequest } from "./auth";
import { readOtlpJson, UnsupportedEncodingError } from "./otlp";

const CHUNK = 500;

/** Inserts rows in chunks; JSON columns are wrapped so postgres.js sends them as jsonb. */
export async function insertRows(
  table: "events" | "metric_points" | "limit_snapshots",
  rows: Record<string, unknown>[],
  jsonColumns: string[],
) {
  if (rows.length === 0) return;
  const sql = db();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => {
      const copy: Record<string, unknown> = { ...r };
      for (const c of jsonColumns) copy[c] = sql.json((r[c] ?? {}) as never);
      return copy;
    });
    await sql`INSERT INTO ${sql(table)} ${sql(chunk as never)}`;
  }
}

/** Shared POST handler for OTLP endpoints: auth, decode, parse, store. */
export async function handleOtlp(
  req: Request,
  parse: (payload: unknown) => Record<string, unknown>[] | Promise<Record<string, unknown>[]>,
  table: "events" | "metric_points",
) {
  if (!isValidIngestRequest(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = await readOtlpJson(req);
  } catch (err) {
    const status = err instanceof UnsupportedEncodingError ? 415 : 400;
    return Response.json({ error: (err as Error).message }, { status });
  }
  try {
    await insertRows(table, await parse(payload), ["attrs"]);
  } catch (err) {
    console.error(`[ingest] ${table} insert failed`, err);
    // 503 lets the OpenTelemetry exporter retry the batch.
    return Response.json({ error: "storage unavailable" }, { status: 503 });
  }
  // OTLP success response: an empty Export*ServiceResponse.
  return Response.json({});
}
