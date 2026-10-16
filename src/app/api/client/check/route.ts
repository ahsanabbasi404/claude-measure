import { isValidIngestRequest } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Used by `ccm doctor`: confirms the token, optionally confirms that a test event carrying `nonce`
 * was stored, and reports the latest real Claude Code event received from the device.
 */
export async function POST(req: Request) {
  if (!isValidIngestRequest(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { device_id?: string; nonce?: string };
  const sql = db();

  let nonceFound: boolean | null = null;
  if (body.nonce) {
    const [row] = await sql`
      SELECT 1 FROM events
      WHERE event_name = 'ccm.install_check' AND attrs->>'ccm.nonce' = ${body.nonce}
        AND ts > now() - interval '1 hour'
      LIMIT 1`;
    nonceFound = !!row;
  }

  let last: { ts: Date; event_name: string } | undefined;
  if (body.device_id) {
    [last] = await sql<{ ts: Date; event_name: string }[]>`
      SELECT ts, event_name FROM events
      WHERE device_id = ${body.device_id} AND event_name NOT LIKE 'ccm.%'
      ORDER BY ts DESC LIMIT 1`;
  }

  return Response.json({
    ok: true,
    server_time: new Date(),
    nonce_found: nonceFound,
    last_event_at: last?.ts ?? null,
    last_event_name: last?.event_name ?? null,
  });
}
