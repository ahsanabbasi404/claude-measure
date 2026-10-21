"use client";

import { useState } from "react";
import { useApi } from "./hooks";
import { periodText } from "./overview";
import { ErrorsList, FeedList, LiveList } from "./panels";
import { Shell } from "./shell";
import type { ActivityResponse, FeedItem } from "./types";
import { PageHeader, Panel, Segmented } from "./ui";

type Kind = "all" | "prompts" | "expensive" | "problems" | "compactions";
const MATCH: Record<Kind, (f: FeedItem) => boolean> = {
  all: () => true,
  prompts: (f) => f.event_name === "user_prompt",
  expensive: (f) => f.event_name === "api_request",
  problems: (f) => ["api_error", "api_retries_exhausted", "internal_error", "api_refusal", "tool_result", "tool_decision", "mcp_server_connection"].includes(f.event_name),
  compactions: (f) => f.event_name === "compaction",
};

export default function ActivityPage() {
  const { data, error, isPlaceholderData } = useApi<ActivityResponse>("/api/activity");
  const [kind, setKind] = useState<Kind>("all");
  const feed = data?.feed.filter(MATCH[kind]);

  return (
    <Shell updatedAt={data?.generatedAt} error={error ? error.message : null} refreshing={isPlaceholderData}>
      <PageHeader title="Activity" meta={data && <span>{periodText(data)} · updates every 15 seconds</span>} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel
          flush
          title="Live feed"
          description="Prompts, requests over $0.50, compactions, sign-ins and failures"
          action={<Segmented label="Show" value={kind} onChange={setKind} options={[
            { value: "all", label: "All" }, { value: "prompts", label: "Prompts" }, { value: "expensive", label: "Expensive" },
            { value: "problems", label: "Problems" }, { value: "compactions", label: "Compactions" },
          ]} />}
        >
          <FeedList feed={feed} maxHeight={760} />
        </Panel>
        <div className="space-y-4">
          <Panel flush title="Live now" description="Active in the last 15 minutes"><LiveList live={data?.live} /></Panel>
          <Panel flush title="Errors" description="Grouped by type and message"><ErrorsList errors={data?.errors} maxHeight={520} /></Panel>
        </div>
      </div>
    </Shell>
  );
}
