// Preguntas por consola que se cancelan si la entrada se cierra (Ctrl+D, o una entrada que
// termina antes de tiempo), en vez de mostrar el error interno o quedarse esperando.
// Un solo aviso de cierre sirve para todas las preguntas.
export function createAsk(
  prompt: { once(event: "close", listener: () => void): unknown },
  cancel: () => never,
) {
  let closed = false;
  const closedPrompt = new Promise<null>((resolve) =>
    prompt.once("close", () => {
      closed = true;
      resolve(null);
    }),
  );

  // Solo el cierre de la entrada cancela; cualquier otro error se muestra tal cual.
  return async function ask(question: () => Promise<string>): Promise<string> {
    if (closed) cancel();
    const answer = await Promise.race([question(), closedPrompt]).catch((error: unknown) => {
      if (closed) return null;
      throw error;
    });
    return answer ?? cancel();
  };
}
