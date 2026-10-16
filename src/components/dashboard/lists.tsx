import { modelLabel } from "@/lib/analytics";
import { ago, compact, int, percent, usd } from "@/lib/format";
import type { Stats } from "./types";
import { CheckIcon, Empty, Panel, Skeleton } from "./ui";

export function ModelsPanel({ models, total }: { models: Stats["models"] | undefined; total: number }) {
  return (
    <Panel title="Models" description="Detected automatically from requests; new models appear without any change." flush>
      {!models ? (
        <div className="space-y-2 px-5 pb-5"><Skeleton className="h-9" /><Skeleton className="h-9" /></div>
      ) : models.length === 0 ? (
        <Empty title="No requests in this period" />
      ) : (
        <ul className="border-t border-hairline">
          {models.map((m) => {
            const share = total > 0 ? m.cost_usd / total : 0;
            return (
              <li key={m.model} className="border-b border-hairline px-5 py-3 last:border-0">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-[13px] font-medium text-ink">{m.label}</span>
                    <span className="ml-2 text-[11px] text-muted">{m.model}</span>
                  </div>
                  <span className="text-[13px] font-medium text-ink tabular-nums">{usd(m.cost_usd)}</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-surface-2">
                  <div className="h-1.5 rounded-full bg-series" style={{ width: `${Math.max(1.5, share * 100)}%` }} />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-muted tabular-nums">
                  <span>{int(m.requests)} requests · {compact(m.total_tokens)} tokens · {m.developers} {m.developers === 1 ? "person" : "people"}</span>
                  <span>{percent(share * 100)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

type FeedItem = Stats["feed"][number];

function describe(f: FeedItem): { label: string; detail: string; tone?: "bad" } {
  switch (f.event_name) {
    case "user_prompt":
      return { label: "Prompt", detail: f.prompt_length ? `${int(Number(f.prompt_length))} characters` : "" };
    case "api_request":
      return { label: "Large request", detail: `${f.model ? modelLabel(f.model) : ""} · ${compact(f.tokens)} tokens · ${usd(f.cost_usd ?? 0)}` };
    case "api_error":
      return { label: f.status_code === "429" ? "Rate-limited" : "API error", detail: [f.status_code, f.error].filter(Boolean).join(" · "), tone: "bad" };
    case "api_retries_exhausted":
      return { label: "Retries exhausted", detail: f.error ?? "", tone: "bad" };
    case "api_refusal":
      return { label: "Refusal", detail: f.model ? modelLabel(f.model) : "" };
    case "compaction":
      return {
        label: f.trigger === "auto" ? "Auto-compacted" : "Compacted",
        detail: f.pre_tokens ? `${compact(Number(f.pre_tokens))} → ${compact(Number(f.post_tokens ?? 0))} tokens` : f.error ?? "",
        tone: f.error ? "bad" : undefined,
      };
    case "tool_result":
      return { label: "Tool failed", detail: f.tool_name ?? "", tone: "bad" };
    case "tool_decision":
      return { label: "Tool rejected", detail: f.tool_name ?? "" };
    case "subagent_completed":
      return { label: "Subagent finished", detail: "" };
    case "mcp_server_connection":
      return { label: "MCP server failed", detail: f.error ?? "", tone: "bad" };
    case "auth":
      return { label: "Sign-in change", detail: f.user_email ?? "" };
    default:
      return { label: f.event_name, detail: "" };
  }
}

export function ActivityPanel({ feed, now }: { feed: Stats["feed"] | undefined; now: number }) {
  return (
    <Panel title="Live activity" description="Prompts, expensive requests, compactions and failures as they happen." flush>
      {!feed ? (
        <div className="space-y-2 px-5 pb-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-7" />)}</div>
      ) : feed.length === 0 ? (
        <Empty title="No activity yet" />
      ) : (
        <ul className="max-h-[420px] overflow-y-auto border-t border-hairline">
          {feed.map((f) => {
            const d = describe(f);
            return (
              <li key={f.id} className="grid grid-cols-[64px_minmax(0,110px)_minmax(0,1fr)] items-baseline gap-3 border-b border-hairline px-5 py-2 text-[13px] last:border-0">
                <span className="text-[11px] text-muted tabular-nums">{ago(f.ts, now)}</span>
                <span className="truncate text-ink-2">{f.dev ?? "—"}</span>
                <span className="min-w-0 truncate">
                  <span className={`font-medium ${d.tone === "bad" ? "text-critical" : "text-ink"}`}>{d.label}</span>
                  {d.detail && <span className="ml-2 text-xs text-muted">{d.detail}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

const ERROR_LABEL: Record<string, string> = {
  api_error: "API error",
  api_retries_exhausted: "Retries exhausted",
  internal_error: "Internal error",
  api_refusal: "Refusal",
  compaction: "Compaction failed",
  mcp_server_connection: "MCP server failed",
};

export function IssuesPanel({ errors, now }: { errors: Stats["errors"] | undefined; now: number }) {
  return (
    <Panel title="Errors" description="Grouped by type and message. Each one is usage spent without progress." flush>
      {!errors ? (
        <div className="space-y-2 px-5 pb-5"><Skeleton className="h-9" /></div>
      ) : errors.length === 0 ? (
        <div className="flex items-center gap-2.5 px-5 pb-5 text-sm text-ink-2"><CheckIcon /> No errors in this period.</div>
      ) : (
        <ul className="max-h-[420px] overflow-y-auto border-t border-hairline">
          {errors.map((e, i) => (
            <li key={i} className="border-b border-hairline px-5 py-2.5 last:border-0">
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="font-medium text-ink">
                  {e.status_code === "429" ? "Rate-limited" : ERROR_LABEL[e.event_name] ?? e.event_name}
                  {e.status_code && <span className="ml-1.5 text-xs font-normal text-muted">HTTP {e.status_code}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted tabular-nums">{e.count}× · {ago(e.last_seen, now)}</span>
              </div>
              {e.error && <p className="mt-0.5 truncate text-xs text-muted" title={e.error}>{e.error}</p>}
              {e.devs.length > 0 && <p className="mt-0.5 text-[11px] text-muted">{e.devs.join(", ")}</p>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
