import { describe, expect, test } from "vitest";

import type { MCPServerConfig } from "../src/config/config.js";
import { MCPManager } from "../src/mcp/manager.js";

// Neither `command` nor `url`, so MCPClient.connect rejects before touching the
// network or spawning anything — a deterministic stand-in for a server that is down.
const unreachable: MCPServerConfig[] = [{ name: "broken" }];

describe("MCPManager", () => {
  test("a server that fails to come up counts as missing, never as connected", async () => {
    const mgr = new MCPManager();
    const result = await mgr.connectAll(unreachable);

    expect(result.servers).toEqual([]);
    expect(result.errors.map((e) => e.serverName)).toEqual(["broken"]);
    expect(mgr.connectedServers()).toEqual([]);
    expect(mgr.missingServers(unreachable)).toEqual(["broken"]);
  });

  test("a later connect pass retries the server instead of skipping it", async () => {
    const mgr = new MCPManager();
    await mgr.connectAll(unreachable);
    const second = await mgr.connectAll(unreachable);

    expect(second.errors.map((e) => e.serverName)).toEqual(["broken"]);
    expect(mgr.missingServers(unreachable)).toEqual(["broken"]);
  });
});
