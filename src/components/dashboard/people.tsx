"use client";

import { useState } from "react";
import { usd } from "@/lib/format";
import { useApi } from "./hooks";
import { periodText } from "./overview";
import { PeopleTable } from "./panels";
import { Shell } from "./shell";
import type { PeopleResponse } from "./types";
import { PageHeader, Panel } from "./ui";

export default function PeoplePage() {
  const { data, error, isPlaceholderData } = useApi<PeopleResponse>("/api/people");
  const [search, setSearch] = useState("");
  const active = data?.people.filter((p) => p.requests > 0) ?? [];
  const total = active.reduce((a, p) => a + p.cost_usd, 0);

  return (
    <Shell updatedAt={data?.generatedAt} error={error ? error.message : null} refreshing={isPlaceholderData}>
      <PageHeader
        title="People"
        meta={data && <><span>{periodText(data)}</span><span>{active.length} active of {data.people.length}</span><span>{usd(total)} total</span></>}
        actions={
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, team or account"
            className="h-8 w-64 max-w-full rounded-[7px] bg-surface px-3 text-[13px] text-ink shadow-panel outline-none placeholder:text-muted focus:ring-1 focus:ring-series"
          />
        }
      />
      <Panel flush title="Everyone" description="Sort by any column. Select a person for usage over time, accounts, models, sessions and tools.">
        <PeopleTable people={data?.people} info={data} search={search} />
      </Panel>
    </Shell>
  );
}
