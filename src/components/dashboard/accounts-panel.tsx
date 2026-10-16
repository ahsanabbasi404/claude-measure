import { ago, resetsIn, usd } from "@/lib/format";
import type { Account } from "./types";
import { Empty, Meter, Panel, Pill, Skeleton, usageSeverity } from "./ui";

function WeeklyCell({ a, now }: { a: Account; now: number }) {
  const w = a.weekly;
  if (!w) {
    return <span className="text-xs text-muted">No limit data yet (shows after a terminal session)</span>;
  }
  const sev = usageSeverity(w.pct);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={`font-semibold ${sev === "critical" ? "text-critical" : "text-ink"}`}>{Math.round(w.pct)}% of weekly limit</span>
        <span className="text-muted">{resetsIn(w.resetsAt, now)}</span>
      </div>
      <div className="mt-1.5"><Meter value={w.pct} projected={w.projectedPct} /></div>
      <div className="mt-1 text-[11px] text-muted">
        {w.hitsLimitAt ? (
          <span className="text-critical">
            {Date.parse(w.hitsLimitAt) <= now ? "Limit reached" : `Runs out in ~${until(w.hitsLimitAt, now)} at current pace`}
          </span>
        ) : w.projectedPct !== null ? (
          <>On pace for {Math.round(w.projectedPct)}% at reset</>
        ) : (
          <>Too early in the week to project</>
        )}
        {" · "}as of {ago(w.asOf, now)}
      </div>
    </div>
  );
}

function until(iso: string, now: number) {
  const s = (Date.parse(iso) - now) / 1000;
  if (s <= 0) return "0h";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 172800) return `${Math.round(s / 3600)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

export function AccountsPanel({ accounts, now, onSelect }: { accounts: Account[] | undefined; now: number; onSelect: (email: string) => void }) {
  return (
    <Panel
      title="Claude accounts"
      description="Each account has its own weekly limit. The tick on the bar marks where the current pace ends up at reset."
      flush
    >
      {!accounts ? (
        <div className="space-y-3 px-5 pb-5"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
      ) : accounts.length === 0 ? (
        <Empty title="No accounts seen yet">Accounts appear after the first Claude Code request from an installed device.</Empty>
      ) : (
        <ul className="border-t border-hairline">
          {accounts.map((a) => (
            <li key={a.user_email} className="border-b border-hairline last:border-0">
              <button onClick={() => onSelect(a.user_email)} className="grid w-full gap-x-6 gap-y-2 px-5 py-3.5 text-left transition-colors hover:bg-surface-2 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_auto]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-ink">{a.user_email}</span>
                    {a.plan && <Pill>{a.plan}</Pill>}
                    {a.devs.length > 1 && <Pill tone="warning">shared</Pill>}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted">
                    {a.devs.length ? `Used by ${a.devs.join(", ")}` : "No activity in this period"}
                  </div>
                </div>
                <WeeklyCell a={a} now={now} />
                <div className="text-right text-xs md:min-w-[92px]">
                  <div className="font-semibold text-ink">{usd(a.cost_7d)}</div>
                  <div className="text-muted">value, last 7d</div>
                  {a.five_hour && <div className="mt-1 text-muted">5h window {Math.round(a.five_hour.pct)}%</div>}
                  {a.rate_limited > 0 && <div className="mt-1 text-critical">{a.rate_limited}× rate-limited</div>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
