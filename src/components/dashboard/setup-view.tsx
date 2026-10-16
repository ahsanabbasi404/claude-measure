"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ago } from "@/lib/format";
import { REFRESH_MS, useNow } from "./hooks";
import { Shell } from "./shell";
import { CheckIcon, Empty, Panel, Pill, SeverityIcon, Skeleton } from "./ui";

type Device = {
  device_id: string;
  dev_name: string | null;
  team: string | null;
  host_name: string | null;
  os_type: string | null;
  os_version: string | null;
  agent_version: number | null;
  settings_version: number | null;
  first_seen: string;
  last_heartbeat: string;
  last_check_at: string | null;
  last_event_at: string | null;
  last_email: string | null;
  app_version: string | null;
  status: "healthy" | "no-telemetry" | "doctor-failed" | "offline" | "outdated";
  agent_current: boolean;
  latest_agent_version: number;
  problems: { status: string; title: string; detail: string; fix: string }[];
};

type DevicesResponse = {
  devices: Device[];
  install: { origin: string; posix: string; windows: string; agent: { posix: number; windows: number }; settingsVersion: number };
};

const STATUS: Record<Device["status"], { label: string; tone: "good" | "warning" | "critical" | "neutral" }> = {
  healthy: { label: "Healthy", tone: "good" },
  "no-telemetry": { label: "No telemetry", tone: "warning" },
  "doctor-failed": { label: "Checks failing", tone: "critical" },
  offline: { label: "Offline 7d+", tone: "neutral" },
  outdated: { label: "Re-run installer", tone: "warning" },
};

function CopyCommand({ label, hint, command }: { label: string; hint: string; command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg bg-surface-2 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-ink">{label}</div>
          <div className="mt-0.5 text-xs text-muted">{hint}</div>
        </div>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="h-7 shrink-0 rounded-md bg-surface px-2.5 text-xs font-medium text-ink shadow-panel hover:bg-page"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="mt-3 overflow-x-auto rounded-md bg-page px-3 py-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all text-ink-2">
        {command}
      </pre>
    </div>
  );
}

export default function SetupView() {
  const router = useRouter();
  const now = useNow();
  const { data, error, dataUpdatedAt } = useQuery<DevicesResponse>({
    queryKey: ["devices"],
    queryFn: async () => {
      const res = await fetch("/api/devices", { cache: "no-store" });
      if (res.status === 401) {
        router.replace("/login");
        throw new Error("unauthorized");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: REFRESH_MS,
  });

  const counts = data?.devices.reduce<Record<string, number>>((acc, d) => ((acc[d.status] = (acc[d.status] ?? 0) + 1), acc), {});

  return (
    <Shell updatedAt={dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined} error={error ? error.message : null}>
      <Panel
        title="Install on a developer machine"
        description="Run once per machine. Each person enters their name; their Claude account email is detected automatically on every request."
      >
        {data ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <CopyCommand label="macOS · Linux · WSL" hint="Terminal. Asks for the admin password." command={data.install.posix} />
            <CopyCommand label="Windows" hint="PowerShell. Windows asks for administrator permission." command={data.install.windows} />
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2"><Skeleton className="h-36" /><Skeleton className="h-36" /></div>
        )}
        <div className="mt-4 grid gap-4 text-xs text-muted md:grid-cols-3">
          <p>
            <span className="font-medium text-ink">What it sets up.</span> Claude Code&apos;s built-in telemetry, a status line that reports
            weekly and 5-hour limits, and a session-start check-in. It works for the CLI and the VS Code, Cursor and Windsurf extensions.
          </p>
          <p>
            <span className="font-medium text-ink">Checks.</span> The installer finishes by running a full self-test and prints the fix
            for anything that fails. People can re-run it any time with <code className="font-mono text-ink-2">ccm doctor</code>.
          </p>
          <p>
            <span className="font-medium text-ink">Updates.</span> The agent updates itself from this dashboard (current: v{data?.install.agent.windows ?? "…"}).
            Nobody needs to reinstall. The command contains the access token, so share it privately.
          </p>
        </div>
      </Panel>

      <Panel
        title="Devices"
        description={
          data
            ? `${data.devices.length} installed · ${counts?.healthy ?? 0} healthy${counts?.["no-telemetry"] ? ` · ${counts["no-telemetry"]} without telemetry` : ""}${counts?.["doctor-failed"] ? ` · ${counts["doctor-failed"]} failing checks` : ""}`
            : undefined
        }
        flush
      >
        {!data ? (
          <div className="space-y-2 px-5 pb-5"><Skeleton className="h-11" /><Skeleton className="h-11" /></div>
        ) : data.devices.length === 0 ? (
          <Empty title="No devices yet">Run the install command above on a developer machine. It appears here when the installer finishes.</Empty>
        ) : (
          <div className="overflow-x-auto border-t border-hairline">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-left text-[11px] text-muted">
                  <th className="py-2 pr-3 pl-5 font-medium">Person · machine</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Last telemetry</th>
                  <th className="px-3 py-2 font-medium">Last check-in</th>
                  <th className="px-3 py-2 font-medium">Claude Code</th>
                  <th className="py-2 pr-5 pl-3 font-medium">Agent</th>
                </tr>
              </thead>
              <tbody>
                {data.devices.map((d) => {
                  const s = STATUS[d.status];
                  return (
                    <tr key={d.device_id} className="border-b border-hairline align-top last:border-0">
                      <td className="py-2.5 pr-3 pl-5">
                        <div className="font-medium text-ink">{d.dev_name ?? "—"}{d.team && <span className="ml-1.5 font-normal text-muted">{d.team}</span>}</div>
                        <div className="text-xs text-muted">{[d.host_name, d.os_type === "Windows" ? "Windows" : d.os_type?.startsWith("Darwin") ? "macOS" : d.os_type].filter(Boolean).join(" · ")}</div>
                        {d.problems.length > 0 && (
                          <ul className="mt-2 space-y-1.5">
                            {d.problems.map((p, i) => (
                              <li key={i} className="flex gap-2 text-xs">
                                <SeverityIcon severity={p.status === "fail" ? "critical" : "warning"} size={14} />
                                <span>
                                  <span className="text-ink">{p.title}:</span> <span className="text-muted">{p.detail}</span>
                                  {p.fix && <span className="block text-muted">→ {p.fix}</span>}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <Pill tone={s.tone}>{d.status === "healthy" && <CheckIcon size={11} color="var(--good)" />}{s.label}</Pill>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-ink-2">{d.last_email ?? "—"}</td>
                      <td className="px-3 py-2.5 text-xs text-ink-2">{ago(d.last_event_at, now)}</td>
                      <td className="px-3 py-2.5 text-xs text-ink-2">{ago(d.last_heartbeat, now)}</td>
                      <td className="px-3 py-2.5 text-xs text-ink-2">{d.app_version ? `v${d.app_version}` : "—"}</td>
                      <td className="py-2.5 pr-5 pl-3 text-xs text-ink-2">
                        v{d.agent_version ?? "?"}
                        {!d.agent_current && <span className="block text-muted">updates on next session</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Shell>
  );
}
