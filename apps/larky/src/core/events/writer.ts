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

// EventWriter: Serialize events to JSONL and append to file
import { mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";

import type { Event } from "../bus/events.js";
import type { EventBus } from "./bus.js";

export class EventWriter {
  private _path: string;
  private _opened = false;

  constructor(filePath: string) {
    this._path = filePath;
  }

  // Open event file (create directory)
  open(): void {
    mkdirSync(path.dirname(this._path), { recursive: true });
    this._opened = true;
  }

  // Close event file
  close(): void {
    this._opened = false;
  }

  // Support Symbol.asyncDispose (TypeScript 5.2+ using syntax)
  [Symbol.asyncDispose](): void {
    this.close();
  }

  // Serialize event as JSON line and append to file; silently skip on write failure
  handle(event: Event): void {
    if (!this._opened) return;
    try {
      appendFileSync(this._path, JSON.stringify(event) + "\n", "utf-8");
    } catch (err) {
      console.error(`EventWriter: failed to write event: ${String(err)}`);
    }
  }

  // Register handle as a bus subscriber
  subscribe(bus: EventBus): void {
    bus.subscribe((event) => {
      this.handle(event);
      return Promise.resolve();
    });
  }
}
