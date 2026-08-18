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

/**
 * Error seeder: plants probabilistic, randomly-triggered errors so that every
 * error category collectible by @swifty.js/sentry shows up in real report
 * traffic. Each seed rolls its own independent probability on a fixed timer
 * tick, so over time all error types appear with different frequencies.
 *
 * Covered @swifty.js/sentry event types:
 *   - EventType.Error (uncaught runtime errors: TypeError / ReferenceError,
 *     reported through the global `window "error"` listener with
 *     line/column info, so they are sourcemap-resolvable on the server)
 *   - EventType.Error via the decorated `console.error` (SDK intercepts
 *     Error objects passed to console.error)
 *   - EventType.UnhandledRejection (promise rejected without a .catch handler)
 *   - EventType.Resource (an <img> element whose src returns 404)
 *   - EventType.Fetch (HTTP 4xx response captured by the fetch decoration)
 *   - EventType.Fetch with statusCode 0 (network-level fetch failure)
 *   - EventType.Xhr (HTTP 4xx response captured by the XMLHttpRequest
 *     decoration; the app itself only uses fetch, so this seed keeps the
 *     XHR capture path exercised)
 *   - EventType.Error via the manual traceError() API
 *   - Batch error aggregation (>= 5 errors sharing the same
 *     type-name-message within a 2s window collapse into one batch report)
 *
 * The React render error (EventType.React) is seeded separately by the
 * <RandomCrash /> component, see ./index.tsx.
 */

import { traceError } from "@swifty.js/sentry";

/** Interval between probability rolls. Every seed gets one roll per tick. */
const TICK_INTERVAL_MS = 15_000;

/** Delay before the very first roll, so page load metrics stay clean. */
const FIRST_TICK_DELAY_MS = 5_000;

/** Returns true with the given probability (0 to 1). */
function chance(probability: number): boolean {
  return Math.random() < probability;
}

/**
 * Seed 1 — Uncaught TypeError (probability 8% per tick).
 *
 * Reads a property of `null` inside a setTimeout callback. The throw happens
 * outside any try/catch and outside React, so it surfaces as a global
 * `window "error"` event. The SDK's handleCodeError captures filename,
 * line and column, making this the canonical sourcemap-restoration case.
 */
function seedUncaughtTypeError(): void {
  setTimeout(() => {
    // JSON claims a user object, runtime delivers null — the classic missed
    // null check. Crashes: cannot read properties of null (reading 'profile')
    const brokenUser: { profile: { name: string } } = JSON.parse("null");
    console.log(brokenUser.profile.name);
  }, 0);
}

/**
 * Seed 2 — Uncaught ReferenceError (probability 6% per tick).
 *
 * Invokes a function that was never defined on globalThis. Like Seed 1 this
 * escapes to the global error listener, but produces a different error
 * class/message so dashboards show variety in error names.
 */
function seedUncaughtReferenceError(): void {
  setTimeout(() => {
    // Reflect.get returns `any`, so the call type-checks yet crashes:
    // missingFn is not a function
    const missingFn: () => void = Reflect.get(
      globalThis,
      "__definitelyMissingFn__",
    );
    missingFn();
  }, 0);
}

/**
 * Seed 3 — Unhandled promise rejection (probability 8% per tick).
 *
 * Rejects a promise with an Error and attaches no .catch handler, so the
 * browser fires `unhandledrejection`, which the SDK reports as
 * EventType.UnhandledRejection. The Error stack is carried in the payload,
 * so multi-frame sourcemap restoration also applies here.
 */
function seedUnhandledRejection(): void {
  void new Promise<never>((_, reject) => {
    reject(new Error("Seeded unhandled rejection: async task failed"));
  });
}

/**
 * Seed 4 — Resource load error (probability 6% per tick).
 *
 * Appends an invisible <img> pointing at a nonexistent file. The failed load
 * fires an ErrorEvent whose target has src/href/localName, which the SDK
 * routes to reportResourceError as EventType.Resource. The element is removed
 * afterwards to avoid leaking DOM nodes.
 */
function seedResourceError(): void {
  const img = document.createElement("img");
  img.style.display = "none";
  // Random suffix defeats the SDK's resource-error dedup (keyed by src)
  img.src = `/static/__seeded_missing_${Date.now()}.png`;
  img.addEventListener("error", () => img.remove(), { once: true });
  document.body.appendChild(img);
}

/**
 * Seed 5 — HTTP 4xx fetch error (probability 8% per tick).
 *
 * Requests an API route that does not exist on the Koa server. The SDK's
 * fetch decoration records method, URL, status code and elapsed time; a 404
 * classifies as Status.Error and is reported as EventType.Fetch. The .catch
 * is only a safety net for environments without a backend — a 404 response
 * itself does not reject fetch.
 */
function seedHttpNotFound(): void {
  fetch("/api/__seeded_missing_endpoint__").catch(() => {
    // Swallow network-level failures; Seed 6 covers those deliberately.
  });
}

/**
 * Seed 6 — Network-level fetch failure (probability 4% per tick).
 *
 * Connects to a port that nothing listens on, so fetch rejects before any
 * HTTP response exists. The SDK captures this as EventType.Fetch with
 * statusCode 0 and re-throws to the caller — hence the mandatory .catch.
 */
function seedNetworkError(): void {
  fetch("http://127.0.0.1:1/__seeded_unreachable__").catch(() => {
    // Expected: connection refused. The SDK already reported statusCode 0.
  });
}

/**
 * Seed 7 — console.error with an Error object (probability 6% per tick).
 *
 * The SDK decorates console.error and reports Error arguments as
 * EventType.Error. This mimics libraries that log caught exceptions
 * instead of rethrowing them.
 */
function seedConsoleError(): void {
  console.error(
    new Error("Seeded console.error: recoverable subsystem failure"),
  );
}

/**
 * Seed 8 — Manual traceError() report (probability 5% per tick).
 *
 * Simulates business code catching an exception and explicitly forwarding it
 * to the SDK. Goes through the full handleError pipeline like any other
 * runtime error, but never disturbs the UI.
 */
function seedManualTraceError(): void {
  try {
    throw new RangeError("Seeded manual report: order quantity out of range");
  } catch (error) {
    // traceError accepts unknown; the SDK classifies the value itself.
    traceError(error);
  }
}

/**
 * Seed 9 — Batch error burst (probability 3% per tick).
 *
 * Throws SIX uncaught errors with the exact same message from six DIFFERENT
 * source lines. Different lines let every throw pass the SDK's dedup filter
 * (keyed by message+filename+line+column), while the identical
 * type-name-message groups them inside BatchErrorManager's 2-second window.
 * Six errors >= the batch threshold (5), so the SDK emits a single
 * aggregated report with batchError: true and batchErrorLength: 6.
 */
function seedBatchErrorBurst(): void {
  const message = "Seeded batch burst: repeated pipeline failure";
  // Six distinct throw sites (different line/column) are intentional: they
  // bypass per-location dedup while still grouping into one batch report.
  setTimeout(() => {
    throw new Error(message);
  }, 0);
  setTimeout(() => {
    throw new Error(message);
  }, 50);
  setTimeout(() => {
    throw new Error(message);
  }, 100);
  setTimeout(() => {
    throw new Error(message);
  }, 150);
  setTimeout(() => {
    throw new Error(message);
  }, 200);
  setTimeout(() => {
    throw new Error(message);
  }, 250);
}

/**
 * Seed 10 — HTTP 4xx XHR error (probability 6% per tick).
 *
 * The movie app itself only uses fetch, so without this seed the SDK's
 * XMLHttpRequest open/send decoration would never fire. A 404 response
 * classifies as Status.Error and is reported as EventType.Xhr.
 */
function seedXhrNotFound(): void {
  const xhr = new XMLHttpRequest();
  xhr.open("GET", "/api/__seeded_missing_xhr_endpoint__");
  xhr.send();
}

/** A seed pairs a per-tick trigger probability with its error generator. */
interface ErrorSeed {
  /** Probability (0-1) that this seed fires on a single tick. */
  probability: number;
  /** Human-readable label used for the console breadcrumb. */
  label: string;
  trigger: () => void;
}

const SEEDS: readonly ErrorSeed[] = [
  {
    probability: 0.08,
    label: "uncaught TypeError",
    trigger: seedUncaughtTypeError,
  },
  {
    probability: 0.06,
    label: "uncaught ReferenceError",
    trigger: seedUncaughtReferenceError,
  },
  {
    probability: 0.08,
    label: "unhandled rejection",
    trigger: seedUnhandledRejection,
  },
  {
    probability: 0.06,
    label: "resource load error",
    trigger: seedResourceError,
  },
  { probability: 0.08, label: "fetch HTTP 404", trigger: seedHttpNotFound },
  {
    probability: 0.04,
    label: "fetch network failure",
    trigger: seedNetworkError,
  },
  {
    probability: 0.06,
    label: "console.error report",
    trigger: seedConsoleError,
  },
  {
    probability: 0.05,
    label: "manual traceError",
    trigger: seedManualTraceError,
  },
  {
    probability: 0.03,
    label: "batch error burst",
    trigger: seedBatchErrorBurst,
  },
  {
    probability: 0.06,
    label: "XHR HTTP 404",
    trigger: seedXhrNotFound,
  },
];

let timerId: ReturnType<typeof setInterval> | undefined;

/**
 * Starts the error seeder. Idempotent: calling it twice keeps a single timer.
 * On every tick each seed rolls independently, so zero, one or several error
 * types may fire in the same tick.
 */
export function startErrorSeeder(): void {
  if (timerId !== undefined) return;

  const tick = () => {
    for (const seed of SEEDS) {
      if (chance(seed.probability)) {
        // Plain console.log (not console.error) so the breadcrumb itself
        // never becomes an SDK error report.
        console.log(`[error-seeder] firing: ${seed.label}`);
        seed.trigger();
      }
    }
  };

  setTimeout(() => {
    tick();
    timerId = setInterval(tick, TICK_INTERVAL_MS);
  }, FIRST_TICK_DELAY_MS);
}

/** Stops the seeder; useful for tests or when tearing the app down. */
export function stopErrorSeeder(): void {
  if (timerId !== undefined) {
    clearInterval(timerId);
    timerId = undefined;
  }
}
