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
  // Se revisa también la ruta ya normalizada: "/..//otro-sitio.com" queda como
  // "//otro-sitio.com", que el navegador toma como otro sitio.
  const url = new URL(next, SAME_ORIGIN);
  if (url.origin !== SAME_ORIGIN || url.pathname.startsWith("//")) return "/";
  return url.pathname + url.search + url.hash;
}
