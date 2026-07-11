// Read version from package.json at runtime so it stays in sync with releases.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const PackageJsonSchema = z.object({
  version: z.string(),
});

const packageJsonPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "package.json",
);

const raw: unknown = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
const parsed = PackageJsonSchema.safeParse(raw);
if (!parsed.success) {
  throw new Error(`package.json is missing or has invalid "version" field`);
}

export const version: string = parsed.data.version;
