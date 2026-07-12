// Read version from package.json at runtime so it stays in sync with releases.
// In dev (src/tui/): ../package.json resolves correctly.
// In dist (dist/): tsup injects __SWIFTY_VERSION__ at build time.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

declare const __SWIFTY_VERSION__: string | undefined;

const PackageJsonSchema = z.object({
  version: z.string(),
});

function resolveVersion(): string {
  // Build-time injection takes priority (avoids path issues in dist)
  if (typeof __SWIFTY_VERSION__ !== "undefined") {
    return __SWIFTY_VERSION__;
  }
  // Dev fallback: walk up from this file to find package.json
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Try both 1 and 2 levels up to cover src/ and dist/cli/ layouts
  for (const levels of ["..", "../.."]) {
    const candidate = path.resolve(here, levels, "package.json");
    try {
      const raw: unknown = JSON.parse(readFileSync(candidate, "utf-8"));
      const parsed = PackageJsonSchema.safeParse(raw);
      if (parsed.success) {
        return parsed.data.version;
      }
    } catch {
      // continue
    }
  }
  throw new Error("Could not resolve package version");
}

export const version: string = resolveVersion();
