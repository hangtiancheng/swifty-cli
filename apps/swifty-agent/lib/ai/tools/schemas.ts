/**
 * Copyright (c) 2026 hangtiancheng
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Tool input parameter schemas (Zod), aligned with the Input structs in source project internal/ai/tools/*
// References the layered pattern from swifty-codegen server/src/ai/tools/file-tool-schemas.ts
import { z } from "zod/v4";

// get_current_time: no input parameters
export const getCurrentTimeSchema = z
  .object({})
  .describe("No input parameters, returns the current system time");

// mysql_crud: DSN + SQL + operation type
export const mysqlCrudSchema = z.object({
  dsn: z
    .string()
    .describe(
      "MySQL DSN, including username/password/host/port/database name, e.g., root:pass@tcp(host:3306)/db",
    ),
  sql: z.string().describe("SQL statement to execute"),
  operate_type: z.enum(["query", "insert", "update", "delete"]).describe("SQL operation type"),
});

// query_internal_docs: RAG retrieval for internal documents
export const queryInternalDocsSchema = z.object({
  query: z.string().describe("Query string used to retrieve internal documents"),
});

// query_prometheus_alerts: no input parameters
export const prometheusAlertsSchema = z
  .object({})
  .describe("No input parameters, queries active Prometheus alerts");
