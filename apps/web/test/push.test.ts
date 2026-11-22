import { describe, expect, it } from "vitest";
import { base64UrlToBytes, sameServerKey } from "../src/lib/push";

describe("base64UrlToBytes", () => {
  it("convierte base64url sin relleno a los bytes originales", () => {
    // "+/8=" en base64 normal: los caracteres que cambian en base64url.
    expect(Array.from(base64UrlToBytes("-_8"))).toEqual([0xfb, 0xff]);
    expect(Array.from(base64UrlToBytes("AQID"))).toEqual([1, 2, 3]);
  });
});

describe("sameServerKey", () => {
  const key = "AQID"; // bytes 1, 2, 3
  const buffer = (bytes: number[]) => new Uint8Array(bytes).buffer;

  it("la misma clave en bytes es la misma", () => {
    expect(sameServerKey(buffer([1, 2, 3]), key)).toBe(true);
  });

  it("otros bytes u otro largo es otra clave", () => {
    expect(sameServerKey(buffer([1, 2, 4]), key)).toBe(false);
    expect(sameServerKey(buffer([1, 2]), key)).toBe(false);
  });

  it("si el navegador no informa la clave, se da por buena", () => {
    expect(sameServerKey(null, key)).toBe(true);
  });
});
