// Tema claro u oscuro. Sin elección guardada, sigue al celular (CSS con prefers-color-scheme);
// con una elección, `data-theme` en <html> la impone. El script del <head> (BaseLayout) aplica
// la elección guardada antes de pintar, para que no parpadee.

export type Theme = "light" | "dark";

export const THEME_KEY = "theme";

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// El tema que se ve ahora: el elegido en el sitio o, si no hay, el del celular.
export function currentTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  return chosen === "dark" || chosen === "light" ? chosen : systemTheme();
}

// Aplica el tema y lo recuerda en este dispositivo. Si el navegador no deja guardar (modo
// privado, almacenamiento bloqueado), el cambio vale igual para esta página.
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Sin almacenamiento: no se recuerda, pero se ve.
  }
}
