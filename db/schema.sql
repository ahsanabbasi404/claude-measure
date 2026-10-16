-- Claude Code telemetry store. Safe to run repeatedly.

-- One row per OpenTelemetry log record (Claude Code "event").
CREATE TABLE IF NOT EXISTS events (
  id                     BIGSERIAL PRIMARY KEY,
  ts                     TIMESTAMPTZ NOT NULL,
  received_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_name             TEXT NOT NULL,
  session_id             TEXT,
  prompt_id              TEXT,
  user_email             TEXT,
  account_uuid           TEXT,
  user_id                TEXT,
  organization_id        TEXT,
  dev_name               TEXT,
  team                   TEXT,
  host_name              TEXT,
  os_type                TEXT,
  entrypoint             TEXT,
  terminal_type          TEXT,
  app_version            TEXT,
  model                  TEXT,
  query_source           TEXT,
  cost_usd               DOUBLE PRECISION,
  input_tokens           BIGINT,
  output_tokens          BIGINT,
  cache_read_tokens      BIGINT,
  cache_creation_tokens  BIGINT,
  duration_ms            DOUBLE PRECISION,
  success                BOOLEAN,
  tool_name              TEXT,
  error                  TEXT,
  status_code            TEXT,
  attrs                  JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS events_ts_idx         ON events (ts DESC);
CREATE INDEX IF NOT EXISTS events_name_ts_idx    ON events (event_name, ts DESC);
CREATE INDEX IF NOT EXISTS events_email_ts_idx   ON events (user_email, ts DESC);
CREATE INDEX IF NOT EXISTS events_dev_ts_idx     ON events (dev_name, ts DESC);
CREATE INDEX IF NOT EXISTS events_session_idx    ON events (session_id);

-- One row per OpenTelemetry metric data point (delta temporality: each value is an increment).
CREATE TABLE IF NOT EXISTS metric_points (
  id            BIGSERIAL PRIMARY KEY,
  ts            TIMESTAMPTZ NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  metric_name   TEXT NOT NULL,
  value         DOUBLE PRECISION NOT NULL,
  unit          TEXT,
  temporality   TEXT,
  kind          TEXT,          -- metric-specific "type" attribute (input/output/added/user/...)
  model         TEXT,
  session_id    TEXT,
  user_email    TEXT,
  account_uuid  TEXT,
  dev_name      TEXT,
  team          TEXT,
  host_name     TEXT,
  entrypoint    TEXT,
  attrs         JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS metric_points_name_ts_idx ON metric_points (metric_name, ts DESC);
CREATE INDEX IF NOT EXISTS metric_points_dev_ts_idx  ON metric_points (dev_name, ts DESC);
CREATE INDEX IF NOT EXISTS metric_points_email_idx   ON metric_points (user_email, ts DESC);

-- Snapshots posted by the status line forwarder (subscription rate-limit windows, context usage).
CREATE TABLE IF NOT EXISTS limit_snapshots (
  id                   BIGSERIAL PRIMARY KEY,
  ts                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id           TEXT,
  dev_name             TEXT,
  team                 TEXT,
  host_name            TEXT,
  os_type              TEXT,
  model                TEXT,
  app_version          TEXT,
  five_hour_pct        DOUBLE PRECISION,
  five_hour_resets_at  TIMESTAMPTZ,
  seven_day_pct        DOUBLE PRECISION,
  seven_day_resets_at  TIMESTAMPTZ,
  context_pct          DOUBLE PRECISION,
  session_cost_usd     DOUBLE PRECISION,
  raw                  JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS limit_snapshots_ts_idx      ON limit_snapshots (ts DESC);
CREATE INDEX IF NOT EXISTS limit_snapshots_session_idx ON limit_snapshots (session_id, ts DESC);
CREATE INDEX IF NOT EXISTS limit_snapshots_dev_idx     ON limit_snapshots (dev_name, ts DESC);

-- Installed agents, one row per machine. Updated by heartbeats and doctor runs.
CREATE TABLE IF NOT EXISTS devices (
  device_id         TEXT PRIMARY KEY,
  dev_name          TEXT,
  team              TEXT,
  host_name         TEXT,
  os_type           TEXT,
  os_version        TEXT,
  agent_version     INTEGER,
  settings_version  INTEGER,
  claude_versions   JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_seen        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_check        JSONB,
  last_check_at     TIMESTAMPTZ
);

ALTER TABLE events          ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE metric_points   ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE limit_snapshots ADD COLUMN IF NOT EXISTS device_id TEXT;
CREATE INDEX IF NOT EXISTS events_device_ts_idx ON events (device_id, ts DESC);

-- Fallback per-model prices (USD per million tokens), used only when a request arrives without cost_usd.
CREATE TABLE IF NOT EXISTS model_prices (
  model              TEXT PRIMARY KEY,
  input_per_mtok     DOUBLE PRECISION,
  output_per_mtok    DOUBLE PRECISION,
  cache_read_per_mtok  DOUBLE PRECISION,
  cache_write_per_mtok DOUBLE PRECISION,
  source             TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE limit_snapshots ADD COLUMN IF NOT EXISTS user_email TEXT;
CREATE INDEX IF NOT EXISTS limit_snapshots_email_idx ON limit_snapshots (user_email, ts DESC);

-- Claude accounts seen on devices (from the signed-in account in ~/.claude.json), with plan tier.
CREATE TABLE IF NOT EXISTS accounts (
  user_email         TEXT PRIMARY KEY,
  account_uuid       TEXT,
  organization_type  TEXT,
  rate_limit_tier    TEXT,
  display_name       TEXT,
  first_seen         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_device_id     TEXT,
  last_dev_name      TEXT
);

-- Dashboard login attempts, used for brute-force protection.
CREATE TABLE IF NOT EXISTS login_attempts (
  id       BIGSERIAL PRIMARY KEY,
  ts       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip       TEXT NOT NULL,
  success  BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_ip_ts_idx ON login_attempts (ip, ts DESC);
CREATE INDEX IF NOT EXISTS login_attempts_ts_idx ON login_attempts (ts DESC);
