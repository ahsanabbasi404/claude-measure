export type Range = "24h" | "7d" | "30d";
export type Severity = "critical" | "serious" | "warning" | "info";

export type Weekly = {
  pct: number;
  resetsAt: string;
  asOf: string;
  projectedPct: number | null;
  hitsLimitAt: string | null;
  pacePerDay: number | null;
} | null;

export type ScorePart = { key: string; label: string; score: number; value: string; hint: string; weight: number };

export type Developer = {
  dev: string;
  team: string | null;
  emails: string[];
  models: string[];
  entrypoints: string[];
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
  api_errors: number;
  rate_limited: number;
  compactions: number;
  auto_compactions: number;
  tool_calls: number;
  tool_failures: number;
  rejections: number;
  last_seen: string;
  active_seconds: number;
  lines_added: number;
  lines_removed: number;
  commits: number;
  pull_requests: number;
  share: number;
  cost_per_active_hour: number | null;
  cost_per_prompt: number | null;
  cache_hit: number | null;
  avg_context: number | null;
  efficiency: { score: number | null; label: string; parts: ScorePart[] };
  weekly: Weekly;
};

export type Account = {
  user_email: string;
  plan: string | null;
  devs: string[];
  sessions: number;
  requests: number;
  total_tokens: number;
  cost_usd: number;
  cost_7d: number;
  rate_limited: number;
  last_seen: string | null;
  five_hour: { pct: number; resetsAt: string; asOf: string } | null;
  weekly: Weekly;
};

export type Insight = { severity: Severity; title: string; detail: string; subject: string; kind: string };

export type SeriesPoint = { bucket: string; requests: number; total_tokens: number; cost_usd: number };

export type Stats = {
  range: Range;
  bucket: "hour" | "day";
  since: string;
  generatedAt: string;
  totals: {
    cost_usd: number;
    tokens: number;
    output_tokens: number;
    requests: number;
    prompts: number;
    sessions: number;
    active_seconds: number;
    compactions: number;
    auto_compactions: number;
    api_errors: number;
    rate_limited: number;
    tool_calls: number;
    tool_failures: number;
    rejections: number;
    lines_changed: number;
    cache_hit: number | null;
    developers: number;
    accounts: number;
    active_now: number;
  };
  insights: Insight[];
  developers: Developer[];
  accounts: Account[];
  models: {
    model: string;
    label: string;
    requests: number;
    total_tokens: number;
    output_tokens: number;
    cost_usd: number;
    developers: number;
  }[];
  series: SeriesPoint[];
  devSeries: (SeriesPoint & { dev: string })[];
  devModels: { dev: string; model: string; label: string; requests: number; total_tokens: number; cost_usd: number }[];
  errors: {
    event_name: string;
    status_code: string;
    error: string;
    count: number;
    last_seen: string;
    devs: string[];
  }[];
  feed: {
    id: string;
    ts: string;
    event_name: string;
    dev: string | null;
    user_email: string | null;
    model: string | null;
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
  }[];
};
