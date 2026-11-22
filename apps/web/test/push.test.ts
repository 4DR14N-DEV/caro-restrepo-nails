import { describe, expect, it } from "vitest";
import { base64UrlToBytes } from "../src/lib/push";

describe("base64UrlToBytes", () => {
  it("convierte base64url sin relleno a los bytes originales", () => {
    // "+/8=" en base64 normal: los caracteres que cambian en base64url.
    expect(Array.from(base64UrlToBytes("-_8"))).toEqual([0xfb, 0xff]);
    expect(Array.from(base64UrlToBytes("AQID"))).toEqual([1, 2, 3]);
  });
});
