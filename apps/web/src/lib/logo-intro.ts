// Animación de entrada del letrero en la portada (GSAP). Se ve una vez por visita y nunca con
// "reducir movimiento". Un script en línea de la portada decide con `shouldPlayIntro` antes de
// pintar y marca <html> con INTRO_CLASS, que oculta las partes del letrero; después
// `startLogoIntro` las anima. Sin JavaScript, o si GSAP no llega a tiempo, el letrero se ve
// armado.

export const INTRO_CLASS = "logo-intro";

interface IntroWindow {
  matchMedia(query: string): { matches: boolean };
  sessionStorage: Pick<Storage, "getItem" | "setItem">;
}

// Va sin imports ni constantes de afuera: la portada la copia tal cual en un script en línea.
export function shouldPlayIntro(win: IntroWindow): boolean {
  if (win.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  try {
    return win.sessionStorage.getItem("logo-intro-seen") !== "1";
  } catch {
    // Sin acceso a la sesión no se puede saber si ya se vio: se anima.
    return true;
  }
}

interface TimelineLike {
  to(targets: unknown, vars: object, position?: number): TimelineLike;
  fromTo(targets: unknown, from: object, to: object, position?: number): TimelineLike;
}

interface GsapLike {
  set(targets: unknown, vars: object): unknown;
  timeline(vars?: object): TimelineLike;
}

// Anima el letrero si la portada lo marcó. Devuelve si arrancó la animación.
export function startLogoIntro(
  svg: SVGSVGElement | null,
  doc: Document,
  win: IntroWindow,
  gsap: GsapLike,
): boolean {
  const html = doc.documentElement;
  if (!html.classList.contains(INTRO_CLASS)) return false;
  if (!svg) {
    html.classList.remove(INTRO_CLASS);
    return false;
  }
  try {
    win.sessionStorage.setItem("logo-intro-seen", "1");
  } catch {
    // Sin sesión se repetirá en la próxima visita a la portada; no pasa nada más.
  }

  const glyphs = svg.querySelectorAll(".logo-glyph");
  const lines = svg.querySelectorAll(".logo-line");
  const word = svg.querySelector(".logo-word");
  const bird = svg.querySelector(".logo-bird");
  const wing = svg.querySelector(".logo-wing");

  // Estado inicial puesto por GSAP; recién ahí se quita la marca que ocultaba todo con CSS.
  gsap.set(glyphs, { fillOpacity: 0, strokeWidth: 1.2, drawSVG: "0%" });
  gsap.set(lines, { drawSVG: "0%" });
  gsap.set(word, { opacity: 0, y: 6 });
  gsap.set(bird, { opacity: 0, x: 60, y: -40 });
  html.classList.remove(INTRO_CLASS);

  // Unos 2,6 s: el nombre se escribe con un trazo dorado y se rellena, se abren las líneas
  // con "NAILS", y el colibrí entra aleteando y se posa.
  gsap
    .timeline({ defaults: { ease: "power2.out" } })
    .to(glyphs, { drawSVG: "100%", duration: 0.5, stagger: 0.09, ease: "power1.inOut" }, 0)
    .to(glyphs, { fillOpacity: 1, strokeWidth: 0, duration: 0.5, stagger: 0.05 }, 0.6)
    .to(lines, { drawSVG: "100%", duration: 0.6, ease: "power2.inOut" }, 1.3)
    .to(word, { opacity: 1, y: 0, duration: 0.5 }, 1.6)
    .to(bird, { opacity: 1, x: 0, y: 0, duration: 0.9, ease: "power3.out" }, 1.7)
    .fromTo(
      wing,
      { scaleY: 0.55 },
      {
        scaleY: 1,
        duration: 0.08,
        repeat: 9,
        yoyo: true,
        ease: "none",
        transformOrigin: "0% 100%",
      },
      1.7,
    );
  return true;
}
