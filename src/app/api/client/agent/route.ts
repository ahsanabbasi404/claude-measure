import { isValidIngestRequest } from "@/lib/auth";
import { loadAgent, parsePlatform } from "@/lib/client-files";

/** Latest agent script for self-update. Version and SHA-256 travel in headers for verification. */
export async function GET(req: Request) {
  if (!isValidIngestRequest(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const platform = parsePlatform(new URL(req.url).searchParams.get("platform"));
  if (!platform) return Response.json({ error: "platform must be posix or windows" }, { status: 400 });
  const agent = await loadAgent(platform);
  return new Response(agent.source, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-CCM-Agent-Version": String(agent.version),
      "X-CCM-SHA256": agent.sha256,
    },
  });
}
