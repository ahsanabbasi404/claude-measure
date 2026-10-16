"use client";

import { useState } from "react";
import { AccountsPanel } from "./accounts-panel";
import { AttentionPanel } from "./attention";
import { DetailSheet, type SheetTarget } from "./detail-sheet";
import { useNow, useStats } from "./hooks";
import { ActivityPanel, IssuesPanel, ModelsPanel } from "./lists";
import { PeopleTable } from "./people-table";
import { Shell } from "./shell";
import type { Range } from "./types";
import { Segmented } from "./ui";
import { UsagePanel } from "./usage-panel";

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

export default function Overview() {
  const [range, setRange] = useState<Range>("7d");
  const [target, setTarget] = useState<SheetTarget>(null);
  const { data: stats, error } = useStats(range);
  const now = useNow();

  const select = (subject: string) =>
    setTarget({ kind: subject.includes("@") ? "account" : "dev", id: subject });

  return (
    <Shell
      updatedAt={stats?.generatedAt}
      error={error ? error.message : null}
      controls={<Segmented label="Time range" value={range} onChange={setRange} options={RANGE_OPTIONS} />}
    >
      <UsagePanel stats={stats} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <AttentionPanel insights={stats?.insights} onSelect={select} />
        <AccountsPanel accounts={stats?.accounts} now={now} onSelect={(email) => setTarget({ kind: "account", id: email })} />
      </div>

      <PeopleTable developers={stats?.developers} now={now} onSelect={(dev) => setTarget({ kind: "dev", id: dev })} />

      <div className="grid gap-4 lg:grid-cols-3">
        <ModelsPanel models={stats?.models} total={stats?.totals.cost_usd ?? 0} />
        <ActivityPanel feed={stats?.feed} now={now} />
        <IssuesPanel errors={stats?.errors} now={now} />
      </div>

      <DetailSheet target={target} stats={stats} now={now} onSelect={setTarget} />
    </Shell>
  );
}
