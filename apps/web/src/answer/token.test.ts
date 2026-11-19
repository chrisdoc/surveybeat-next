import { describe, expect, it } from "vitest";
import { isWellFormedToken } from "./token.ts";

describe("isWellFormedToken", () => {
  it("accepts a token in the server's base64url alphabet", () => {
    expect(isWellFormedToken("AbCdEf0123456789_-AbCd")).toBe(true);
    expect(isWellFormedToken("token123")).toBe(true);
  });

  it("rejects a missing token", () => {
    expect(isWellFormedToken("")).toBe(false);
  });

  it("rejects a token with characters outside the base64url alphabet", () => {
    expect(isWellFormedToken("abc def")).toBe(false);
    expect(isWellFormedToken("abc.")).toBe(false);
    expect(isWellFormedToken("abc/def+")).toBe(false);
    expect(isWellFormedToken("abc=")).toBe(false);
  });
});
