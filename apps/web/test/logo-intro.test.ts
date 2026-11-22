// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { INTRO_CLASS, shouldPlayIntro, startLogoIntro } from "../src/lib/logo-intro";

// Ventana falsa: si pide menos movimiento y qué hay guardado en la sesión.
function fakeWindow({ reducedMotion = false, seen = false, storageFails = false } = {}) {
  const stored = new Map<string, string>(seen ? [["logo-intro-seen", "1"]] : []);
  return {
    matchMedia: (query: string) => ({
      matches: reducedMotion && query === "(prefers-reduced-motion: reduce)",
    }),
    sessionStorage: {
      getItem: (key: string) => {
        if (storageFails) throw new Error("bloqueado");
        return stored.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (storageFails) throw new Error("bloqueado");
        stored.set(key, value);
      },
    },
    stored,
  };
}

// GSAP falso: registra si se armó la animación.
function fakeGsap() {
  const timeline = { set: vi.fn(), to: vi.fn(), from: vi.fn(), fromTo: vi.fn(), add: vi.fn() };
  for (const method of Object.values(timeline)) method.mockReturnValue(timeline);
  return { timeline: vi.fn(() => timeline), set: vi.fn(), registerPlugin: vi.fn() };
}

afterEach(() => {
  document.documentElement.classList.remove(INTRO_CLASS);
  document.body.innerHTML = "";
});

describe("shouldPlayIntro", () => {
  it("la primera vez en la visita, sin reducir movimiento, se anima", () => {
    expect(shouldPlayIntro(fakeWindow())).toBe(true);
  });

  it("con reducir movimiento no se anima: el letrero aparece armado", () => {
    expect(shouldPlayIntro(fakeWindow({ reducedMotion: true }))).toBe(false);
  });

  it("si ya se vio en esta visita, no se repite", () => {
    expect(shouldPlayIntro(fakeWindow({ seen: true }))).toBe(false);
  });

  it("si el navegador no deja leer la sesión, se anima igual", () => {
    expect(shouldPlayIntro(fakeWindow({ storageFails: true }))).toBe(true);
  });
});

describe("startLogoIntro", () => {
  const logo = () => {
    document.body.innerHTML = '<svg class="logo-hero"><g class="logo-name"></g></svg>';
    return document.querySelector<SVGSVGElement>(".logo-hero");
  };

  it("sin la marca de animación en la página no toca nada", () => {
    const gsap = fakeGsap();
    const win = fakeWindow();
    expect(startLogoIntro(logo(), document, win, gsap)).toBe(false);
    expect(gsap.timeline).not.toHaveBeenCalled();
    expect(win.stored.has("logo-intro-seen")).toBe(false);
  });

  it("con la marca, arma la animación y la recuerda para esta visita", () => {
    document.documentElement.classList.add(INTRO_CLASS);
    const gsap = fakeGsap();
    const win = fakeWindow();
    expect(startLogoIntro(logo(), document, win, gsap)).toBe(true);
    expect(gsap.timeline).toHaveBeenCalledTimes(1);
    expect(win.stored.get("logo-intro-seen")).toBe("1");
  });

  it("sin letrero en la página, quita la marca para que nada quede oculto", () => {
    document.documentElement.classList.add(INTRO_CLASS);
    const gsap = fakeGsap();
    expect(startLogoIntro(null, document, fakeWindow(), gsap)).toBe(false);
    expect(document.documentElement.classList.contains(INTRO_CLASS)).toBe(false);
  });
});
