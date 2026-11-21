// Preguntas por consola, respondidas línea por línea. Las líneas que llegan antes de
// preguntar (una entrada por tubería con todas las respuestas juntas) quedan en espera
// para la pregunta siguiente. Si la entrada se termina antes de responder (Ctrl+D, o una
// entrada corta), se cancela en vez de quedarse esperando. Cualquier otro error de la
// entrada se muestra tal cual.
export function createAsk(
  lines: AsyncIterable<string>,
  write: (text: string) => void,
  cancel: () => never,
) {
  // El iterador se crea ya, para no perder las líneas que lleguen antes de la primera pregunta.
  const pending = lines[Symbol.asyncIterator]();

  return async function ask(question: string): Promise<string> {
    write(question);
    const line = await pending.next();
    return line.done ? cancel() : line.value;
  };
}
