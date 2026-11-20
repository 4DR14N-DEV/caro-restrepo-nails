import { describe, expect, it } from "vitest";
import { createAsk } from "../src/db/ask.js";

class Cancelled extends Error {}

// Entrada falsa: las líneas llegan cuando el test las envía; `end` cierra la entrada.
function fakeInput() {
  const queue: string[] = [];
  let ended = false;
  let failure: unknown;
  let wake = () => {};
  async function* lines() {
    for (;;) {
      if (failure) throw failure;
      const line = queue.shift();
      if (line !== undefined) yield line;
      else if (ended) return;
      else await new Promise<void>((resolve) => (wake = resolve));
    }
  }
  const notify = () => wake();
  return {
    lines: lines(),
    send: (line: string) => (queue.push(line), notify()),
    end: () => ((ended = true), notify()),
    fail: (error: unknown) => ((failure = error), notify()),
  };
}

function setup() {
  const input = fakeInput();
  const written: string[] = [];
  const ask = createAsk(
    input.lines,
    (text) => written.push(text),
    () => {
      throw new Cancelled();
    },
  );
  return { input, written, ask };
}

describe("createAsk", () => {
  it("muestra la pregunta y devuelve la respuesta", async () => {
    const { input, written, ask } = setup();
    const answer = ask("Nombre: ");
    input.send("Caro Restrepo");
    await expect(answer).resolves.toBe("Caro Restrepo");
    expect(written).toEqual(["Nombre: "]);
  });

  it("guarda las respuestas que llegan antes de preguntar (entrada por tubería)", async () => {
    const { input, ask } = setup();
    for (const line of ["Caro", "3105551234", "clave", "clave"]) input.send(line);
    input.end();

    expect(await ask("Nombre: ")).toBe("Caro");
    expect(await ask("Celular: ")).toBe("3105551234");
    expect(await ask("Contraseña: ")).toBe("clave");
    expect(await ask("Repite: ")).toBe("clave");
  });

  it("cancela si la entrada se cierra mientras espera (Ctrl+D)", async () => {
    const { input, ask } = setup();
    const answer = ask("Nombre: ");
    input.end();
    await expect(answer).rejects.toBeInstanceOf(Cancelled);
  });

  it("cancela si la entrada termina antes de la última respuesta", async () => {
    const { input, ask } = setup();
    input.send("Caro");
    input.end();
    expect(await ask("Nombre: ")).toBe("Caro");
    await expect(ask("Celular: ")).rejects.toBeInstanceOf(Cancelled);
  });

  it("muestra cualquier otro error tal cual, sin cancelar", async () => {
    const { input, ask } = setup();
    const answer = ask("Nombre: ");
    const error = new Error("falla de la terminal");
    input.fail(error);
    await expect(answer).rejects.toBe(error);
  });
});
