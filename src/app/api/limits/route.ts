import { isValidIngestRequest } from "@/lib/auth";
import { insertRows } from "@/lib/ingest";
import { parseResourceAttributes } from "@/lib/otlp";
import { upsertAccount } from "@/lib/accounts";

type Window = { used_percentage?: number; resets_at?: number };
type StatusLineInput = {
  session_id?: string;
  version?: string;
  model?: { id?: string; display_name?: string };
  cost?: { total_cost_usd?: number };
  context_window?: { used_percentage?: number | null };
  rate_limits?: { five_hour?: Window; seven_day?: Window };
};

const pct = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const epoch = (v: unknown) => (typeof v === "number" && v > 0 ? new Date(v * 1000) : null);

/**
 * Receives the JSON that Claude Code passes to the status line command, forwarded unchanged
 * by the client script. Only rate-limit, context and cost fields are kept.
 */
export async function POST(req: Request) {
  if (!isValidIngestRequest(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let input: StatusLineInput;
  try {
    input = (await req.json()) as StatusLineInput;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const resource = parseResourceAttributes(req.headers.get("x-ccm-attrs"));
  const rl = input.rate_limits ?? {};
  const email = req.headers.get("x-ccm-email")?.trim().toLowerCase() || null;
  const deviceId = req.headers.get("x-ccm-device") || null;
  const row = {
    session_id: input.session_id ?? null,
    device_id: deviceId,
    user_email: email,
    dev_name: (resource["dev.name"] as string) ?? null,
    team: (resource["team"] as string) ?? null,
    host_name: req.headers.get("x-ccm-host") || null,
    os_type: req.headers.get("x-ccm-os") || null,
    model: input.model?.id ?? input.model?.display_name ?? null,
    app_version: input.version ?? null,
    five_hour_pct: pct(rl.five_hour?.used_percentage),
    five_hour_resets_at: epoch(rl.five_hour?.resets_at),
    seven_day_pct: pct(rl.seven_day?.used_percentage),
    seven_day_resets_at: epoch(rl.seven_day?.resets_at),
    context_pct: pct(input.context_window?.used_percentage),
    session_cost_usd: pct(input.cost?.total_cost_usd),
    raw: { rate_limits: input.rate_limits ?? null, resource },
  };

  try {
    await insertRows("limit_snapshots", [row], ["raw"]);
    if (email) {
      await upsertAccount(
        { email, rate_limit_tier: req.headers.get("x-ccm-tier") },
        deviceId,
        row.dev_name,
      );
    }
  } catch (err) {
    console.error("[limits] insert failed", err);
    return Response.json({ error: "storage unavailable" }, { status: 503 });
  }
  return Response.json({ ok: true });
}
