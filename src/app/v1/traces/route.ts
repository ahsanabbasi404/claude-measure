import { isValidIngestRequest } from "@/lib/auth";

/** Traces are not stored; accepting them keeps clients with tracing enabled from retrying. */
export async function POST(req: Request) {
  if (!isValidIngestRequest(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json({});
}
