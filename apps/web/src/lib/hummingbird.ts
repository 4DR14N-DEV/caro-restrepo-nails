// Colibrí de Caro: trazos de línea en un cuadro de 64 × 64. Se usa en el letrero, en los
// íconos y en los avisos.
export const HUMMINGBIRD_VIEWBOX = "0 0 64 64";

export const HUMMINGBIRD_PATHS = {
  // Pico, cabeza, lomo, cola en horquilla y vientre.
  body: "M2 24 L20 25.5 C21 21 25 19 29 20 C33 21 35 23 37 25 L56 46 L50 45 L53 52 L44 41 C38 36 32 33 27 32 C24 31.5 22 30 20.5 28 Z",
  // Ala levantada, con dos plumas.
  wing: "M33 24 C36 14 44 7 58 4 C54 10 49 16 42 22 C47 21 51 20 55 20 C50 25 43 28 37 28",
} as const;

export const HUMMINGBIRD_EYE = { cx: 26, cy: 24, r: 1 } as const;
