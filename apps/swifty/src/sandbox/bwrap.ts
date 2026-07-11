import { execSync } from "node:child_process";
import type { Sandbox, SandboxConfig } from "./index.js";

/**
 * Linux bubblewrap (bwrap) sandbox implementation.
 * Leverages Linux user namespaces to create lightweight isolated environments.
 */
export class BwrapSandbox implements Sandbox {
  available(): boolean {
    try {
      execSync("which bwrap", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  wrap(command: string, config: SandboxConfig): string {
    const args: string[] = [];

    // Isolate user and PID namespaces
    args.push("bwrap", "--unshare-user", "--unshare-pid");

    // Mount the root filesystem as read-only
    args.push("--ro-bind", "/", "/");

    // Grant write access via writable bind mounts for allowed paths
    for (const path of config.allowWrite) {
      args.push("--bind", path, path);
    }

    // Enforce read-only on denied paths (overrides writable root mount sub-paths)
    for (const path of config.denyWrite) {
      args.push("--ro-bind", path, path);
    }

    // Network isolation
    if (!config.networkEnabled) {
      args.push("--unshare-net");
    }

    // Mount /proc, required by many commands
    args.push("--proc", "/proc");

    // Append the command to execute
    args.push("--", "bash", "-c", command);

    // Join into a single command string; quote arguments containing whitespace or special characters
    return args
      .map((arg) => {
        if (/[ \t\n"'\\$`!]/.test(arg)) {
          return `'${arg.replace(/'/g, "'\\''")}'`;
        }
        return arg;
      })
      .join(" ");
  }
}
