import { db } from "@/lib/db";
import { loadAgent, publicOrigin, SETTINGS_VERSION } from "@/lib/client-files";

/** Installed devices with health status, plus the install commands for the Setup page. */
export async function GET(req: Request) {
  const sql = db();
  const [devices, posix, windows] = await Promise.all([
    sql`
      SELECT d.*,
        e.last_event_at, e.last_email, e.app_version
      FROM devices d
      LEFT JOIN LATERAL (
        SELECT max(ts) AS last_event_at,
          (array_agg(user_email ORDER BY ts DESC) FILTER (WHERE user_email IS NOT NULL))[1] AS last_email,
          (array_agg(app_version ORDER BY ts DESC) FILTER (WHERE app_version IS NOT NULL))[1] AS app_version
        FROM events
        WHERE device_id = d.device_id AND event_name NOT LIKE 'ccm.%' AND ts > now() - interval '30 days'
      ) e ON true
      ORDER BY d.last_heartbeat DESC`,
    loadAgent("posix"),
    loadAgent("windows"),
  ]);

  const now = Date.now();
  const rows = devices.map((d) => {
    const hb = new Date(d.last_heartbeat as Date).getTime();
    const ev = d.last_event_at ? new Date(d.last_event_at as Date).getTime() : null;
    const check = d.last_check as { fail?: number; warn?: number; items?: { status: string; title: string; detail: string; fix: string }[] } | null;
    const latestAgent = d.os_type === "Windows" ? windows.version : posix.version;
    let status: "healthy" | "no-telemetry" | "doctor-failed" | "offline" | "outdated";
    if (check?.fail) status = "doctor-failed";
    else if (now - hb > 7 * 86400_000) status = "offline";
    else if (!ev || (hb - ev > 2 * 86400_000)) status = "no-telemetry";
    else if ((d.settings_version as number) < SETTINGS_VERSION) status = "outdated";
    else status = "healthy";
    return {
      ...d,
      status,
      agent_current: (d.agent_version as number) >= latestAgent,
      latest_agent_version: latestAgent,
      problems: (check?.items ?? []).filter((i) => i.status !== "ok"),
    };
  });

  const origin = publicOrigin(req);
  const token = process.env.INGEST_TOKEN ?? "";
  return Response.json(
    {
      devices: rows,
      install: {
        origin,
        posix: `curl -fsSL ${origin}/install.sh | sudo bash -s -- --token ${token}`,
        windows: `powershell -ExecutionPolicy Bypass -c "& ([scriptblock]::Create((irm '${origin}/install.ps1'))) -Token ${token}"`,
        agent: { posix: posix.version, windows: windows.version },
        settingsVersion: SETTINGS_VERSION,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
