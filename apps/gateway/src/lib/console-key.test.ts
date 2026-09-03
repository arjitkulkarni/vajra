import { describe, expect, it } from "vitest";
import { consoleKey, consoleKeyMatches, consoleUrl } from "./console-key";

describe("console key", () => {
  it("is deterministic, so a restart does not invalidate the link an operator holds", () => {
    expect(consoleKey("s3cret")).toBe(consoleKey("s3cret"));
  });

  it("is the full 256-bit digest, not a truncation", () => {
    expect(consoleKey("s3cret")).toHaveLength(43); // 32 bytes, base64url, unpadded
  });

  it("changes completely when the secret rotates", () => {
    const before = consoleKey("s3cret");
    const after = consoleKey("s3cret-rotated");
    expect(after).not.toBe(before);
    expect(consoleKeyMatches("s3cret-rotated", before)).toBe(false);
  });

  it("accepts the key it derives and refuses everything else", () => {
    const key = consoleKey("s3cret");
    expect(consoleKeyMatches("s3cret", key)).toBe(true);
    expect(consoleKeyMatches("s3cret", `${key.slice(0, -1)}x`)).toBe(false); // one character off
    expect(consoleKeyMatches("s3cret", key.slice(0, -1))).toBe(false); // truncated
    expect(consoleKeyMatches("s3cret", `${key}x`)).toBe(false); // extended
    expect(consoleKeyMatches("s3cret", consoleKey("other"))).toBe(false); // another deployment's
  });

  it("refuses an absent key rather than throwing", () => {
    // timingSafeEqual throws on a length mismatch, so the guard has to come first — a 500 here
    // would be a refusal the caller could tell apart from a wrong key by the status code alone.
    for (const absent of [undefined, null, ""]) expect(consoleKeyMatches("s3cret", absent)).toBe(false);
  });

  it("builds a link against the first configured origin", () => {
    const url = consoleUrl("https://vajra.example,http://localhost:3000", "s3cret", "hi");
    expect(url).toBe(`https://vajra.example/hi/admin?k=${consoleKey("s3cret")}`);
  });

  it("survives a wildcard origin and a trailing slash", () => {
    expect(consoleUrl("*", "s3cret")).toContain("http://localhost:3000/en/admin?k=");
    expect(consoleUrl("https://vajra.example/", "s3cret")).toContain("https://vajra.example/en/admin?k=");
  });
});
