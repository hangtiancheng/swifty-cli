// GET /api/metrics — Prometheus exposition endpoint scraped by the local
// Prometheus (job: swifty-agent); serves the swifty-sentry bridge metrics.
import { sentryMetrics } from "@/lib/metrics";

export async function GET() {
  const body = await sentryMetrics.registry.metrics();
  return new Response(body, {
    headers: { "Content-Type": sentryMetrics.registry.contentType },
  });
}
