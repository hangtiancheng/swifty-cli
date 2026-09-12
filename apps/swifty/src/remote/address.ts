export function parseRemoteAddress(address: string): { host: string; port: number } {
  const value = address.trim();
  const match = /^(?:\[([^\]]+)\]|([^:]*))(?::(\d+))?$/.exec(value);
  if (!match) {
    throw new Error("Invalid remote address; use host:port or [IPv6]:port");
  }
  const host = match[1] || match[2] || "127.0.0.1";
  const port = Number(match[3] ?? "18888");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Remote port must be an integer between 1 and 65535");
  }
  return { host, port };
}
