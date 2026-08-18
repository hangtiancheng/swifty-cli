// Bridges swifty-sentry browser reports to Prometheus: POST /api/log feeds
// these metrics, GET /api/metrics exposes them for scraping.
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";
import { z } from "zod";

const reportItemSchema = z.looseObject({
  type: z.string(),
  name: z.string().optional(),
  status: z.string().optional(),
  projectId: z.string().optional(),
  payload: z.unknown().optional(),
});

export const reportBatchSchema = z.array(reportItemSchema);

export type ReportItem = z.infer<typeof reportItemSchema>;

const httpPayloadSchema = z.looseObject({
  method: z.string().optional(),
  statusCode: z.number().optional(),
  elapsedTime: z.number().optional(),
});

const performancePayloadSchema = z.looseObject({
  value: z.number().optional(),
  rating: z.string().optional(),
});

interface SentryMetrics {
  registry: Registry;
  eventsTotal: Counter<"type" | "status" | "project_id">;
  httpRequestDurationMs: Histogram<"method" | "status_code">;
  webVitals: Gauge<"name" | "rating" | "project_id">;
}

function createMetrics(): SentryMetrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  return {
    registry,
    eventsTotal: new Counter({
      name: "swifty_sentry_events_total",
      help: "Events reported by the swifty-sentry browser SDK, by type and status.",
      labelNames: ["type", "status", "project_id"],
      registers: [registry],
    }),
    httpRequestDurationMs: new Histogram({
      name: "swifty_sentry_http_request_duration_ms",
      help: "Browser-side HTTP request duration in milliseconds (XHR/fetch events).",
      labelNames: ["method", "status_code"],
      buckets: [50, 100, 300, 500, 1000, 3000, 10000],
      registers: [registry],
    }),
    webVitals: new Gauge({
      name: "swifty_sentry_web_vitals",
      help: "Latest browser performance metric value (LCP/FCP/CLS/INP/TTFB/FSP...).",
      labelNames: ["name", "rating", "project_id"],
      registers: [registry],
    }),
  };
}

declare global {
  // Route bundles and dev HMR re-evaluate this module; the globalThis cache
  // keeps a single registry per Node process so counters never reset or
  // double-register.
  var __swiftySentryMetrics: SentryMetrics | undefined;
}

export const sentryMetrics: SentryMetrics =
  (globalThis.__swiftySentryMetrics ??= createMetrics());

export function recordReportBatch(items: ReportItem[]): void {
  for (const item of items) {
    const projectId = item.projectId ?? "unknown";
    sentryMetrics.eventsTotal.inc({
      type: item.type,
      status: item.status ?? "unknown",
      project_id: projectId,
    });

    if (item.type === "XMLHttpRequest" || item.type === "fetch") {
      const http = httpPayloadSchema.safeParse(item.payload);
      if (http.success && http.data.elapsedTime !== undefined) {
        sentryMetrics.httpRequestDurationMs.observe(
          {
            method: http.data.method ?? "unknown",
            status_code: String(http.data.statusCode ?? 0),
          },
          http.data.elapsedTime,
        );
      }
    }

    if (item.type === "Performance" && item.name) {
      const perf = performancePayloadSchema.safeParse(item.payload);
      if (perf.success && perf.data.value !== undefined) {
        sentryMetrics.webVitals.set(
          {
            name: item.name,
            rating: perf.data.rating ?? "none",
            project_id: projectId,
          },
          perf.data.value,
        );
      }
    }
  }
}
