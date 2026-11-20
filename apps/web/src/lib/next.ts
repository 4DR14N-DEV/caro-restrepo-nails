const SAME_ORIGIN = "https://caro.invalid";

// Página a la que volver después de ingresar o crear la cuenta (?next=/reservar).
// Solo se aceptan rutas internas: nunca "//otro-sitio.com", "/\otro-sitio.com" ni una URL
// completa, para que el enlace no sirva para mandar a la clienta a otra página. Los
// espacios y caracteres de control se rechazan porque el navegador los quita al navegar.
export function nextPath(search: string): string {
  const next = new URLSearchParams(search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\s\p{Cc}]/u.test(next)) {
    return "/";
  }
  const url = new URL(next, SAME_ORIGIN);
  return url.origin === SAME_ORIGIN ? url.pathname + url.search + url.hash : "/";
}
