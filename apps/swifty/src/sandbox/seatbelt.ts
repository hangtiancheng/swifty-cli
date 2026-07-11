import { existsSync, statSync } from "node:fs";
import type { Sandbox, SandboxConfig } from "./index.js";

// Hardcoded path to prevent PATH injection attacks
const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";

/**
 * macOS seatbelt sandbox implementation.
 * Dynamically generates a seatbelt profile to control file write and network access permissions.
 */
export class SeatbeltSandbox implements Sandbox {
  available(): boolean {
    return existsSync(SANDBOX_EXEC_PATH);
  }

  wrap(command: string, config: SandboxConfig): string {
    const profile = buildProfile(config);
    // Pass the profile via -p; use %q-style quoting to prevent secondary shell interpretation
    const escaped = command.replace(/'/g, "'\\''");
    return `${SANDBOX_EXEC_PATH} -p '${profile}' bash -c '${escaped}'`;
  }
}

/**
 * Dynamically builds a seatbelt profile string.
 * Strategy: deny by default, then allow execution and reads, grant writes per path,
 * deny writes per path, and finally configure network access.
 */
function buildProfile(config: SandboxConfig): string {
  const lines: string[] = [];

  lines.push("(version 1)");
  lines.push("(deny default)");

  // Allow process execution and forking
  lines.push("(allow process-exec)");
  lines.push("(allow process-fork)");
  // Allow reading system control parameters
  lines.push("(allow sysctl-read)");
  // Allow reading the entire filesystem
  lines.push('(allow file-read* (subpath "/"))');

  // Grant write access for allowed paths
  for (const path of config.allowWrite) {
    lines.push(`(allow file-write* (subpath "${path}"))`);
  }

  // Deny write access for denied paths; seatbelt evaluates later rules with higher priority.
  // Use 'literal' for exact file matching, 'subpath' for directory prefix matching.
  for (const path of config.denyWrite) {
    const matcher = existsSync(path) && statSync(path).isDirectory() ? "subpath" : "literal";
    lines.push(`(deny file-write* (${matcher} "${path}"))`);
  }

  // Network access control
  if (config.networkEnabled) {
    lines.push("(allow network*)");
  } else {
    lines.push("(deny network*)");
  }

  return lines.join("\n");
}
