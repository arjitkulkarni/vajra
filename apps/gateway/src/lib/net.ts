/**
 * Network allowlisting for the administrative plane.
 *
 * One rule matters more than the matching: **the address checked here must be the socket peer, not
 * a header.** `X-Forwarded-For` is attacker-controlled on any request that does not pass through a
 * proxy we run, so an allowlist that reads it is not a control at all — anyone can claim to be
 * 127.0.0.1. The gateway runs without `trustProxy`, which makes Fastify's `req.ip` the real peer;
 * that is what `isAllowedAddress` is meant to be given. The header-derived `clientIp()` in the
 * routes stays where it belongs: audit payloads, where it is evidence of a claim, not a decision.
 *
 * Entries accepted:
 *   loopback            127.0.0.0/8 and ::1 — "somebody sitting at this machine"
 *   192.168.29.156      one IPv4 address
 *   192.168.29.0/24     an IPv4 range
 *   ::1, fe80::1        one IPv6 address, compared on its normalised form
 *
 * An empty list means unrestricted, which is the default: a laptop demo should not need to know
 * its own address, and the control is opt-in per deployment.
 */

/** Strip the IPv4-mapped IPv6 form (`::ffff:192.168.1.5`) and any zone id, then lower-case. */
export function normaliseAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let ip = raw.trim().toLowerCase();
  if (!ip) return null;
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);
  if (ip.startsWith("::ffff:") && ip.includes(".")) ip = ip.slice(7);
  return ip || null;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** IPv4 dotted quad → unsigned 32-bit, or null when it is not one. */
export function ipv4ToInt(ip: string): number | null {
  const m = IPV4.exec(ip);
  if (!m) return null;
  let out = 0;
  for (let i = 1; i <= 4; i++) {
    const octet = Number(m[i]);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    out = out * 256 + octet;
  }
  return out >>> 0;
}

const isLoopback = (ip: string): boolean => ip === "::1" || (ipv4ToInt(ip) !== null && ip.startsWith("127."));

/** Parse the configured list once. Blank and malformed entries are dropped, not silently allowed. */
export function parseAllowlist(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function matchesEntry(ip: string, entry: string): boolean {
  if (entry === "loopback") return isLoopback(ip);
  if (entry === "*") return true;

  const slash = entry.indexOf("/");
  if (slash === -1) {
    const a = ipv4ToInt(ip);
    const b = ipv4ToInt(entry);
    if (a !== null && b !== null) return a === b;
    return ip === normaliseAddress(entry); // IPv6 or anything else: exact, normalised
  }

  // CIDR — IPv4 only, which is what a LAN allowlist actually needs.
  const base = ipv4ToInt(entry.slice(0, slash));
  const bits = Number(entry.slice(slash + 1));
  const addr = ipv4ToInt(ip);
  if (base === null || addr === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (addr & mask) >>> 0 === (base & mask) >>> 0;
}

/**
 * True when this address may reach the administrative plane.
 * An empty allowlist is unrestricted; an address we cannot parse is refused.
 */
export function isAllowedAddress(rawAddress: string | null | undefined, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const ip = normaliseAddress(rawAddress);
  if (!ip) return false;
  return allowlist.some((entry) => matchesEntry(ip, entry));
}
