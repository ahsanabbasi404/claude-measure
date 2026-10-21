# Claude Code usage monitor

Team analytics for Claude Code (CLI and the VS Code / Cursor / Windsurf extensions): who uses how much,
which Claude account and plan they use, how close each account is to its weekly limit, and how
efficiently each person works.

```
Developer machine                                   Vercel (this app)                 Neon Postgres
 Claude Code ── built-in OpenTelemetry (http/json) ─► /v1/logs, /v1/metrics ─────────► events, metric_points
 ccm statusline ─ weekly / 5-hour limit % ──────────► /api/limits ───────────────────► limit_snapshots, accounts
 ccm hook (session start) ─ heartbeat, self-update ─► /api/client/heartbeat ─────────► devices
                                                       dashboard pages, poll every 15 s
```

## What is collected

| Data | Source |
|---|---|
| Tokens (input, output, cache read/write), API-equivalent cost, model, latency | Claude Code telemetry, every request |
| Claude account email and account id | Claude Code telemetry (the signed-in account, per request) |
| Plan tier (Max 5x / 20x, Pro) | Agent reads `~/.claude.json` |
| Weekly and 5-hour limit usage | Status line input, forwarded at most once a minute per session |
| Prompts (length only), tool calls, failures, rejected tool uses | Claude Code telemetry |
| Compactions (manual / automatic, tokens before and after) | Claude Code telemetry |
| API errors, HTTP 429 rate limiting, retries | Claude Code telemetry |
| Active time, lines changed, commits, pull requests | Claude Code telemetry |
| Person name and team | Entered once at install |

Prompt text, responses and tool arguments are **not** collected (Claude Code redacts them by default).

## Server setup

1. Create a Neon Postgres database (Vercel → Storage → Neon) and copy the pooled connection string.
2. Copy `.env.example` to `.env.local` and fill in the values. Generate random secrets with
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Create the tables: `npm install && npm run db:setup` (safe to re-run after updates).
4. Run locally: `npm run dev`, then open http://localhost:3000.

### Deploy to Vercel

1. Push the repository and import it in Vercel.
2. Add the same environment variables in Project → Settings → Environment Variables:
   `DATABASE_URL`, `INGEST_TOKEN`, `DASHBOARD_PASSWORD`, `AUTH_SECRET`, `CRON_SECRET`, and optionally `RETENTION_DAYS`.
3. Deploy. `vercel.json` schedules a daily job that refreshes fallback model prices and applies `RETENTION_DAYS`.
4. Check `https://<your-app>/api/health`; it reports any missing variable and whether the database is reachable.

## Installing on developer machines

Open **Setup & devices** in the dashboard and copy the command for the platform. It contains the
access token, so share it privately.

- macOS / Linux / WSL: `curl -fsSL https://<app>/install.sh | sudo bash -s -- --token <TOKEN>`
- Windows (PowerShell): `powershell -ExecutionPolicy Bypass -c "& ([scriptblock]::Create((irm 'https://<app>/install.ps1'))) -Token <TOKEN>"`

The installer asks for the person's name and team. It then:

1. verifies the server and token before changing anything;
2. installs the agent (`/opt/ccm`, `/Library/Application Support/ClaudeCode/ccm`, or `C:\Program Files\ClaudeCode\ccm`) and a `ccm` command;
3. writes Claude Code **managed settings** (`managed-settings.json`, or a `managed-settings.d/` drop-in when the
   organization already has one) so users cannot switch telemetry off;
4. keeps an existing custom status line and shows it above the usage line;
5. runs `ccm doctor` and prints a fix for every failed check.

Developers restart Claude Code (exit `claude`, reload IDE windows) after installing. Re-running the
installer is safe; it keeps the device id, name and team. To change the dashboard URL (for example from
localhost to Vercel), run the install command from the new deployment.

### `ccm` commands

| Command | Purpose |
|---|---|
| `ccm doctor` | Checks the install, Claude Code versions, account, server, token, telemetry pipeline and status line |
| `ccm update` | Downloads the latest agent now (it also happens automatically) |
| `ccm version` | Prints the agent version |
| `sudo ccm uninstall` / `ccm uninstall` (Administrator) | Removes the agent and its managed settings |

### Updates without reinstalling

The installed script is a launcher. At each session start the agent sends a heartbeat; when the server
has a newer agent it downloads it to `~/.ccm/agent`, verifies its SHA-256, and the launcher runs it from then on.
To roll out an agent change, edit `client/agent/ccm.sh` / `ccm.ps1`, bump `CCM_AGENT_VERSION`, and deploy.

Changes to the generated Claude Code settings (`src/lib/client-settings.ts`) need administrator rights on each
machine, so they cannot be applied silently. Bump `SETTINGS_VERSION` in `src/lib/client-files.ts`. Devices on older
settings then show "Re-run installer" on the Setup page and a notice in their status line.

## Reading the dashboard

Every page shares one filter bar: a time range (today, yesterday, last 24 hours, 7/14/30/90 days, or a custom
range) and filters for person, Claude account, team, model and client. Filters live in the URL, so a filtered view
can be bookmarked or shared, and links between pages keep them. Days are calendar days in the viewer's timezone,
and every range is compared with the previous period of the same length.

| Page | Shows |
|---|---|
| **Overview** | Totals with change vs the previous period, usage over time (split by person, account, model, client or purpose), who is active right now, attention items, account limits, people, models, effort levels, a weekday × hour heatmap, errors and the most expensive sessions |
| **People** / **person** | Everyone with usage, trend, daily sparkline, efficiency, limits, cost per active day and per prompt, context size and Opus share. A person's page adds comparisons with the team median, accounts used, efficiency breakdown, sessions, tools, errors, activity and machines |
| **Accounts** / **account** | Each Claude account's plan, weekly and 5-hour limits, real-time burn (last hour, 5 hours, 24 hours, 7 days) and who draws from it. An account's page adds limit history, a per-person split and its sessions |
| **Sessions** / **session** | Sessions sortable by value, duration, context and prompts. A session's page charts context size per request (compactions marked), cumulative value, and the cost of each prompt with the tools it used |
| **Activity** | Live feed of prompts, expensive requests, compactions, sign-ins and failures, plus grouped errors |

- **Usage value** is the API-equivalent cost Claude Code reports per request. Max plans are not billed per
  token; this value is the most consistent measure of how much limit a person consumes. New models are
  priced by Claude Code itself; the server only fills in prices from a public list when a request arrives without one.
- **Weekly limit** comes from the latest status line snapshot of each account. The tick on the bar marks the
  percentage the account reaches at reset if the pace since the window started continues. *Runs out early*
  means that point is past 100% before the reset.
- **Purpose** splits usage into the conversation itself, subagents, compaction, web search/fetch processing and
  background work (session titles, summaries).
- **Efficiency (0–100)** combines five parts, each shown with its value on the person's page:
  cache reuse (20%), context size per main-conversation request (25%), lines changed per dollar relative to the
  team median (25%), errors and rejected tool uses (15%), and auto-compactions per session (15%). People with fewer
  than 15 requests in the period show *Not enough data*.
- **Attention items** cover projected limit exhaustion, accounts above 80% of their weekly or 5-hour limit, rate
  limiting, "credit balance too low" errors, shared accounts, account switching, heavy users (above 2.5× the team
  median), single-day spikes, very large contexts (relative to the team), frequent auto-compaction, low cache reuse,
  max-effort and subagent-heavy usage, unusually expensive sessions, low efficiency and outdated Claude Code versions.

## Limitations

- Weekly and 5-hour limit percentages are only available through Claude Code's status line. They appear
  after a session's first response, in clients that run the status line (the terminal CLI). Telemetry
  from every client, including IDE extensions, still records full usage per account.
- A person can avoid monitoring by using a machine without the agent. The Setup page flags known devices
  whose heartbeats continue without telemetry.
- `ccm doctor` requires Claude Code 2.1.200 or later for every check to be meaningful; older versions are flagged.

## Project layout

```
client/              Scripts served to developer machines
  agent/ccm.sh       Agent for macOS / Linux / WSL (bash 3.2 compatible)
  agent/ccm.ps1      Agent for Windows (PowerShell 5.1 compatible)
  install.sh         Installer for macOS / Linux / WSL
  install.ps1        Installer for Windows
db/schema.sql        Database schema (idempotent)
scripts/db-setup.mjs Applies the schema
src/app/v1/*         OTLP/HTTP JSON receivers
src/app/api/*        Analytics (overview, people, accounts, sessions, activity, options), limits,
                     client (agent, settings, heartbeat, check), devices, auth, cron
src/app/install.*    Serves the installers with the deployment URL filled in
src/lib/             Parsing, pricing, filters, queries, insights, settings generation
src/components/      Dashboard UI
```
