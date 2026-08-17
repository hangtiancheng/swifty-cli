# Service Offline

Alert Explanation: A service going offline may be caused by a service panic leading to pod restarts.
Resolution:

1. Search logs from the last 1 hour using the keyword "panic".
2. Log topic region: ap-guangzhou; log topic ID: 869830db-a055-4479-963b-3c898d27e755.
3. Analyze the panic log content to determine which bug caused the panic.

# High Interface Failure Rate

Alert Explanation: A high interface failure rate may be caused by service call exceptions or downstream service unavailability.
Resolution:

1. Search logs from the last 1 hour using the interface name and the keyword "response".
2. Analyze the errors found in the logs to determine the cause of interface failures.

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
