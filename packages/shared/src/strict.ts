// Un campo que no existe se rechaza en vez de descartarlo sin avisar: quien manda
// `active` o `sortOrder` al crear un servicio sabe que no se aplicaron.
// Se usa como opciones de `z.strictObject`.
export const onlyKnownFields = {
  error: (issue: { code: string; keys?: string[] }) =>
    issue.code === "unrecognized_keys"
      ? `No se aceptan estos campos: ${issue.keys?.join(", ")}.`
      : undefined,
};
