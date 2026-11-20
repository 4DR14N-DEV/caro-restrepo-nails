import { describe, expect, it } from "vitest";
import { ipBlock } from "../src/auth/rate-limit.js";

describe("ipBlock", () => {
  it("deja las IPv4 tal cual", () => {
    expect(ipBlock("203.0.113.1")).toBe("203.0.113.1");
  });

  it("convierte las IPv4 escritas como IPv6 a IPv4", () => {
    expect(ipBlock("::ffff:203.0.113.1")).toBe("203.0.113.1");
    expect(ipBlock("::FFFF:cb00:7101")).toBe("203.0.113.1");
    expect(ipBlock("0:0:0:0:0:ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(ipBlock("::ffff:0:0")).toBe("0.0.0.0");
  });

  it("no confunde una IPv4 dentro de otra IPv6 con una IPv4", () => {
    expect(ipBlock("2001:db8::ffff:1.2.3.4")).toBe("2001:db8:0:0::/64");
  });

  it("la zona no cambia el bloque", () => {
    expect(ipBlock("2001:db8:1:2::1%a")).toBe(ipBlock("2001:db8:1:2::1%b"));
  });

  it("agrupa las IPv6 por su bloque /64", () => {
    expect(ipBlock("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
    expect(ipBlock("2001:DB8:1:2::9")).toBe("2001:db8:1:2::/64");
    expect(ipBlock("2001:db8:0001:0002:ffff::")).toBe("2001:db8:1:2::/64");
    expect(ipBlock("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipBlock("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(ipBlock("::1")).toBe("0:0:0:0::/64");
    expect(ipBlock("::")).toBe("0:0:0:0::/64");
  });

  it("deja igual lo que no es una IP", () => {
    expect(ipBlock("desconocida")).toBe("desconocida");
    expect(ipBlock("")).toBe("");
  });
});
