import { useEffect, useState } from "react";
import { applyTheme, currentTheme, type Theme } from "../lib/theme";

// Botón para pasar de tema claro a oscuro y al revés. Muestra el ícono del tema al que lleva.
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>();

  // El tema se lee en el navegador: al compilar la página no se sabe.
  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  if (!theme) return <span className="size-11" aria-hidden="true" />;

  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      aria-label={next === "dark" ? "Cambiar a tema oscuro" : "Cambiar a tema claro"}
      className="flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-alt hover:text-ink"
    >
      {next === "dark" ? (
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}
