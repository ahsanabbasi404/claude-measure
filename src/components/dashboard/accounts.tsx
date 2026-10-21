"use client";

import { useState } from "react";
import { usd } from "@/lib/format";
import { useApi, useNow } from "./hooks";
import { periodText } from "./overview";
import { AccountCard, UsagePanel } from "./panels";
import { Shell } from "./shell";
import type { AccountsResponse } from "./types";
import { Empty, PageHeader, Panel, Segmented, Skeleton } from "./ui";

type Show = "all" | "active" | "shared";

export default function AccountsPage() {
  const { data, error, isPlaceholderData } = useApi<AccountsResponse>("/api/accounts");
  const now = useNow();
  const [show, setShow] = useState<Show>("all");
  const accounts = data?.accounts.filter((a) => show === "all" || (show === "active" ? a.requests > 0 : a.people.length > 1));
  const total = data?.accounts.reduce((s, a) => s + a.cost_usd, 0) ?? 0;

  return (
    <Shell updatedAt={data?.generatedAt} error={error ? error.message : null} refreshing={isPlaceholderData}>
      <PageHeader
        title="Claude accounts"
        meta={data && <><span>{periodText(data)}</span><span>{data.accounts.length} accounts</span><span>{usd(total)} used in this period</span></>}
        actions={<Segmented label="Show" value={show} onChange={setShow} options={[{ value: "all", label: "All" }, { value: "active", label: "Used in period" }, { value: "shared", label: "Shared" }]} />}
      />
      <p className="max-w-3xl text-xs text-muted">
        Each Claude account has its own weekly and 5-hour limit. Limit percentages come from the CLI status line; accounts used only
        from IDE extensions show usage value and real-time burn instead. Burn figures (last hour, 5 hours, 24 hours, 7 days) ignore the
        selected range so they always show what is happening now.
      </p>

      <UsagePanel title="Usage by account" data={data} rows={data?.series} by="account" onBy={() => {}} breakdowns={["account"]} />

      {!accounts ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
      ) : accounts.length === 0 ? (
        <Panel><Empty title="No accounts match" /></Panel>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((a) => <AccountCard key={a.user_email} a={a} now={now} />)}
        </div>
      )}
    </Shell>
  );
}
