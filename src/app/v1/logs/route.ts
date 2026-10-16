import { handleOtlp } from "@/lib/ingest";
import { parseLogs } from "@/lib/otlp";
import { fillMissingCosts } from "@/lib/pricing";

/** OTLP/HTTP logs endpoint: Claude Code events (api_request, tool_result, compaction, ...). */
export async function POST(req: Request) {
  return handleOtlp(
    req,
    async (payload) => {
      const rows = parseLogs(payload);
      await fillMissingCosts(rows);
      return rows;
    },
    "events",
  );
}
