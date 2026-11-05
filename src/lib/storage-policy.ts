/*
 * What telemetry is worth storing. Claude Code emits many diagnostic events and duplicate metrics
 * that no view reads; storing them filled the database within weeks. The same rules are applied
 * at ingest and by scripts/db-prune.mjs for rows stored before they existed.
 */

/** Events dropped at ingest: diagnostics with no analytic use. */
export const DROPPED_EVENTS = [
  "hook_execution_start", "hook_execution_complete", "hook_registered", "plugin_loaded",
  "managed_settings_resolved", "retention_sweep", "assistant_response", "feedback_survey",
];

/** Metrics kept. Token and cost counters duplicate api_request events and are dropped. */
export const STORED_METRICS = ["active_time.total", "lines_of_code.count", "commit.count", "pull_request.count"];

/**
 * Attribute keys removed from stored JSON: they are already columns, or describe the machine,
 * client or account and repeat on every record. Everything else is kept, so new event-specific
 * attributes are stored without code changes.
 */
export const REDUNDANT_ATTRS = [
  "service.name", "service.version", "host.arch", "host.name", "os.type", "os.version", "dev.name", "team",
  "ccm.device", "user.id", "user.email", "user.account_uuid", "user.account_id", "organization.id", "session.id",
  "terminal.type", "app.version", "app.entrypoint", "event.name", "event.timestamp", "event.sequence", "prompt.id",
  "request_id", "client_request_id", "message.uuid", "tool_use_id", "response", "prompt", "prompt_text", "model",
  "query_source", "cost_usd", "cost_usd_micros", "input_tokens", "output_tokens", "cache_read_tokens",
  "cache_creation_tokens", "duration_ms", "success", "tool_name", "error", "status_code",
];

const redundant = new Set(REDUNDANT_ATTRS);

export function slimAttrs(a: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) if (!redundant.has(k)) out[k] = v;
  return out;
}

/** Whether an event is stored. Tool decisions and MCP connections are kept only when they failed. */
export function isStoredEvent(name: string, attrs: Record<string, unknown>): boolean {
  if (DROPPED_EVENTS.includes(name)) return false;
  if (name === "tool_decision") return attrs["decision"] === "reject";
  if (name === "mcp_server_connection") return attrs["status"] === "failed";
  return true;
}
