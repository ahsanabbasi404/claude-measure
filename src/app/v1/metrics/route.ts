import { handleOtlp } from "@/lib/ingest";
import { parseMetrics } from "@/lib/otlp";

/** OTLP/HTTP metrics endpoint: token/cost counters, active time, lines of code, commits, ... */
export async function POST(req: Request) {
  return handleOtlp(req, parseMetrics, "metric_points");
}
