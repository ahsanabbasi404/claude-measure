"use client";

import Link from "next/link";
import { useState } from "react";
import { compact, duration, int, percent, usd } from "@/lib/format";
import { Heatmap } from "./charts";
import { useApi, useNow } from "./hooks";
import {
  AccountCard, EffortList, ErrorsList, InsightsPanel, LiveList, ModelsList, PeopleTable, PurposeList, SessionsTable, UsagePanel, useLinks,
} from "./panels";
import { Shell } from "./shell";
import type { Breakdown, Overview as OverviewData, RangeInfo } from "./types";
import { Delta, PageHeader, Panel, Skeleton, StatGrid, StatTile } from "./ui";

export function periodText(d: RangeInfo | undefined) {
  if (!d) return "";
  const f = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (d.range === "24h") return "Last 24 hours";
  return d.fromDate === d.toDate ? f(d.fromDate) : `${f(d.fromDate)} – ${f(d.toDate)}`;
}

export function comparisonText(d: RangeInfo | undefined) {
  if (!d) return "";
  const f = (s: string) => new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const end = new Date(Date.parse(d.prevTo) - 1).toISOString();
  return `Changes compare with ${f(d.prevFrom) === f(end) ? f(d.prevFrom) : `${f(d.prevFrom)} – ${f(end)}`}`;
}

export default function Overview() {
  const [by, setBy] = useState<Breakdown>("person");
  const { data, error, isPlaceholderData } = useApi<OverviewData>("/api/overview", { by });
  const now = useNow();
  const links = useLinks();
  const t = data?.totals;
  const p = data?.previous;

  return (
    <Shell updatedAt={data?.generatedAt} error={error ? error.message : null} refreshing={isPlaceholderData}>
      <PageHeader title="Team overview" meta={data ? <><span>{periodText(data)}</span><span>{comparisonText(data)}</span></> : <Skeleton className="h-4 w-48" />} />

      <StatGrid className="grid-cols-2 md:grid-cols-4">
        <StatTile
          label="Usage value"
          hint="API-equivalent value of all requests. Max plans are not billed per token; this measures how much limit is consumed."
          value={t ? usd(t.cost_usd) : "–"}
          delta={t && <Delta current={t.cost_usd} previous={p?.cost_usd} />}
          sub={t && t.people ? `${usd(t.cost_usd / t.people)} per active person` : undefined}
        />
        <StatTile
          label="Tokens"
          value={t ? compact(t.tokens) : "–"}
          delta={t && <Delta current={t.tokens} previous={p?.tokens} />}
          sub={t ? `${percent(t.cache_hit === null ? null : t.cache_hit * 100)} of context from cache` : undefined}
        />
        <StatTile
          label="Prompts"
          value={t ? int(t.prompts) : "–"}
          delta={t && <Delta current={t.prompts} previous={p?.prompts} />}
          sub={t ? `${int(t.requests)} model requests · ${t.prompts ? usd(t.cost_usd / t.prompts) : "—"} each` : undefined}
        />
        <StatTile
          label="Sessions"
          value={t ? int(t.sessions) : "–"}
          delta={t && <Delta current={t.sessions} previous={p?.sessions} />}
          sub={t && t.sessions ? `${usd(t.cost_usd / t.sessions)} average` : undefined}
        />
        <StatTile
          label="Active people"
          value={t ? `${t.people}` : "–"}
          delta={t && <Delta current={t.people} previous={p?.people} />}
          sub={t ? `of ${t.known_people} known · ${t.accounts} account${t.accounts === 1 ? "" : "s"} used · ${data?.live.length ?? 0} live now` : undefined}
        />
        <StatTile
          label="Active time"
          value={t ? duration(t.active_seconds) : "–"}
          delta={t && <Delta current={t.active_seconds} previous={p?.active_seconds} />}
          sub={t && t.active_seconds > 60 ? `${usd(t.cost_usd / (t.active_seconds / 3600))} per active hour` : undefined}
        />
        <StatTile
          label="Lines changed"
          value={t ? compact(t.lines_changed) : "–"}
          delta={t && <Delta current={t.lines_changed} previous={p?.lines_changed} />}
          sub={t ? `${int(t.commits)} commits · ${t.cost_usd > 0 ? Math.round(t.lines_changed / t.cost_usd) : 0} lines per $` : undefined}
        />
        <StatTile
          label="Rate-limited"
          hint="Requests rejected with HTTP 429 because an account ran out of limit"
          value={t ? int(t.rate_limited) : "–"}
          tone={t && t.rate_limited > 0 ? "bad" : undefined}
          delta={t && <Delta current={t.rate_limited} previous={p?.rate_limited} goodWhen="down" />}
          sub={t ? `${int(t.api_errors)} API errors · ${int(t.auto_compactions)} auto-compactions` : undefined}
        />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <UsagePanel data={data} rows={data?.series} by={by} onBy={setBy} breakdowns={["none", "person", "account", "model", "client", "kind"]} height={260} />
        <Panel flush title="Live now" description="Active in the last 15 minutes, with value used in the last hour">
          <LiveList live={data?.live} />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <InsightsPanel insights={data?.insights} maxHeight={560} />
        <Panel
          title="Claude accounts"
          description="Each account has its own weekly limit. The tick marks where the current pace ends at reset."
          action={<Link href={links.href("/accounts")} className="text-xs text-muted hover:text-ink">All accounts →</Link>}
        >
          {!data ? <Skeleton className="h-40" /> : (
            <div className="grid max-h-[520px] gap-3 overflow-y-auto">
              {data.accounts.map((a) => <AccountCard key={a.user_email} a={a} now={now} />)}
              {data.accounts.length === 0 && <p className="text-xs text-muted">No accounts seen yet.</p>}
            </div>
          )}
        </Panel>
      </div>

      <Panel
        flush
        title="People"
        description="Select a person for their full breakdown. Efficiency weighs cache reuse, context size, output per $, errors and auto-compactions."
        action={<Link href={links.href("/people")} className="text-xs text-muted hover:text-ink">People page →</Link>}
      >
        <PeopleTable people={data?.people} info={data} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Models" description="Detected from requests; new models appear automatically">
          <ModelsList models={data?.models} total={t?.cost_usd ?? 0} />
        </Panel>
        <Panel title="Where usage goes" description="Value by request purpose">
          <PurposeList kinds={data?.kinds} total={t?.cost_usd ?? 0} />
        </Panel>
        <Panel title="Effort levels" description="Share of requests per reasoning effort setting">
          <EffortList effort={data?.effort} />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="When the team works" description={data ? `Usage value by weekday and hour, ${data.tz.replace(/_/g, " ")} time` : undefined}>
          {data ? <Heatmap cells={data.heatmap} /> : <Skeleton className="h-40" />}
        </Panel>
        <Panel flush title="Errors" description="Grouped by type; each one is usage spent without progress"
          action={<Link href={links.href("/activity")} className="text-xs text-muted hover:text-ink">Activity →</Link>}>
          <ErrorsList errors={data?.errors} maxHeight={300} />
        </Panel>
      </div>

      <Panel flush title="Most expensive sessions" description="Long sessions with large contexts are where limits go"
        action={<Link href={links.href("/sessions")} className="text-xs text-muted hover:text-ink">All sessions →</Link>}>
        <SessionsTable sessions={data?.sessions} />
      </Panel>
    </Shell>
  );
}
