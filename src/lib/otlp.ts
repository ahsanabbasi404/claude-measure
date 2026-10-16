import { gunzipSync, inflateSync } from "node:zlib";

/*
 * Minimal OTLP/HTTP JSON decoding for Claude Code telemetry.
 * Claude Code must be configured with OTEL_EXPORTER_OTLP_PROTOCOL=http/json.
 * Spec: https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding
 */

type AnyValue = {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number;
  doubleValue?: number;
  arrayValue?: { values?: AnyValue[] };
  kvlistValue?: { values?: KeyValue[] };
  bytesValue?: string;
};
type KeyValue = { key: string; value?: AnyValue };
type Attrs = Record<string, unknown>;

export class UnsupportedEncodingError extends Error {}

/** Reads the request body as JSON, handling gzip/deflate and rejecting protobuf. */
export async function readOtlpJson(req: Request): Promise<unknown> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("protobuf")) {
    throw new UnsupportedEncodingError(
      "Protobuf is not supported. Set OTEL_EXPORTER_OTLP_PROTOCOL=http/json on the client.",
    );
  }
  let buf: Buffer = Buffer.from(await req.arrayBuffer());
  const encoding = (req.headers.get("content-encoding") ?? "").toLowerCase();
  if (encoding === "gzip") buf = gunzipSync(buf);
  else if (encoding === "deflate") buf = inflateSync(buf);
  return buf.length ? JSON.parse(buf.toString("utf8")) : {};
}

function anyValue(v: AnyValue | undefined): unknown {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.boolValue !== undefined) return v.boolValue;
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(anyValue);
  if (v.kvlistValue) return toAttrs(v.kvlistValue.values);
  if (v.bytesValue !== undefined) return v.bytesValue;
  return null;
}

function toAttrs(list: KeyValue[] | undefined): Attrs {
  const out: Attrs = {};
  for (const kv of list ?? []) out[kv.key] = anyValue(kv.value);
  return out;
}

function nanosToDate(...candidates: (string | number | undefined)[]): Date {
  for (const c of candidates) {
    if (c === undefined || c === null) continue;
    let ms = 0;
    try {
      ms = Number(BigInt(String(c)) / BigInt(1_000_000));
    } catch {
      ms = Math.floor(Number(c) / 1_000_000);
    }
    if (Number.isFinite(ms) && ms > 0) return new Date(ms);
  }
  return new Date();
}

const str = (v: unknown): string | null =>
  v === undefined || v === null || v === "" ? null : String(v);

const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const bool = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
};

/** Resource attribute values may arrive percent-encoded (spaces are not allowed in OTEL_RESOURCE_ATTRIBUTES). */
function decoded(v: unknown): string | null {
  const s = str(v);
  if (s === null) return null;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Fields shared by events and metric points, taken from merged resource + record attributes. */
function identity(a: Attrs) {
  return {
    session_id: str(a["session.id"]),
    user_email: str(a["user.email"])?.toLowerCase() ?? null,
    account_uuid: str(a["user.account_uuid"]),
    dev_name: decoded(a["dev.name"]),
    team: decoded(a["team"]),
    host_name: decoded(a["host.name"]),
    entrypoint: str(a["app.entrypoint"]),
    device_id: str(a["ccm.device"]),
  };
}

export type EventRow = ReturnType<typeof identity> & {
  ts: Date;
  event_name: string;
  prompt_id: string | null;
  user_id: string | null;
  organization_id: string | null;
  os_type: string | null;
  terminal_type: string | null;
  app_version: string | null;
  model: string | null;
  query_source: string | null;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  duration_ms: number | null;
  success: boolean | null;
  tool_name: string | null;
  error: string | null;
  status_code: string | null;
  attrs: Attrs;
};

type LogsPayload = {
  resourceLogs?: {
    resource?: { attributes?: KeyValue[] };
    scopeLogs?: {
      logRecords?: {
        timeUnixNano?: string;
        observedTimeUnixNano?: string;
        body?: AnyValue;
        attributes?: KeyValue[];
      }[];
    }[];
  }[];
};

export function parseLogs(payload: unknown): EventRow[] {
  const rows: EventRow[] = [];
  for (const rl of (payload as LogsPayload).resourceLogs ?? []) {
    const resource = toAttrs(rl.resource?.attributes);
    for (const sl of rl.scopeLogs ?? []) {
      for (const rec of sl.logRecords ?? []) {
        const a: Attrs = { ...resource, ...toAttrs(rec.attributes) };
        const body = anyValue(rec.body);
        const rawName = str(a["event.name"]) ?? (typeof body === "string" ? body : null) ?? "unknown";
        rows.push({
          ...identity(a),
          ts: nanosToDate(rec.timeUnixNano, rec.observedTimeUnixNano),
          event_name: rawName.replace(/^claude_code\./, ""),
          prompt_id: str(a["prompt.id"]),
          user_id: str(a["user.id"]),
          organization_id: str(a["organization.id"]),
          os_type: str(a["os.type"]),
          terminal_type: str(a["terminal.type"]),
          app_version: str(a["app.version"] ?? a["service.version"]),
          model: str(a["model"]),
          query_source: str(a["query_source"]),
          cost_usd: num(a["cost_usd"]),
          input_tokens: num(a["input_tokens"]),
          output_tokens: num(a["output_tokens"]),
          cache_read_tokens: num(a["cache_read_tokens"]),
          cache_creation_tokens: num(a["cache_creation_tokens"]),
          duration_ms: num(a["duration_ms"]),
          success: bool(a["success"]),
          tool_name: str(a["tool_name"]),
          error: str(a["error"] ?? a["error_type"] ?? a["error_name"]),
          status_code: str(a["status_code"]),
          attrs: a,
        });
      }
    }
  }
  return rows;
}

export type MetricRow = ReturnType<typeof identity> & {
  ts: Date;
  metric_name: string;
  value: number;
  unit: string | null;
  temporality: string | null;
  kind: string | null;
  model: string | null;
  attrs: Attrs;
};

type DataPoint = {
  attributes?: KeyValue[];
  timeUnixNano?: string;
  startTimeUnixNano?: string;
  asDouble?: number;
  asInt?: string | number;
};
type Sum = { dataPoints?: DataPoint[]; aggregationTemporality?: number | string };
type MetricsPayload = {
  resourceMetrics?: {
    resource?: { attributes?: KeyValue[] };
    scopeMetrics?: {
      metrics?: { name: string; unit?: string; sum?: Sum; gauge?: Sum }[];
    }[];
  }[];
};

function temporalityName(t: number | string | undefined): string | null {
  if (t === 1 || t === "AGGREGATION_TEMPORALITY_DELTA") return "delta";
  if (t === 2 || t === "AGGREGATION_TEMPORALITY_CUMULATIVE") return "cumulative";
  return null;
}

export function parseMetrics(payload: unknown): MetricRow[] {
  const rows: MetricRow[] = [];
  for (const rm of (payload as MetricsPayload).resourceMetrics ?? []) {
    const resource = toAttrs(rm.resource?.attributes);
    for (const sm of rm.scopeMetrics ?? []) {
      for (const m of sm.metrics ?? []) {
        const series = m.sum ?? m.gauge;
        if (!series) continue; // histograms are not emitted by Claude Code
        const temporality = m.sum ? temporalityName(m.sum.aggregationTemporality) : "gauge";
        for (const dp of series.dataPoints ?? []) {
          const value = num(dp.asDouble ?? dp.asInt);
          if (value === null) continue;
          const a: Attrs = { ...resource, ...toAttrs(dp.attributes) };
          rows.push({
            ...identity(a),
            ts: nanosToDate(dp.timeUnixNano, dp.startTimeUnixNano),
            metric_name: m.name.replace(/^claude_code\./, ""),
            value,
            unit: m.unit || null,
            temporality,
            kind: str(a["type"]),
            model: str(a["model"]),
            attrs: a,
          });
        }
      }
    }
  }
  return rows;
}

/** Parses OTEL_RESOURCE_ATTRIBUTES-style "k=v,k2=v2" (values may be percent-encoded). */
export function parseResourceAttributes(raw: string | null): Attrs {
  const out: Attrs = {};
  for (const part of (raw ?? "").split(",")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}
