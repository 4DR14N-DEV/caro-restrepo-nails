import { describe, expect, it } from "vitest";
import { nextPath } from "../src/lib/next";

describe("nextPath", () => {
  it("vuelve a una ruta interna, con su consulta", () => {
    expect(nextPath("?next=/reservar")).toBe("/reservar");
    expect(nextPath("?next=%2Freservar%3Fpaso%3D2")).toBe("/reservar?paso=2");
  });

  it("sin next, o con algo que no es una ruta interna, va al inicio", () => {
    for (const search of [
      "",
      "?next=",
      "?next=reservar",
      "?next=https://otro-sitio.com",
      "?next=//otro-sitio.com",
      "?next=%2F%2Fotro-sitio.com",
      "?next=/%5Cotro-sitio.com",
      "?next=/\\otro-sitio.com",
      "?next=/%09/otro-sitio.com",
      "?next=javascript:alert(1)",
    ]) {
      expect(nextPath(search), search).toBe("/");
    }
  });

  it("no deja que un ../ normalice la ruta a otro sitio", () => {
    for (const next of ["/..//evil.com", "/.//evil.com", "/a/..//evil.com", "/%2e%2e//evil.com"]) {
      expect(nextPath(`?next=${encodeURIComponent(next)}`), next).toBe("/");
    }
  });
});
