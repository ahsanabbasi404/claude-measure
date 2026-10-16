import { isValidIngestRequest } from "@/lib/auth";
import { parsePlatform, publicOrigin, SETTINGS_VERSION } from "@/lib/client-files";
import { buildClaudeSettings } from "@/lib/client-settings";

/** Generates the Claude Code managed settings for one device. Called by the installers. */
export async function GET(req: Request) {
  if (!isValidIngestRequest(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const platform = parsePlatform(q.get("platform"));
  const installDir = q.get("install_dir") ?? "";
  const deviceId = q.get("device_id") ?? "";
  const devName = (q.get("dev_name") ?? "").trim();
  if (!platform || !installDir || !deviceId || !devName) {
    return Response.json(
      { error: "platform, install_dir, device_id and dev_name are required" },
      { status: 400 },
    );
  }
  const settings = buildClaudeSettings({
    platform,
    origin: publicOrigin(req),
    token: process.env.INGEST_TOKEN!,
    installDir,
    deviceId,
    devName,
    team: (q.get("team") ?? "").trim(),
    hostName: (q.get("host_name") ?? "").trim(),
  });
  return new Response(JSON.stringify(settings, null, 2) + "\n", {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-CCM-Settings-Version": String(SETTINGS_VERSION),
    },
  });
}
