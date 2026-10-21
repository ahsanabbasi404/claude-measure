import type { Breakdown, Options } from "./types";

/** Display names for raw dimension values. */
export function clientLabel(key: string | null | undefined): string {
  switch (key) {
    case "cli": return "CLI";
    case "claude-vscode": return "VS Code";
    case "claude-jetbrains": return "JetBrains";
    case "claude-desktop": return "Desktop";
    case "sdk-ts": return "Agent SDK (TS)";
    case "sdk-py": return "Agent SDK (Py)";
    case "sdk-cli": return "Agent SDK";
    case "unknown": case null: case undefined: return "Unknown";
    default: return key;
  }
}

export const KIND_LABEL: Record<string, string> = {
  main: "Conversation",
  subagent: "Subagents",
  compaction: "Compaction",
  web: "Web search & fetch",
  background: "Background",
};
export const KIND_HINT: Record<string, string> = {
  main: "Requests in the conversation itself",
  subagent: "Explore, general-purpose and custom agents",
  compaction: "Summarizing a full context window",
  web: "Processing web search and fetch results",
  background: "Session titles, summaries, side questions",
};
const KIND_ORDER = ["main", "subagent", "compaction", "web", "background"];

export function modelLabel(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(id);
  if (!m) return id;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

export function dimensionLabel(by: Breakdown, key: string): string {
  if (by === "client") return clientLabel(key);
  if (by === "model") return modelLabel(key);
  if (by === "kind") return KIND_LABEL[key] ?? key;
  if (by === "none") return "Total";
  return key;
}

/** Series colors: fixed categorical slots in order, then a neutral "Other". */
export const CATEGORICAL = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)", "var(--cat-7)"];
export const OTHER_COLOR = "var(--cat-other)";
export const OTHER_KEY = "__other";

/**
 * Stable order of entities for a dimension. Colors follow this order (long-run usage, from the
 * options endpoint), so filtering never repaints an entity.
 */
export function dimensionOrder(by: Breakdown, options: Options | undefined): string[] {
  if (by === "kind") return KIND_ORDER;
  if (!options) return [];
  if (by === "person") return options.people.map((p) => p.key);
  if (by === "account") return options.accounts.map((a) => a.key);
  if (by === "model") return options.models.map((m) => m.key);
  if (by === "client") return options.clients.map((c) => c.key);
  return ["total"];
}

export function colorFor(order: string[], key: string): string {
  if (key === OTHER_KEY) return OTHER_COLOR;
  const i = order.indexOf(key);
  return i >= 0 && i < CATEGORICAL.length ? CATEGORICAL[i] : OTHER_COLOR;
}

const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max", "default"];
export const sortEffort = <T extends { key: string }>(rows: T[]) =>
  [...rows].sort((a, b) => EFFORT_ORDER.indexOf(a.key) - EFFORT_ORDER.indexOf(b.key));

/** What a request's cost paid for, in a fixed color order. */
export const COST_PARTS = [
  { key: "cache_read", label: "Re-reading context", color: CATEGORICAL[0], hint: "Cache reads: the conversation so far, sent again with every request" },
  { key: "cache_write", label: "Writing to cache", color: CATEGORICAL[1], hint: "New or rebuilt context written to the prompt cache" },
  { key: "output", label: "Output", color: CATEGORICAL[2], hint: "Tokens the model generated, including thinking" },
  { key: "input", label: "Uncached input", color: CATEGORICAL[3], hint: "Input that was neither cached nor read from cache" },
] as const;
