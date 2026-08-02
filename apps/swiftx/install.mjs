#!/usr/bin/env node
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

// @ts-check

// postinstall: download the platform-specific swiftx binary from GitHub
// Releases instead of shipping all targets inside the npm tarball.
//
// Env overrides:
//   SWIFTX_SKIP_DOWNLOAD=1        skip the download entirely
//
// Standard proxy env vars (http_proxy, https_proxy, all_proxy and their
// upper-case variants) are respected automatically.

import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Map of Node.js platform names to binary file name segments.
 *
 * @type {Partial<Record<NodeJS.Platform, string>>}
 */
const PLATFORM_MAP = {
  darwin: "darwin",
  linux: "linux",
  android: "linux",
  win32: "windows",
};

/**
 * Map of Node.js architecture names to binary file name segments.
 *
 * @type {Partial<Record<NodeJS.Architecture, string>>}
 */
const ARCH_MAP = { x64: "x64", arm64: "arm64" };

/**
 * Print an informational message with the `[swiftx]` prefix.
 *
 * @param {string} message - The message to print.
 * @returns {void}
 */
function log(message) {
  console.log(`[swiftx] ${message}`);
}

/**
 * Print an error message and exit with a non-zero status.
 *
 * @param {string} message - The error message.
 * @returns {never}
 */
function fail(message) {
  console.error(`[swiftx] ${message}`);
  process.exit(1);
}

/**
 * Resolve the proxy URL for a target from standard environment variables.
 *
 * @param {string} targetUrl - The URL being requested.
 * @returns {string | undefined} The proxy URL, or undefined if none is set.
 */
function resolveProxy(targetUrl) {
  const proto = new URL(targetUrl).protocol;
  const env = process.env;
  if (proto === "https:") {
    return (
      env["https_proxy"] ||
      env["HTTPS_PROXY"] ||
      env["all_proxy"] ||
      env["ALL_PROXY"] ||
      undefined
    );
  }
  return (
    env["http_proxy"] ||
    env["HTTP_PROXY"] ||
    env["all_proxy"] ||
    env["ALL_PROXY"] ||
    undefined
  );
}

/**
 * Download a file through an HTTP(S) proxy, following redirects.
 * HTTPS targets are reached via a CONNECT tunnel; plain HTTP targets use
 * absolute-form requests forwarded by the proxy.
 *
 * @param {string} url - URL to download.
 * @param {string} destPath - Destination file path.
 * @param {string} proxy - Proxy URL.
 * @param {number} [redirects=5] - Remaining redirect budget.
 * @returns {Promise<void>}
 */
function downloadViaProxy(url, destPath, proxy, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects < 0) {
      reject(new Error("too many redirects"));
      return;
    }
    const target = new URL(url);
    const isHttps = target.protocol === "https:";
    const port = Number(target.port) || (isHttps ? 443 : 80);
    const proxyUrl = new URL(proxy);

    /** @param {import("node:http").IncomingMessage} res */
    const onResponse = (res) => {
      const code = res.statusCode ?? 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        downloadViaProxy(
          new URL(res.headers.location, url).href,
          destPath,
          proxy,
          redirects - 1,
        ).then(resolve, reject);
        return;
      }
      if (code >= 400) {
        res.resume();
        reject(new Error(`HTTP ${code} ${res.statusMessage} (${url})`));
        return;
      }
      const ws = createWriteStream(destPath, { mode: 0o755 });
      res.pipe(ws);
      ws.on("finish", () => ws.close(() => resolve()));
      ws.on("error", reject);
      res.on("error", reject);
    };

    const proxyAuth =
      proxyUrl.username || proxyUrl.password
        ? `Basic ${Buffer.from(
            `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`,
          ).toString("base64")}`
        : undefined;

    if (isHttps) {
      const connectReq = httpRequest({
        host: proxyUrl.hostname,
        port: Number(proxyUrl.port) || 80,
        method: "CONNECT",
        path: `${target.hostname}:${port}`,
        headers: proxyAuth ? { "proxy-authorization": proxyAuth } : undefined,
      });
      connectReq.once("connect", (_res, socket) => {
        const req = httpsRequest(
          {
            hostname: target.hostname,
            port,
            path: target.pathname + target.search,
            createConnection: () => socket,
            agent: false,
          },
          onResponse,
        );
        req.once("error", reject);
        req.end();
      });
      connectReq.once("error", reject);
      connectReq.end();
    } else {
      const req = httpRequest(
        {
          host: proxyUrl.hostname,
          port: Number(proxyUrl.port) || 80,
          path: url,
          headers: {
            host: target.host,
            ...(proxyAuth ? { "proxy-authorization": proxyAuth } : undefined),
          },
        },
        onResponse,
      );
      req.once("error", reject);
      req.end();
    }
  });
}

if (process.env["SWIFTX_SKIP_DOWNLOAD"] === "1") {
  log("SWIFTX_SKIP_DOWNLOAD=1, skipping binary download");
  process.exit(0);
}

// A git checkout of the monorepo (npm tarball does not include build.js): the
// binary is produced locally via `pnpm build`, not downloaded.
if (existsSync(join(__dirname, "build.js"))) {
  log("detected repository checkout, skipping binary download");
  process.exit(0);
}

const platformName = PLATFORM_MAP[process.platform];
const archName = ARCH_MAP[process.arch];
if (!platformName || !archName) {
  fail(`unsupported platform: ${process.platform} (${process.arch})`);
}

const ext = platformName === "windows" ? ".exe" : "";
const asset = `swiftx-${platformName}-${archName}${ext}`;
const buildDir = join(__dirname, "build");
const binaryPath = join(buildDir, asset);

const base = "https://github.com/hangtiancheng/swifty.go/releases/download";
const url = `${base}/swiftx/${asset}`;

log(`downloading ${url}`);

mkdirSync(buildDir, { recursive: true });
const tmpPath = `${binaryPath}.download`;

try {
  const proxy = resolveProxy(url);
  if (proxy) {
    log(`using proxy: ${proxy}`);
    await downloadViaProxy(url, tmpPath, proxy);
  } else {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok || !res.body) {
      fail(`download failed: HTTP ${res.status} ${res.statusText} (${url})`);
    }
    await pipeline(
      Readable.fromWeb(res.body),
      createWriteStream(tmpPath, { mode: 0o755 }),
    );
  }
  renameSync(tmpPath, binaryPath);
  chmodSync(binaryPath, 0o755);
} catch (err) {
  rmSync(tmpPath, { force: true });
  fail(
    `download failed: ${err instanceof Error ? err.message : String(err)}\n` +
      `URL: ${url}\n` +
      "You can download the binary manually into the package's build/ directory.",
  );
}

log(`installed ${binaryPath}`);
