// Un campo que no existe se rechaza en vez de descartarlo sin avisar: quien manda
// `active` al crear un servicio, o `clientId` al reservar, sabe que no se aplicó.
// Se usa como opciones de `z.strictObject`.
export const onlyKnownFields = {
  error: (issue: { code: string; keys?: string[] }) =>
    issue.code === "unrecognized_keys"
      ? `No se aceptan estos campos: ${issue.keys?.join(", ")}.`
      : undefined,
};
