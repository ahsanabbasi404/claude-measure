"use client";

import { compact, duration, usd } from "@/lib/format";
import { useApi } from "./hooks";
import { periodText } from "./overview";
import { SessionsTable } from "./panels";
import { Shell } from "./shell";
import type { SessionsResponse } from "./types";
import { PageHeader, Panel, StatGrid, StatTile } from "./ui";

export default function SessionsPage() {
  const { data, error, isPlaceholderData } = useApi<SessionsResponse>("/api/sessions", { sort: "cost", limit: "300" });
  const s = data?.summary;
  const total = data?.sessions.reduce((a, x) => a + x.cost_usd, 0) ?? 0;
  const top10 = data ? [...data.sessions].sort((a, b) => b.cost_usd - a.cost_usd).slice(0, Math.max(1, Math.ceil(data.sessions.length * 0.1))).reduce((a, x) => a + x.cost_usd, 0) : 0;

  return (
    <Shell updatedAt={data?.generatedAt} error={error ? error.message : null} refreshing={isPlaceholderData}>
      <PageHeader title="Sessions" meta={data && <><span>{periodText(data)}</span><span>{data.sessions.length} sessions{data.sessions.length >= 300 ? " (largest 300)" : ""}</span></>} />
      <StatGrid className="grid-cols-2 md:grid-cols-4">
        <StatTile label="Sessions" value={s ? String(s.count) : "–"} sub={data ? `${usd(total)} in total` : undefined} />
        <StatTile label="Median session" value={s?.median_cost != null ? usd(s.median_cost) : "–"} sub={s?.median_duration_s != null ? `${duration(s.median_duration_s)} long` : undefined} />
        <StatTile label="Median peak context" value={s?.median_peak_context != null ? compact(s.median_peak_context) : "–"} sub="tokens in the largest request" />
        <StatTile label="Top 10% of sessions" value={total > 0 ? `${Math.round((top10 / total) * 100)}%` : "–"} sub="of all usage value" hint="How concentrated usage is in a few long sessions" />
      </StatGrid>
      <Panel flush title="All sessions" description="Sort by any column. Select a session to see how its context grew and which prompts cost the most.">
        <SessionsTable sessions={data?.sessions} />
      </Panel>
    </Shell>
  );
}
