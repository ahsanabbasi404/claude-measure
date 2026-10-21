import type postgres from "postgres";

/*
 * Dashboard filters, shared by every analytics endpoint. Ranges are calendar based in the viewer's
 * timezone, so a "day" on the dashboard is a local day, and every range has an equally long
 * previous period for comparisons.
 */

export const RANGE_KEYS = ["today", "yesterday", "24h", "7d", "14d", "30d", "90d", "custom"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];
export type Bucket = "hour" | "day";

export type Filters = {
  range: RangeKey;
  tz: string;
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  bucket: Bucket;
  /** Local calendar dates (YYYY-MM-DD) of the range bounds, for labels. */
  fromDate: string;
  toDate: string;
  people: string[];
  accounts: string[];
  teams: string[];
  models: string[];
  clients: string[];
};

const MAX_CUSTOM_DAYS = 366;
const DAY_MS = 86400_000;

export function validTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** Wall-clock parts of an instant in a timezone. */
function zonedParts(t: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

/** UTC instant of local midnight for a calendar date in a timezone (DST-safe). */
function zonedMidnight(y: number, m: number, d: number, tz: string): Date {
  const wall = Date.UTC(y, m - 1, d);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, tz);
    const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - guess;
    guess = wall - offset;
  }
  return new Date(guess);
}

const isoDate = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * DAY_MS;
  const d = new Date(t);
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function midnightOf(date: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return zonedMidnight(y, m, d, tz);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function list(params: URLSearchParams, key: string): string[] {
  return [...new Set(params.getAll(key).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean))].slice(0, 50);
}

export function parseFilters(params: URLSearchParams, now = Date.now()): Filters {
  const tz = validTimeZone(params.get("tz"));
  const requested = params.get("range") as RangeKey | null;
  let range: RangeKey = requested && RANGE_KEYS.includes(requested) ? requested : "7d";

  const p = zonedParts(now, tz);
  const today = isoDate(p.y, p.m, p.d);
  let fromDate = today;
  let toDate = today;
  let from: Date;
  let to: Date;

  if (range === "24h") {
    to = new Date(now);
    from = new Date(now - DAY_MS);
    const fp = zonedParts(from.getTime(), tz);
    fromDate = isoDate(fp.y, fp.m, fp.d);
  } else {
    if (range === "custom") {
      const f = params.get("from");
      const t = params.get("to");
      if (f && t && DATE_RE.test(f) && DATE_RE.test(t) && f <= t) {
        fromDate = f;
        toDate = t > today ? today : t;
        if (fromDate > toDate) fromDate = toDate;
        if ((Date.parse(toDate) - Date.parse(fromDate)) / DAY_MS > MAX_CUSTOM_DAYS) fromDate = addDays(toDate, -MAX_CUSTOM_DAYS);
      } else {
        range = "7d";
      }
    }
    if (range === "yesterday") {
      fromDate = toDate = addDays(today, -1);
    } else if (range !== "custom" && range !== "today") {
      const days = Number(range.replace("d", ""));
      fromDate = addDays(today, -(days - 1));
    }
    from = midnightOf(fromDate, tz);
    // The current day ends now; later days have no data yet.
    to = toDate === today ? new Date(now) : midnightOf(addDays(toDate, 1), tz);
  }

  const days = range === "24h" ? 1 : (Date.parse(toDate) - Date.parse(fromDate)) / DAY_MS + 1;
  const bucket: Bucket = days <= 2 ? "hour" : "day";
  // The comparison period has the same calendar length, ending where this one starts.
  const prevTo = from;
  const prevFrom = range === "24h" ? new Date(from.getTime() - DAY_MS) : midnightOf(addDays(fromDate, -days), tz);

  return {
    range, tz, from, to, prevFrom, prevTo, bucket, fromDate, toDate,
    people: list(params, "person"),
    accounts: list(params, "account"),
    teams: list(params, "team"),
    models: list(params, "model"),
    clients: list(params, "client"),
  };
}

/** Person identity: the name entered at install, falling back to the host name. */
export const PERSON_SQL = `coalesce(dev_name, host_name, '(unnamed)')`;
export const TOKENS_SQL = `coalesce(input_tokens, 0) + coalesce(output_tokens, 0) + coalesce(cache_read_tokens, 0) + coalesce(cache_creation_tokens, 0)`;
/** Tokens a request sends as context (everything but the response). */
export const CONTEXT_SQL = `coalesce(input_tokens, 0) + coalesce(cache_read_tokens, 0) + coalesce(cache_creation_tokens, 0)`;
/** What a request was for: the conversation itself, a subagent, compaction, web tools or background work. */
export const USAGE_KIND_SQL = `CASE
  WHEN query_source IS NULL OR query_source IN ('sdk', 'repl_main_thread') THEN 'main'
  WHEN query_source LIKE 'agent:%' THEN 'subagent'
  WHEN query_source = 'compact' THEN 'compaction'
  WHEN query_source LIKE 'web_%' THEN 'web'
  ELSE 'background' END`;
export const CLIENT_SQL = `coalesce(entrypoint, 'unknown')`;

export type ScopeOptions = {
  /** Use the comparison period instead of the selected one. */
  previous?: boolean;
  /** metric_points has no reliable model on every metric; skip the model filter there. */
  ignoreModel?: boolean;
  /** Extra exact-match restrictions applied on top of the user's filters (detail pages). */
  person?: string;
  account?: string;
  session?: string;
};

/** WHERE clause body for events or metric_points (both share the filtered columns). */
export function scope(sql: postgres.Sql, f: Filters, o: ScopeOptions = {}) {
  const from = o.previous ? f.prevFrom : f.from;
  const to = o.previous ? f.prevTo : f.to;
  const person = sql.unsafe(PERSON_SQL);
  const parts = [sql`ts >= ${from} AND ts < ${to}`];
  if (f.people.length) parts.push(sql`${person} = ANY(${f.people})`);
  if (f.accounts.length) parts.push(sql`user_email = ANY(${f.accounts})`);
  if (f.teams.length) parts.push(sql`team = ANY(${f.teams})`);
  if (f.models.length && !o.ignoreModel) parts.push(sql`model = ANY(${f.models})`);
  if (f.clients.length) parts.push(sql`${sql.unsafe(CLIENT_SQL)} = ANY(${f.clients})`);
  if (o.person !== undefined) parts.push(sql`${person} = ${o.person}`);
  if (o.account !== undefined) parts.push(sql`user_email = ${o.account}`);
  if (o.session !== undefined) parts.push(sql`session_id = ${o.session}`);
  return parts.reduce((acc, p) => sql`${acc} AND ${p}`);
}

export const hasDimensionFilter = (f: Filters) =>
  f.people.length + f.accounts.length + f.teams.length + f.models.length + f.clients.length > 0;

/** Range metadata echoed to the client so charts can lay out every bucket, including empty ones. */
export function rangeInfo(f: Filters) {
  return {
    range: f.range, tz: f.tz, bucket: f.bucket,
    from: f.from.toISOString(), to: f.to.toISOString(),
    prevFrom: f.prevFrom.toISOString(), prevTo: f.prevTo.toISOString(),
    fromDate: f.fromDate, toDate: f.toDate,
    buckets: bucketKeys(f),
  };
}

/** Every bucket key in the range, formatted as the SQL bucket expression formats them. */
export function bucketKeys(f: Filters): string[] {
  const keys: string[] = [];
  if (f.bucket === "day") {
    for (let d = f.fromDate; d <= f.toDate; d = addDays(d, 1)) keys.push(d);
    return keys;
  }
  const seen = new Set<string>();
  for (let t = f.from.getTime(); t < f.to.getTime(); t += 3600_000) {
    const p = zonedParts(t, f.tz);
    const key = `${isoDate(p.y, p.m, p.d)}T${String(p.h).padStart(2, "0")}`;
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/** SQL expression producing the bucket key of `ts` in the viewer's timezone. */
export function bucketSql(sql: postgres.Sql, f: Filters, column = "ts") {
  const fmt = f.bucket === "day" ? "YYYY-MM-DD" : `YYYY-MM-DD"T"HH24`;
  return sql`to_char(${sql.unsafe(column)} AT TIME ZONE ${f.tz}, ${fmt})`;
}

/** Local calendar day of `ts`, always day-granular (sparklines, spike detection). */
export function daySql(sql: postgres.Sql, f: Filters, column = "ts") {
  return sql`to_char(${sql.unsafe(column)} AT TIME ZONE ${f.tz}, 'YYYY-MM-DD')`;
}

export function dayKeys(f: Filters): string[] {
  const keys: string[] = [];
  for (let d = f.fromDate; d <= f.toDate; d = addDays(d, 1)) keys.push(d);
  return keys;
}
