import { SETTINGS_VERSION, type Platform } from "./client-files";

type Input = {
  platform: Platform;
  origin: string;
  token: string;
  installDir: string;
  deviceId: string;
  devName: string;
  team: string;
  hostName: string;
};

/** OTEL_RESOURCE_ATTRIBUTES values cannot contain spaces, commas or quotes, so they are percent-encoded. */
const enc = (v: string) => encodeURIComponent(v.trim());

function agentCommand(platform: Platform, installDir: string, sub: string): string {
  if (platform === "windows") {
    // Forward slashes work in both Git Bash and PowerShell, which Claude Code uses on Windows.
    const script = `${installDir.replace(/\\/g, "/").replace(/\/$/, "")}/ccm.ps1`;
    return `powershell -NoProfile -ExecutionPolicy Bypass -File "${script}" ${sub}`;
  }
  return `bash "${installDir.replace(/\/$/, "")}/ccm.sh" ${sub}`;
}

/** Claude Code managed settings written by the installer. */
export function buildClaudeSettings(i: Input) {
  const resource = [
    `dev.name=${enc(i.devName)}`,
    i.team ? `team=${enc(i.team)}` : null,
    i.hostName ? `host.name=${enc(i.hostName)}` : null,
    `ccm.device=${enc(i.deviceId)}`,
  ]
    .filter(Boolean)
    .join(",");

  return {
    env: {
      CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      OTEL_METRICS_EXPORTER: "otlp",
      OTEL_LOGS_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
      OTEL_EXPORTER_OTLP_ENDPOINT: i.origin,
      OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${i.token}`,
      OTEL_METRIC_EXPORT_INTERVAL: "30000",
      OTEL_LOGS_EXPORT_INTERVAL: "5000",
      OTEL_METRICS_INCLUDE_ENTRYPOINT: "true",
      OTEL_METRICS_INCLUDE_VERSION: "true",
      OTEL_RESOURCE_ATTRIBUTES: resource,
      CCM_SETTINGS_VERSION: String(SETTINGS_VERSION),
    },
    statusLine: {
      type: "command",
      command: agentCommand(i.platform, i.installDir, "statusline"),
      padding: 0,
    },
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: agentCommand(i.platform, i.installDir, "hook"), timeout: 15 }] },
      ],
    },
  };
}
