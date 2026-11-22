import { afterEach, describe, expect, it, vi } from "vitest";
import { pushServiceFromEnv } from "../src/push/sender.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pushServiceFromEnv", () => {
  it("sin variables VAPID no hay avisos y no se queja", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(pushServiceFromEnv({})).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it("con las tres variables usa la clave pública configurada", () => {
    const push = pushServiceFromEnv({
      VAPID_PUBLIC_KEY: " clave-publica ",
      VAPID_PRIVATE_KEY: "clave-privada",
      VAPID_SUBJECT: "mailto:caro@example.com",
    });
    expect(push?.publicKey).toBe("clave-publica");
  });

  it("si falta alguna, no hay avisos y lo dice en el log", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      pushServiceFromEnv({ VAPID_PUBLIC_KEY: "clave-publica", VAPID_PRIVATE_KEY: "clave-privada" }),
    ).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("VAPID_SUBJECT"));
  });
});
