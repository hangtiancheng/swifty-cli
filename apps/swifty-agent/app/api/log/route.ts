// POST /api/log — swifty-sentry report endpoint (dsn).
// The SDK posts a JSON array of IReportData via sendBeacon (text/plain) or
// fetch (application/json); events are converted to Prometheus metrics.
import { recordReportBatch, reportBatchSchema } from "@/lib/metrics";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return Response.json({ message: "invalid JSON body", data: null }, { status: 400 });
  }

  const parsed = reportBatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ message: "invalid report batch", data: null }, { status: 400 });
  }

  recordReportBatch(parsed.data);
  return Response.json({
    message: "OK",
    data: { received: parsed.data.length },
  });
}
