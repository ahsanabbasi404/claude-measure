import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

/*
 * Files under client/ are served to developer machines. They are bundled with the deployment via
 * outputFileTracingIncludes in next.config.ts. The agent version is read from the script itself so
 * bumping CCM_AGENT_VERSION in a script is the only step needed to roll out an update.
 */

export type Platform = "posix" | "windows";

/** Bump when the generated Claude Code settings change; devices on older settings get a notice. */
export const SETTINGS_VERSION = 1;

// The bundler skips tracing these paths; outputFileTracingIncludes in next.config.ts ships the files.
export const CLIENT_FILES = {
  agentPosix: path.join(/*turbopackIgnore: true*/ process.cwd(), "client", "agent", "ccm.sh"),
  agentWindows: path.join(/*turbopackIgnore: true*/ process.cwd(), "client", "agent", "ccm.ps1"),
  installPosix: path.join(/*turbopackIgnore: true*/ process.cwd(), "client", "install.sh"),
  installWindows: path.join(/*turbopackIgnore: true*/ process.cwd(), "client", "install.ps1"),
} as const;
export type ClientFile = keyof typeof CLIENT_FILES;

const AGENT_FILES: Record<Platform, ClientFile> = {
  posix: "agentPosix",
  windows: "agentWindows",
};

const VERSION_PATTERNS: Record<Platform, RegExp> = {
  posix: /^CCM_AGENT_VERSION=(\d+)$/m,
  windows: /^\$CCM_AGENT_VERSION = (\d+)$/m,
};

export async function readClientFile(file: ClientFile): Promise<string> {
  return readFile(CLIENT_FILES[file], "utf8");
}

export async function loadAgent(platform: Platform) {
  const raw = await readClientFile(AGENT_FILES[platform]);
  // Normalize line endings: bash cannot run CRLF scripts; PowerShell accepts LF.
  const source = raw.replace(/\r\n/g, "\n");
  const match = VERSION_PATTERNS[platform].exec(source);
  const version = match ? Number(match[1]) : 0;
  const sha256 = createHash("sha256").update(source, "utf8").digest("hex");
  return { source, version, sha256 };
}

export function parsePlatform(value: string | null): Platform | null {
  return value === "posix" || value === "windows" ? value : null;
}

/** Origin of the deployment as seen by the client (respects Vercel's forwarded headers). */
export function publicOrigin(req: Request): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) return `${proto.split(",")[0]}://${forwardedHost.split(",")[0]}`;
  return new URL(req.url).origin;
}
