import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("GET /api/health", () => {
  it("responde 200 con el estado del servicio", async () => {
    const response = await request(createApp()).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("no expone la cabecera x-powered-by", async () => {
    const response = await request(createApp()).get("/api/health");

    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("responde 404 en JSON para rutas desconocidas", async () => {
    const response = await request(createApp()).get("/api/no-existe");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "not_found" });
  });
});
