import { humanDuration, MIN_CLAUDE_VERSION, sortInsights, versionLess, type Insight } from "./analytics";
import { median, type AccountSummary, type PersonSummary, type SessionSummary } from "./queries";

/*
 * Attention items. Each one names its subject (a person, an account or a session) so the dashboard
 * can link straight to the detail page, and states the numbers behind it.
 */

export type LinkedInsight = Insight & {
  subjectType: "person" | "account" | "session";
  /** Group for filtering in the UI. */
  category: "limits" | "heavy-use" | "waste" | "errors" | "setup";
};

const MIN_REQUESTS = 15;
const LARGE_CONTEXT = 150_000;
const usd = (n: number) => `$${n >= 100 ? Math.round(n) : n.toFixed(2)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function buildInsights(
  people: PersonSummary[],
  accounts: AccountSummary[],
  sessions: SessionSummary[],
  now: number,
): LinkedInsight[] {
  const out: LinkedInsight[] = [];
  const push = (i: LinkedInsight) => out.push(i);

  // ------------------------------------------------------------ account limits
  for (const a of accounts) {
    const w = a.weekly;
    const who = a.people.length
      ? ` · ${a.people.slice(0, 4).map((p) => `${p.dev} ${usd(p.cost_usd)}`).join(", ")}${a.people.length > 4 ? ` +${a.people.length - 4} more` : ""}`
      : "";
    if (w?.hitsLimitAt) {
      const until = new Date(w.hitsLimitAt).getTime() - now;
      push({
        severity: "critical", kind: "limit-projection", category: "limits", subject: a.user_email, subjectType: "account",
        title: until <= 0 ? `${a.user_email} reached its weekly limit` : `${a.user_email} runs out of its weekly limit in ~${humanDuration(until)}`,
        detail: `${Math.round(w.pct)}% used, resets in ${humanDuration(new Date(w.resetsAt).getTime() - now)}, pace ${w.pacePerDay?.toFixed(0)}%/day${who}`,
      });
    } else if (w && w.pct >= 80) {
      push({
        severity: "serious", kind: "limit-high", category: "limits", subject: a.user_email, subjectType: "account",
        title: `${a.user_email} is at ${Math.round(w.pct)}% of its weekly limit`,
        detail: `Resets in ${humanDuration(new Date(w.resetsAt).getTime() - now)}${who}`,
      });
    }
    if (a.five_hour && a.five_hour.pct >= 85) {
      push({
        severity: "serious", kind: "five-hour-high", category: "limits", subject: a.user_email, subjectType: "account",
        title: `${a.user_email} is at ${Math.round(a.five_hour.pct)}% of its 5-hour window`,
        detail: `${usd(a.burn.cost_5h)} used in the last 5 hours${who}`,
      });
    }
    if (a.people.length > 1 && a.cost_usd > 0) {
      const top = a.people[0];
      push({
        severity: a.people.length >= 4 ? "warning" : "info", kind: "shared-account", category: "limits",
        subject: a.user_email, subjectType: "account",
        title: `${a.people.length} people share ${a.user_email}`,
        detail: `They draw from one weekly limit. ${top.dev} used ${pct(top.cost_usd / a.cost_usd)} of it in this period${who}`,
      });
    }
  }

  // ------------------------------------------------------------ people
  const active = people.filter((p) => p.requests >= MIN_REQUESTS);
  const medianCost = median(active.map((p) => p.cost_usd));
  const medianDaily = median(active.map((p) => p.cost_per_active_day ?? 0));
  const medianContext = active.length >= 3 ? median(active.map((p) => p.avg_context ?? 0)) : null;
  if (medianContext && medianContext > LARGE_CONTEXT) {
    const largest = [...active].sort((a, b) => (b.avg_context ?? 0) - (a.avg_context ?? 0)).slice(0, 4);
    push({
      severity: "warning", kind: "large-context-team", category: "waste", subject: largest[0].dev, subjectType: "person",
      title: `The team works with very large contexts (median ${Math.round(medianContext / 1000)}K tokens per request)`,
      detail: `Long sessions resend the whole conversation on every request. Largest: ${largest.map((p) => `${p.dev} ${Math.round((p.avg_context ?? 0) / 1000)}K`).join(", ")}`,
    });
  }

  for (const p of people) {
    if (p.rate_limited > 0) {
      push({
        severity: "serious", kind: "rate-limited", category: "limits", subject: p.dev, subjectType: "person",
        title: `${p.dev} hit a usage limit ${p.rate_limited} time${p.rate_limited > 1 ? "s" : ""}`,
        detail: "Requests were rejected with HTTP 429 while working; the account ran out of limit",
      });
    }
    if (p.credit_errors > 0) {
      push({
        severity: "serious", kind: "credit-errors", category: "errors", subject: p.dev, subjectType: "person",
        title: `${p.dev} got "credit balance too low" errors (${p.credit_errors}×)`,
        detail: "Claude Code was signed in to an API (Console) organization instead of a Max subscription, or used an API key",
      });
    }
    if (medianCost && active.length >= 3 && p.cost_usd > 2.5 * medianCost && p.requests >= MIN_REQUESTS) {
      push({
        severity: "warning", kind: "heavy-user", category: "heavy-use", subject: p.dev, subjectType: "person",
        title: `${p.dev} used ${(p.cost_usd / medianCost).toFixed(1)}× the team median`,
        detail: `${usd(p.cost_usd)} in this period vs a median of ${usd(medianCost)}; ${usd(p.cost_per_active_day ?? 0)} per active day`,
      });
    }
    // A single day far above the person's own typical day.
    const days = Object.entries(p.daily).filter(([, v]) => v > 0);
    if (days.length >= 3) {
      const typical = median(days.map(([, v]) => v)) ?? 0;
      const [peakDay, peak] = days.sort((x, y) => y[1] - x[1])[0];
      if (typical > 0 && peak > 3 * typical && peak > 20) {
        push({
          severity: "warning", kind: "spike", category: "heavy-use", subject: p.dev, subjectType: "person",
          title: `${p.dev} spiked to ${usd(peak)} on ${new Date(`${peakDay}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}`,
          detail: `${(peak / typical).toFixed(1)}× their typical day (${usd(typical)})`,
        });
      }
    } else if (medianDaily && p.cost_per_active_day && p.active_days >= 1 && p.cost_per_active_day > 3 * medianDaily && p.cost_usd > 20 && active.length >= 3) {
      push({
        severity: "warning", kind: "intense-day", category: "heavy-use", subject: p.dev, subjectType: "person",
        title: `${p.dev} burns ${usd(p.cost_per_active_day)} per active day`,
        detail: `${(p.cost_per_active_day / medianDaily).toFixed(1)}× the team median per active day`,
      });
    }
    if (p.emails.length > 1) {
      push({
        severity: "warning", kind: "account-switching", category: "limits", subject: p.dev, subjectType: "person",
        title: `${p.dev} used ${p.emails.length} different Claude accounts`,
        detail: p.emails.join(", "),
      });
    }
    if (p.requests < MIN_REQUESTS) continue;
    // Flagged relative to the team, so a team-wide habit produces one item instead of one per person.
    if (p.avg_context !== null && p.avg_context > LARGE_CONTEXT && (!medianContext || p.avg_context > 1.3 * medianContext)) {
      push({
        severity: "warning", kind: "large-context", category: "waste", subject: p.dev, subjectType: "person",
        title: `${p.dev} works with very large contexts (~${Math.round(p.avg_context / 1000)}K tokens per request)`,
        detail: `${medianContext ? `${(p.avg_context / medianContext).toFixed(1)}× the team median. ` : ""}Every request resends the whole conversation; /clear between unrelated tasks cuts usage sharply`,
      });
    }
    if (p.sessions > 0 && p.auto_compactions / p.sessions > 1) {
      push({
        severity: "warning", kind: "auto-compaction", category: "waste", subject: p.dev, subjectType: "person",
        title: `${p.dev} hits auto-compaction ${(p.auto_compactions / p.sessions).toFixed(1)}× per session`,
        detail: `${p.auto_compactions} auto-compactions in ${p.sessions} sessions: sessions regularly fill the context window`,
      });
    }
    if (p.cache_hit !== null && p.cache_hit < 0.7) {
      push({
        severity: "info", kind: "low-cache", category: "waste", subject: p.dev, subjectType: "person",
        title: `${p.dev} reuses only ${pct(p.cache_hit)} of context from cache`,
        detail: "Context is rebuilt often: frequent restarts, model switches, or pauses longer than the cache lifetime",
      });
    }
    if (p.max_effort_share !== null && p.max_effort_share > 0.25) {
      push({
        severity: "info", kind: "max-effort", category: "heavy-use", subject: p.dev, subjectType: "person",
        title: `${p.dev} runs ${pct(p.max_effort_share)} of requests at max effort`,
        detail: "Max effort spends far more tokens per answer; high or xhigh suits most coding work",
      });
    }
    if (p.subagent_share !== null && p.subagent_share > 0.4) {
      push({
        severity: "info", kind: "subagent-heavy", category: "heavy-use", subject: p.dev, subjectType: "person",
        title: `${pct(p.subagent_share)} of ${p.dev}'s usage comes from subagents`,
        detail: `${usd(p.subagent_cost_usd)} spent by subagents (Explore, general-purpose and custom agents)`,
      });
    }
    if (p.efficiency.score !== null && p.efficiency.score < 55) {
      const worst = [...p.efficiency.parts].sort((x, y) => x.score - y.score)[0];
      push({
        severity: "warning", kind: "low-efficiency", category: "waste", subject: p.dev, subjectType: "person",
        title: `${p.dev} has a low efficiency score (${p.efficiency.score})`,
        detail: worst ? `Weakest area: ${worst.label.toLowerCase()} (${worst.value})` : "",
      });
    }
    const old = p.app_versions.filter((v) => /^\d+\.\d+\.\d+$/.test(v) && versionLess(v, MIN_CLAUDE_VERSION));
    if (old.length) {
      push({
        severity: "info", kind: "outdated-client", category: "setup", subject: p.dev, subjectType: "person",
        title: `${p.dev} uses an outdated Claude Code (${old.join(", ")})`,
        detail: "Update with: claude update, or update the IDE extension",
      });
    }
  }

  // ------------------------------------------------------------ sessions
  const medianSession = median(sessions.map((s) => s.cost_usd));
  for (const s of sessions.slice(0, 3)) {
    if (medianSession && s.cost_usd > Math.max(25, 5 * medianSession)) {
      push({
        severity: "info", kind: "expensive-session", category: "heavy-use", subject: s.session_id, subjectType: "session",
        title: `${s.dev}: one session used ${usd(s.cost_usd)}`,
        detail: `${s.requests} requests over ${humanDuration(s.duration_s * 1000)}, peak context ${Math.round((s.peak_context ?? 0) / 1000)}K${s.auto_compactions ? `, ${s.auto_compactions} auto-compactions` : ""} (median session ${usd(medianSession)})`,
      });
    }
  }

  return sortInsights(out) as LinkedInsight[];
}
