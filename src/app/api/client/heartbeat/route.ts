import { isValidIngestRequest } from "@/lib/auth";
import { loadAgent, SETTINGS_VERSION } from "@/lib/client-files";
import { db } from "@/lib/db";
import { upsertAccount, type AccountInfo } from "@/lib/accounts";

type Heartbeat = {
  device_id?: string;
  dev_name?: string;
  team?: string;
  host_name?: string;
  os_type?: string;
  os_version?: string;
  agent_version?: number;
  settings_version?: number;
  account?: AccountInfo | null;
  check?: unknown;
};

/** Device registration and liveness. Sent at every session start and after each doctor run. */
export async function POST(req: Request) {
  if (!isValidIngestRequest(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const hb = (await req.json().catch(() => null)) as Heartbeat | null;
  if (!hb?.device_id) return Response.json({ error: "device_id is required" }, { status: 400 });

  const sql = db();
  const check = hb.check && typeof hb.check === "object" ? sql.json(hb.check as never) : null;
  await sql`
    INSERT INTO devices (device_id, dev_name, team, host_name, os_type, os_version, agent_version,
      settings_version, last_heartbeat, last_check, last_check_at)
    VALUES (${hb.device_id}, ${hb.dev_name ?? null}, ${hb.team ?? null}, ${hb.host_name ?? null},
      ${hb.os_type ?? null}, ${hb.os_version ?? null}, ${hb.agent_version ?? null},
      ${hb.settings_version ?? null}, now(), ${check}, ${check ? sql`now()` : null})
    ON CONFLICT (device_id) DO UPDATE SET
      dev_name = EXCLUDED.dev_name, team = EXCLUDED.team, host_name = EXCLUDED.host_name,
      os_type = EXCLUDED.os_type, os_version = EXCLUDED.os_version,
      agent_version = EXCLUDED.agent_version, settings_version = EXCLUDED.settings_version,
      last_heartbeat = now(),
      last_check = coalesce(EXCLUDED.last_check, devices.last_check),
      last_check_at = coalesce(EXCLUDED.last_check_at, devices.last_check_at)`;

  if (hb.account?.email) await upsertAccount(hb.account, hb.device_id, hb.dev_name ?? null);

  const platform = hb.os_type === "Windows" ? "windows" : "posix";
  const agent = await loadAgent(platform);
  const settingsOutdated = (hb.settings_version ?? 0) < SETTINGS_VERSION;
  return Response.json({
    latest_agent_version: agent.version,
    latest_settings_version: SETTINGS_VERSION,
    notice: settingsOutdated ? "usage monitor: re-run installer" : null,
  });
}
