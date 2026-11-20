import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createAsk } from "../src/db/ask.js";

class Cancelled extends Error {}

// Prompt falso: cada pregunta queda pendiente hasta que el test la responde o la rechaza.
function fakePrompt() {
  const events = new EventEmitter();
  let pending: { resolve: (answer: string) => void; reject: (error: unknown) => void };
  return {
    events,
    question: () =>
      new Promise<string>((resolve, reject) => {
        pending = { resolve, reject };
      }),
    answer: (text: string) => pending.resolve(text),
    fail: (error: unknown) => pending.reject(error),
  };
}

function setup() {
  const prompt = fakePrompt();
  const ask = createAsk(prompt.events, () => {
    throw new Cancelled();
  });
  return { prompt, ask };
}

describe("createAsk", () => {
  it("devuelve la respuesta", async () => {
    const { prompt, ask } = setup();
    const answer = ask(prompt.question);
    prompt.answer("Caro Restrepo");
    await expect(answer).resolves.toBe("Caro Restrepo");
  });

  it("cancela si la entrada se cierra mientras espera (Ctrl+D)", async () => {
    const { prompt, ask } = setup();
    const answer = ask(prompt.question);
    prompt.events.emit("close");
    await expect(answer).rejects.toBeInstanceOf(Cancelled);
  });

  it("cancela si se cierra y la pregunta además falla por el cierre", async () => {
    const { prompt, ask } = setup();
    const answer = ask(prompt.question);
    prompt.events.emit("close");
    prompt.fail(new Error("readline was closed"));
    await expect(answer).rejects.toBeInstanceOf(Cancelled);
  });

  it("cancela de inmediato si la entrada ya estaba cerrada", async () => {
    const { prompt, ask } = setup();
    prompt.events.emit("close");
    await expect(ask(prompt.question)).rejects.toBeInstanceOf(Cancelled);
  });

  it("muestra cualquier otro error tal cual, sin cancelar", async () => {
    const { prompt, ask } = setup();
    const answer = ask(prompt.question);
    const error = new Error("falla de la terminal");
    prompt.fail(error);
    await expect(answer).rejects.toBe(error);
  });

  it("usa un solo aviso de cierre para todas las preguntas", async () => {
    const { prompt, ask } = setup();
    for (const name of ["Nombre", "Celular", "Contraseña", "Repite"]) {
      const answer = ask(prompt.question);
      prompt.answer(name);
      await answer;
    }
    expect(prompt.events.listenerCount("close")).toBe(1);
  });
});
