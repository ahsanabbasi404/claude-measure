export type Severity = "critical" | "serious" | "warning" | "info";
export type Bucket = "hour" | "day";
export type Breakdown = "none" | "person" | "account" | "model" | "client" | "kind";

export type RangeInfo = {
  range: string;
  tz: string;
  bucket: Bucket;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  fromDate: string;
  toDate: string;
  buckets: string[];
  generatedAt: string;
};

export type Weekly = {
  pct: number;
  resetsAt: string;
  asOf: string;
  projectedPct: number | null;
  hitsLimitAt: string | null;
  pacePerDay: number | null;
} | null;

export type ScorePart = { key: string; label: string; score: number; value: string; hint: string; weight: number };
export type Efficiency = { score: number | null; label: string; parts: ScorePart[] };

export type Person = {
  dev: string;
  team: string | null;
  emails: string[];
  models: string[];
  clients: string[];
  app_versions: string[];
  hosts: string[];
  sessions: number;
  prompts: number;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
  subagent_cost_usd: number;
  opus_cost_usd: number;
  max_effort_requests: number;
  main_requests: number;
  main_context: number;
  peak_context: number | null;
  api_errors: number;
  rate_limited: number;
  credit_errors: number;
  compactions: number;
  auto_compactions: number;
  tool_calls: number;
  tool_failures: number;
  rejections: number;
  active_days: number;
  first_seen: string | null;
  last_seen: string | null;
  active_seconds: number;
  lines_added: number;
  lines_removed: number;
  commits: number;
  pull_requests: number;
  share: number;
  prev_cost_usd: number;
  cost_per_active_hour: number | null;
  cost_per_prompt: number | null;
  cost_per_active_day: number | null;
  peak_day_cost: number;
  cache_hit: number | null;
  avg_context: number | null;
  opus_share: number | null;
  subagent_share: number | null;
  max_effort_share: number | null;
  efficiency: Efficiency;
  weekly: Weekly;
  daily: Record<string, number>;
};

export type Burn = { cost_1h: number; cost_5h: number; cost_24h: number; cost_7d: number; cost_window: number | null };

export type Account = {
  user_email: string;
  plan: string | null;
  display_name: string | null;
  weekly: Weekly;
  five_hour: { pct: number; resetsAt: string | null; asOf: string } | null;
  never_reported: boolean;
  sessions: number;
  prompts: number;
  requests: number;
  total_tokens: number;
  cost_usd: number;
  opus_cost_usd: number;
  share: number;
  rate_limited: number;
  clients: string[];
  first_seen: string | null;
  last_seen: string | null;
  people: { dev: string; cost_usd: number; requests: number; sessions: number; last_seen: string | null }[];
  burn: Burn;
};

export type Insight = {
  severity: Severity;
  kind: string;
  category: "limits" | "heavy-use" | "waste" | "errors" | "setup";
  title: string;
  detail: string;
  subject: string;
  subjectType: "person" | "account" | "session";
};

export type SeriesRow = { bucket: string; key: string; cost_usd: number; tokens: number; requests: number };

export type Totals = {
  cost_usd: number;
  tokens: number;
  requests: number;
  prompts: number;
  sessions: number;
  people: number;
  api_errors: number;
  rate_limited: number;
  auto_compactions: number;
  cache_hit: number | null;
  active_seconds: number;
  lines_changed: number;
};

export type Keyed = { key: string; requests: number; cost_usd: number };
export type Mix = {
  models: (Keyed & { label: string; tokens: number; output_tokens: number; people: number; avg_ms: number })[];
  effort: Keyed[];
  kinds: (Keyed & { avg_context: number })[];
  clients: (Keyed & { people: number })[];
  agents: Keyed[];
  tools: { key: string; calls: number; failures: number; avg_ms: number; result_bytes: number }[];
};

export type Session = {
  session_id: string;
  dev: string;
  user_email: string | null;
  client: string | null;
  models: { id: string; label: string }[];
  first_ts: string;
  last_ts: string;
  duration_s: number;
  prompts: number;
  requests: number;
  cost_usd: number;
  tokens: number;
  peak_context: number | null;
  compactions: number;
  auto_compactions: number;
  errors: number;
  rate_limited: number;
  subagent_requests: number;
};

export type ErrorGroup = {
  event_name: string;
  status_code: string;
  error: string;
  count: number;
  last_seen: string;
  people: string[];
  tools: string[];
};

export type FeedItem = {
  id: string;
  ts: string;
  event_name: string;
  dev: string | null;
  user_email: string | null;
  model: string | null;
  session_id: string | null;
  tokens: number;
  cost_usd: number | null;
  tool_name: string | null;
  success: boolean | null;
  error: string | null;
  status_code: string | null;
  duration_ms: number | null;
  trigger: string | null;
  pre_tokens: string | null;
  post_tokens: string | null;
  prompt_length: string | null;
  command_name: string | null;
  agent_type: string | null;
  action: string | null;
};

export type LivePerson = {
  dev: string;
  last_seen: string;
  cost_1h: number;
  cost_15m: number;
  requests_1h: number;
  user_email: string | null;
  model: string | null;
  session_id: string | null;
  client: string | null;
};

export type HeatCell = { dow: number; hour: number; cost_usd: number; requests: number };

export type Overview = RangeInfo & Mix & {
  by: Breakdown;
  totals: Totals & {
    output_tokens: number;
    known_people: number;
    accounts: number;
    commits: number;
    compactions: number;
    tool_calls: number;
    tool_failures: number;
    rejections: number;
    subagent_cost_usd: number;
    opus_cost_usd: number;
  };
  previous: Totals;
  series: SeriesRow[];
  insights: Insight[];
  people: Person[];
  accounts: Account[];
  heatmap: HeatCell[];
  sessions: Session[];
  live: LivePerson[];
  errors: ErrorGroup[];
};

export type PeopleResponse = RangeInfo & { people: Person[] };

export type PersonDetail = RangeInfo & Mix & {
  name: string;
  by: Breakdown;
  person: Person | null;
  previous: Totals;
  team: {
    people: number;
    median: Record<"cost_usd" | "cost_per_prompt" | "cost_per_active_day" | "avg_context" | "cache_hit" | "efficiency" | "opus_share", number | null>;
    rank: { usage: number | null; efficiency: number | null };
  };
  accounts: (Account & { person_cost_usd: number })[];
  series: SeriesRow[];
  heatmap: HeatCell[];
  sessions: { top: Session[]; recent: Session[] };
  errors: ErrorGroup[];
  activity: FeedItem[];
  devices: { device_id: string; host_name: string | null; os_type: string | null; os_version: string | null; agent_version: number | null; last_heartbeat: string; first_seen: string }[];
  insights: Insight[];
};

export type AccountsResponse = RangeInfo & { accounts: Account[]; series: SeriesRow[] };

export type AccountDetail = RangeInfo & Mix & {
  email: string;
  by: Breakdown;
  account: Account | null;
  meta: { account_uuid: string | null; organization_type: string | null; rate_limit_tier: string | null; first_seen: string; last_seen: string; last_dev_name: string | null } | null;
  previous: Totals;
  people: Person[];
  series: SeriesRow[];
  heatmap: HeatCell[];
  sessions: Session[];
  errors: ErrorGroup[];
  history: { ts: string; weekly: number | null; five_hour: number | null; dev: string | null }[];
  insights: Insight[];
};

export type SessionsResponse = RangeInfo & {
  sort: string;
  sessions: Session[];
  summary: { count: number; median_cost: number | null; median_duration_s: number | null; median_peak_context: number | null };
};

export type SessionDetail = Mix & {
  generatedAt: string;
  session: Session | null;
  requests: {
    ts: string; model: string | null; kind: string; context: number; output_tokens: number; cost_usd: number;
    cumulative_cost: number; duration_ms: number; effort: string | null; agent: string | null; prompt_id: string | null;
  }[];
  prompts: {
    prompt_id: string; ts: string; last_ts: string; prompt_length: number | null; command_name: string | null;
    requests: number; cost_usd: number; peak_context: number | null; tool_calls: number; tool_failures: number;
    tools: string[]; subagent_requests: number;
  }[];
  compactions: { ts: string; trigger: string | null; pre_tokens: number | null; post_tokens: number | null; error: string | null }[];
  errors: ErrorGroup[];
};

export type ActivityResponse = RangeInfo & { feed: FeedItem[]; errors: ErrorGroup[]; live: LivePerson[] };

export type Options = {
  people: { key: string; team: string | null }[];
  accounts: { key: string }[];
  teams: { key: string }[];
  models: { key: string; label: string }[];
  clients: { key: string }[];
};
