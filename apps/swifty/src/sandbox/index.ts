import os from "node:os";

/**
 * Sandbox configuration: controls file write permissions and network access.
 */
export interface SandboxConfig {
  /** Paths where write operations are permitted. */
  allowWrite: string[];
  /** Paths that are always read-only (takes precedence over allowWrite). */
  denyWrite: string[];
  /** Whether network access is allowed. */
  networkEnabled: boolean;
}

/**
 * Unified sandbox interface with platform-specific implementations for macOS and Linux.
 */
export interface Sandbox {
  /** Wraps a raw command into a sandboxed command string. */
  wrap(command: string, config: SandboxConfig): string;
  /** Checks whether the platform sandbox tooling is available. */
  available(): boolean;
}

/**
 * Creates a platform-appropriate sandbox instance.
 * macOS: seatbelt (sandbox-exec)
 * Linux: bubblewrap (bwrap)
 * Other platforms: null (sandbox not supported)
 */
export async function createSandbox(): Promise<Sandbox | null> {
  const platform = os.platform();
  if (platform === "darwin") {
    const { SeatbeltSandbox } = await import("./seatbelt.js");
    return new SeatbeltSandbox();
  }
  if (platform === "linux") {
    const { BwrapSandbox } = await import("./bwrap.js");
    return new BwrapSandbox();
  }
  return null;
}
