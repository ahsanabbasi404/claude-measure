import type { Insight } from "./types";
import { CheckIcon, Panel, SeverityIcon, Skeleton } from "./ui";

const LABEL = { critical: "Critical", serious: "High", warning: "Warning", info: "Info" } as const;

export function AttentionPanel({ insights, onSelect }: { insights: Insight[] | undefined; onSelect: (subject: string) => void }) {
  const urgent = insights?.filter((i) => i.severity !== "info").length ?? 0;
  return (
    <Panel
      title="Needs attention"
      description={insights ? (urgent ? `${urgent} item${urgent > 1 ? "s" : ""} to act on` : "Limits, rate limiting, account switching and wasteful patterns") : undefined}
      flush
    >
      {!insights ? (
        <div className="space-y-3 px-5 pb-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
      ) : insights.length === 0 ? (
        <div className="flex items-center gap-2.5 px-5 pb-5 text-sm text-ink-2">
          <CheckIcon /> Nothing needs attention: no account is close to its limit and no wasteful patterns were found.
        </div>
      ) : (
        <ul className="max-h-[340px] overflow-y-auto border-t border-hairline">
          {insights.map((i, n) => (
            <li key={`${i.kind}-${i.subject}-${n}`} className="border-b border-hairline last:border-0">
              <button
                onClick={() => onSelect(i.subject)}
                className="flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-2"
              >
                <span className="mt-0.5"><SeverityIcon severity={i.severity} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-ink">{i.title}</span>
                  {i.detail && <span className="mt-0.5 block text-xs text-muted">{i.detail}</span>}
                </span>
                <span className="mt-0.5 shrink-0 text-[11px] text-muted">{LABEL[i.severity]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
