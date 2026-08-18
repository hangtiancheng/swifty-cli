# Service Offline

Alert Explanation: A service going offline may be caused by a service panic leading to pod restarts. In Prometheus this alert fires as `ServiceOffline` with label `severity=critical` and a `service` label identifying the affected service.

Resolution:

1. Confirm target status: query `up{job="<service-job>"}` in Prometheus (http://localhost:9090). Value 0 means the target is unreachable.
2. Check the Prometheus targets page (http://localhost:9090/targets) for the last error message (e.g. "connection refused" indicates the process is not running).
3. Search logs from the last 1 hour using the keyword "panic".
4. Log topic region: ap-guangzhou; log topic ID: 869830db-a055-4479-963b-3c898d27e755.
5. Analyze the panic log content to determine which bug caused the panic.
6. If the process exited without panic, check system resource pressure: `process_resident_memory_bytes` and `process_cpu_seconds_total` from the target's metrics endpoint before it went down.

Known targets and their scrape endpoints:

- prometheus: http://localhost:9090/metrics (job=prometheus)
- swifty-agent (Next.js): http://127.0.0.1:3000/api/metrics (job=swifty-agent)
- swifty-agent-go: http://127.0.0.1:8123/api/metrics (job=swifty-agent-go)

# High Interface Failure Rate

Alert Explanation: A high interface failure rate may be caused by service call exceptions or downstream service unavailability. In Prometheus this alert fires as `HighInterfaceFailureRate` with label `severity=warning` and a `service` label.

Resolution:

1. Search logs from the last 1 hour using the interface name and the keyword "response".
2. Analyze the errors found in the logs to determine the cause of interface failures.
3. Check browser-side HTTP errors: query `rate(swifty_sentry_events_total{status="Error"}[5m])` to see if client-side failures correlate. The `type` label distinguishes event sources: "XMLHttpRequest", "fetch", "Error", "Performance", "Click", etc.
4. Check request latency: query `histogram_quantile(0.99, rate(swifty_sentry_http_request_duration_ms_bucket[5m]))` to identify slow endpoints that may be timing out. Labels: `method` (GET/POST), `status_code` (HTTP status as string). Buckets: 50, 100, 300, 500, 1000, 3000, 10000 ms.
5. Filter by specific endpoint: `histogram_quantile(0.95, rate(swifty_sentry_http_request_duration_ms_bucket{status_code=~"5.."}[5m]))` isolates server-error latency.
6. If a downstream dependency is suspected, verify its target health via `up{job="<downstream-job>"}`.

# Target Down (Scrape Failure)

Alert Explanation: A Prometheus target is unreachable. The `up` metric for the target is 0. Common causes: process not started, port conflict, firewall blocking the scrape port, or the process crashed.

Resolution:

1. Open http://localhost:9090/targets and locate the target with health "down".
2. Read the `lastError` field for the specific failure reason (e.g. "dial tcp 127.0.0.1:8123: connect: connection refused" means nothing is listening on that port).
3. Verify the process is running: `lsof -i :<port>` or `ps aux | grep <process-name>`.
4. If the process should be running but is not, restart it. For swifty-agent-go, the expected endpoint is http://127.0.0.1:8123/api/metrics.
5. After restart, confirm recovery: `up{job="<job-name>"}` should return 1 within one scrape interval (15s).

# High Event Loop Lag

Alert Explanation: The Node.js event loop lag is abnormally high, indicating the swifty-agent process is blocked or CPU-saturated. This can cause request timeouts and cascading failures.

Resolution:

1. Query `nodejs_eventloop_lag_p99_seconds{job="swifty-agent"}`. Values consistently above 0.1s indicate a problem.
2. Check `process_cpu_seconds_total` rate: `rate(process_cpu_seconds_total{job="swifty-agent"}[5m])`. A rate near 1.0 means a single core is saturated.
3. Check active handles: `nodejs_active_handles_total{job="swifty-agent"}`. A sudden spike may indicate a connection leak.
4. Search logs for long-running operations (large embedding batches, slow Redis/MySQL queries).
5. If memory is growing unbounded, check `process_resident_memory_bytes` trend over the last hour.

# Web Vitals Degradation

Alert Explanation: Browser-side performance metrics reported via the swifty-sentry SDK have degraded beyond acceptable thresholds. The `swifty_sentry_web_vitals` gauge carries labels: `name` (LCP, FCP, CLS, INP, TTFB, FSP), `rating` (good, needs-improvement, poor), and `project_id`.

Resolution:

1. Query `swifty_sentry_web_vitals{rating="poor"}` to see which vitals are in poor state. Use `swifty_sentry_web_vitals{name="LCP"}` to track a specific metric over time.
2. Correlate with server-side latency: high TTFB usually points to backend slowness (check event loop lag and downstream response times).
3. High LCP/FCP with normal TTFB suggests a frontend rendering issue (large bundle, unoptimized images). FSP (First Screen Paint) is a custom metric computed by the SDK, not from the web-vitals library.
4. Check `rate(swifty_sentry_events_total{status="Error"}[5m])` for a simultaneous spike in client errors.
5. Rating thresholds follow web-vitals conventions: LCP good < 2500ms, needs-improvement < 4000ms; FCP good < 1800ms; CLS good < 0.1; INP good < 200ms; TTFB good < 800ms.

# Reconciliation Discrepancy with Downstream

Alert Explanation: A reconciliation discrepancy with downstream may be caused by data synchronization anomalies or calculation errors.

Resolution:

1. Search logs from the last 1 hour using the keywords "error" and "reconciliation".
2. Analyze the log content to determine the cause of the reconciliation discrepancy.

# Service Region Mismatch with Resource Region

Problem Explanation: In billing data processing, we found that some services used incorrect MQ queues, causing resource events to be delivered to the wrong region, resulting in a mismatch between the resource region and the billing service region.

Resolution:

1. Search logs from the last 1 hour using the keyword "region mismatch".
2. Based on the log content, aggregate the callers and incorrect region names.

# Service Error Codes and Common Causes

- 12000000001: Invalid API call parameters (e.g., type mismatch)
- 12000000002: Database update failed (database issue, recommend checking logs)
- 12000000003: Downstream API error (downstream API returned an error)
- 12000000004: Instance not found (upstream passed an incorrect instance ID)

# Prometheus Infrastructure Reference

Scrape configuration: /opt/homebrew/etc/prometheus.rules.yml (alert rules), Prometheus config embedded in prometheus.yml.

Scrape interval: 15s for all jobs. Data retention: 15 days.

Metrics pipeline: swifty-sentry browser SDK -> POST /api/log (batch JSON) -> lib/metrics.ts (prom-client) -> GET /api/metrics -> Prometheus scrape.

Custom metrics (defined in lib/metrics.ts):

- swifty_sentry_events_total (Counter): labels type, status, project_id. Incremented for every SDK event. Type values: XMLHttpRequest, fetch, Error, Performance, Click, Resource, PV, ScreenRecord, WhiteScreen, Exposure, Custom.
- swifty_sentry_http_request_duration_ms (Histogram): labels method, status_code. Buckets: [50, 100, 300, 500, 1000, 3000, 10000] ms. Only recorded for XHR/fetch events with elapsedTime.
- swifty_sentry_web_vitals (Gauge): labels name, rating, project_id. Set to latest value for Performance events. Names: LCP, FCP, CLS, INP, TTFB, FSP. Ratings: good, needs-improvement, poor.

Default metrics (prom-client collectDefaultMetrics): process_cpu__, process_resident_memory_bytes, nodejs_eventloop_lag__, nodejs_active_handles_total, nodejs_active_requests, etc.

Useful PromQL queries for triage:

- All targets status: `up`
- Target down duration: `time() - timestamp(up == 0)`
- Memory usage: `process_resident_memory_bytes`
- CPU saturation: `rate(process_cpu_seconds_total[5m])`
- Event loop health: `nodejs_eventloop_lag_p99_seconds`
- Client error rate: `rate(swifty_sentry_events_total{status="Error"}[5m])`
- HTTP error rate by status: `rate(swifty_sentry_events_total{type=~"XMLHttpRequest|fetch", status="Error"}[5m])`
- P99 request latency: `histogram_quantile(0.99, rate(swifty_sentry_http_request_duration_ms_bucket[5m]))`
- Poor web vitals: `swifty_sentry_web_vitals{rating="poor"}`
- Events by type breakdown: `sum by (type) (rate(swifty_sentry_events_total[5m]))`
