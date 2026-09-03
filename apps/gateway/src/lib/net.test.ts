import { describe, expect, it } from "vitest";
import { isAllowedAddress, ipv4ToInt, normaliseAddress, parseAllowlist } from "./net";

describe("normaliseAddress", () => {
  it("unwraps IPv4-mapped IPv6 and strips zone ids", () => {
    expect(normaliseAddress("::ffff:192.168.29.156")).toBe("192.168.29.156");
    expect(normaliseAddress("fe80::1%eth0")).toBe("fe80::1");
    expect(normaliseAddress("  ::1  ")).toBe("::1");
    expect(normaliseAddress("")).toBeNull();
    expect(normaliseAddress(null)).toBeNull();
  });
});

describe("ipv4ToInt", () => {
  it("parses dotted quads and refuses anything else", () => {
    expect(ipv4ToInt("0.0.0.0")).toBe(0);
    expect(ipv4ToInt("255.255.255.255")).toBe(4294967295);
    expect(ipv4ToInt("192.168.29.156")).toBe(3232243100);
    expect(ipv4ToInt("192.168.29.256")).toBeNull();
    expect(ipv4ToInt("192.168.29")).toBeNull();
    expect(ipv4ToInt("::1")).toBeNull();
  });
});

describe("isAllowedAddress", () => {
  const list = parseAllowlist("loopback,192.168.29.156");

  it("is unrestricted when nothing is configured", () => {
    expect(isAllowedAddress("203.0.113.9", [])).toBe(true);
    expect(isAllowedAddress(null, [])).toBe(true);
  });

  it("admits the machine itself, over IPv4 or IPv6 loopback", () => {
    expect(isAllowedAddress("127.0.0.1", list)).toBe(true);
    expect(isAllowedAddress("127.1.2.3", list)).toBe(true);
    expect(isAllowedAddress("::1", list)).toBe(true);
    expect(isAllowedAddress("::ffff:127.0.0.1", list)).toBe(true);
  });

  it("admits the configured address in either notation", () => {
    expect(isAllowedAddress("192.168.29.156", list)).toBe(true);
    expect(isAllowedAddress("::ffff:192.168.29.156", list)).toBe(true);
  });

  it("refuses every other address, including near neighbours on the same LAN", () => {
    expect(isAllowedAddress("192.168.29.157", list)).toBe(false);
    expect(isAllowedAddress("192.168.29.15", list)).toBe(false);
    expect(isAllowedAddress("10.0.0.1", list)).toBe(false);
    expect(isAllowedAddress("203.0.113.9", list)).toBe(false);
  });

  it("refuses an address it cannot parse rather than letting it through", () => {
    expect(isAllowedAddress(null, list)).toBe(false);
    expect(isAllowedAddress("", list)).toBe(false);
    expect(isAllowedAddress("not-an-ip", list)).toBe(false);
  });

  it("matches IPv4 CIDR ranges on the boundary, not just in the middle", () => {
    const lan = parseAllowlist("192.168.29.0/24");
    expect(isAllowedAddress("192.168.29.0", lan)).toBe(true);
    expect(isAllowedAddress("192.168.29.255", lan)).toBe(true);
    expect(isAllowedAddress("192.168.30.0", lan)).toBe(false);
    expect(isAllowedAddress("192.168.28.255", lan)).toBe(false);

    const thirty = parseAllowlist("10.1.2.4/30");
    expect(isAllowedAddress("10.1.2.4", thirty)).toBe(true);
    expect(isAllowedAddress("10.1.2.7", thirty)).toBe(true);
    expect(isAllowedAddress("10.1.2.8", thirty)).toBe(false);

    // /0 is "everything", and must not be confused with the empty list.
    expect(isAllowedAddress("203.0.113.9", parseAllowlist("0.0.0.0/0"))).toBe(true);
    // A /32 is a single host.
    expect(isAllowedAddress("10.1.2.4", parseAllowlist("10.1.2.4/32"))).toBe(true);
    expect(isAllowedAddress("10.1.2.5", parseAllowlist("10.1.2.4/32"))).toBe(false);
  });

  it("refuses a malformed prefix instead of widening the range", () => {
    expect(isAllowedAddress("10.1.2.4", parseAllowlist("10.1.2.4/33"))).toBe(false);
    expect(isAllowedAddress("10.1.2.4", parseAllowlist("10.1.2.4/abc"))).toBe(false);
  });

  it("compares IPv6 entries on their normalised form", () => {
    const v6 = parseAllowlist("fe80::1");
    expect(isAllowedAddress("fe80::1", v6)).toBe(true);
    expect(isAllowedAddress("FE80::1", v6)).toBe(true);
    expect(isAllowedAddress("fe80::2", v6)).toBe(false);
  });

  it("drops blank entries rather than treating them as a wildcard", () => {
    const sloppy = parseAllowlist(" , ,192.168.29.156, ");
    expect(sloppy).toEqual(["192.168.29.156"]);
    expect(isAllowedAddress("10.0.0.1", sloppy)).toBe(false);
  });
});
