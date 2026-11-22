Objetivo: entrega 15 de Caro Restrepo Nails: dejar el sitio listo para entregarlo a Caro (Supabase sin pausas, respaldo, lista de lanzamiento, README profesional y guía para Caro en PDF).
Rama: `feat/entrega-15-lanzamiento` · Estrategia de entrega: ask-on-risk · Runner de tests: Vitest (pnpm).

## Specs

- S1 — Supabase sin pausa (tabla #1): "Una función programada de Netlify que una vez al día hace una consulta mínima a la base, así el proyecto nunca pasa una semana sin actividad (D06). Corre solo en producción, es gratis y no expone nada hacia afuera."
- S2 — Respaldo (tabla #2): "El plan gratis de Supabase no da respaldos descargables. Documento un comando de respaldo manual (`pg_dump` con el pooler) para correr antes del lanzamiento y una vez al mes, y cómo restaurarlo. No lo automatizo: eso pide guardar la clave de la base en otro servicio."
- S3 — Lista de lanzamiento (tabla #3): "Una sección en el README con todo lo que tiene que estar listo: variables en Netlify, cuenta de Caro con su contraseña propia, avisos activados en su celular, página instalada, política aprobada y primer respaldo hecho."
- S4 — Guía para Caro (tabla #4): "Una guía corta y sin términos técnicos, con el paso a paso de: ver la agenda, crear o mover citas, bloquear días, cambiar el horario y los servicios, restablecer contraseñas de clientas y activar los avisos." Usuario: "La guia corta me la podes dar en un .pdf para yo enviarmela al correo y usarla en la reu con Caro."
- S5 — Política de datos (tabla #5): "No la toco: la revisa Caro en la reunión."
- S6 — Dominio propio (tabla #6): "Fuera de esta entrega hasta que Caro decida si lo quiere y lo compre. Dejo en el README los pasos para conectarlo en Netlify."
- S7 — README (usuario): "edita el README.md para mostrar un aspecto ma sprofesional, incluye un banner ocn el letreto de Caro Restrepo Nails, las tecnologias y herramientas en badges y todo bien explicado, bien profesional."

## Tasks

| ID  | Specs          | Ruta   | Estado | Commit      |
| --- | -------------- | ------ | ------ | ----------- |
| T1  | S1             | inline | hecha  | 642af03     |
| T2  | S2, S3, S6, S7 | inline | hecha  | 092bdf5     |
| T3  | S4             | inline | hecha  | ver git log |

Ruta: todo inline. Riesgo previsto: ítem 5 (la función programada es nueva en Netlify): se verifica al otro día del merge en el registro de Netlify.

## Log

- L1 (2026-11-22, usuario): "quedo mergeada y probado, todo bien. limpia rama y continuemos" → propuesta de la entrega 15 (tabla de 6 decisiones, 3 tareas).
- L2 (2026-11-22, usuario): "arranquemos así, adicional edita el README.md para mostrar un aspecto ma sprofesional, incluye un banner ocn el letreto de Caro Restrepo Nails, las tecnologias y herramientas en badges y todo bien explicado, bien profesional. La guia corta me la podes dar en un .pdf para yo enviarmela al correo y usarla en la reu con Caro." (aprueba S1–S6; agrega S7 y el PDF de S4).
- L3: T1. Verificado en la documentación oficial: Netlify corre las funciones programadas solo en el deploy publicado, con hasta 30 s y horario en UTC (`export const config = { schedule }`); Supabase pausa los proyectos gratis con poca actividad en 7 días, "unas pocas consultas a la base por día" suelen alcanzar, y avisa por correo una semana antes. `src/db/keepalive.ts`: `pingDatabase` (cuenta los servicios: una tabla real, no `select 1`) y `runKeepAlive` (abre una conexión con 10 s de espera máxima, consulta, la cierra y nunca lanza; sin `DATABASE_URL` o si la base no responde, lo deja en el log y devuelve false). `netlify/functions/keepalive.ts`: función programada cada 6 horas (`0 */6 * * *`, 4 consultas por día). `createDatabase` acepta `connectionTimeoutMillis`. RED: keepalive (inexistente) → 4/4 verdes. Prueba de empaquetado con esbuild (como Netlify) y ejecución contra la base local: "Base activa: 10 servicios.". Verificación pendiente: al otro día del merge, ver en Netlify (Logs → Functions → keepalive) que corrió.
- L4: T2. README reescrito: banner `docs/assets/banner.png` (el letrero real en SVG de la portada, con fondo del tema claro y el lema, capturado con Brave sin interfaz), badges de CI, accesibilidad 100, costo $0 y mobile first, y de cada tecnología con su versión mayor (Astro, React, TypeScript, Tailwind, GSAP, Node, Express, Drizzle, Zod, PostgreSQL/Supabase, Netlify, Vitest, ESLint, Prettier, pnpm). Secciones: qué hace (clientas, Caro, sistema), tecnologías con su porqué, arquitectura, desarrollo local y comandos, páginas, producción (variables, Supabase sin pausa con cómo comprobar `keepalive`, respaldo y restauración con `pg_dump`/`pg_restore` en Docker usando el modo sesión y solo los esquemas `public` y `drizzle`, aviso de datos personales, dominio propio), lista de lanzamiento (checklist), calidad y convenciones.
- L5: T3. Guía para Caro en `docs/guia-caro.html` (fuente) y `docs/guia-caro.pdf` (A4, 6 páginas: portada con el banner y 9 secciones: antes de empezar —entrar, instalar la página, activar avisos—, agenda, crear/mover/cancelar/marcar/recordar citas, bloqueos y descansos, horario y reglas, servicios, clientas, lo que pueden hacer las clientas y qué hacer si algo no funciona). Cada botón citado se tomó del texto real de los componentes. Se imprimió con Brave sin interfaz (`--print-to-pdf`) sirviendo la página junto al sitio compilado para usar sus fuentes y colores; se revisaron las páginas y se corrigieron las viñetas (el CSS del sitio las quita), los cortes de página y la tabla partida. De paso, un botón que se escapó en la auditoría de la entrega 14: cada resultado de "Buscar clienta" en la cita nueva medía 40 px → 44 px. README enlaza la guía.
- L6 (2026-11-22, usuario): "quedo mergeada, dale". PR #15 mergeado en `main` (`7928550`). Sin migraciones. Rama borrada (local y GitHub). Pendiente: al otro día, confirmar en Netlify (Logs → Functions → `keepalive`) que corrió; reunión con Caro con la lista de lanzamiento del README y `docs/guia-caro.pdf`. Entrega cerrada.
