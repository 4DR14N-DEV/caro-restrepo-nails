Objetivo: entrega 14 de Caro Restrepo Nails: auditar y corregir rendimiento móvil (RNF01) y accesibilidad básica (RNF08) sobre el diseño final, en tema claro y oscuro.
Rama: `feat/entrega-14-auditoria-rnf` · Estrategia de entrega: ask-on-risk · Runner de tests: Vitest (pnpm); auditoría con Lighthouse 13.6.0 (`pnpm dlx`, fuera del repo).

## Specs

- S1 — RNF01: "Mobile first y responsive; carga rápida con 4G." RNF08: "Accesibilidad básica: contraste, botones grandes, etiquetas."
- S2 — Herramienta (tabla #1): "Lighthouse 13.6.0 en modo móvil con 4G simulado. Se corre con `pnpm dlx` sobre Brave, sin agregarlo al repo."
- S3 — Qué páginas (tabla #2; son 11, no 12: error de conteo en la propuesta): "Las 12: las públicas (inicio, servicios, ingreso, registro, política), las de la clienta (reservar, mis citas) y las de Caro (agenda, servicios, horario, clientas). Las que piden sesión se auditan con la cookie de una cuenta de prueba."
- S4 — Contra qué (tabla #3): "El sitio compilado como en producción, con la API y la base locales y datos de prueba. No se toca Supabase."
- S5 — Metas (tabla #4): "Rendimiento ≥ 90 (RNF01) y Accesibilidad ≥ 95, sin fallas de contraste, etiquetas ni tamaño de botones (RNF08), en tema claro y oscuro."
- S6 — Lo que Lighthouse no ve (tabla #5): "Solo mide la página recién cargada. Los estados que aparecen después (errores, formularios abiertos, confirmaciones, la animación) los reviso a mano en el código: etiquetas, mensajes que se anuncian y botones de al menos 44 px."
- S7 — Resultado (tabla #6): "Una tabla de puntajes por página, antes y después, en el documento de la entrega. Las correcciones van en commits por tema (contraste, etiquetas, rendimiento), con test cuando cambie el comportamiento."
- S8 — Fuera de alcance (tabla #7): "Rediseño visual, funciones nuevas y meter Lighthouse en la CI. SEO y buenas prácticas solo se informan. Si sale algo grande, como cambiar un color de la paleta para que pase el contraste, te lo muestro antes de tocarlo."

## Tasks

| ID  | Specs          | Ruta   | Estado  | Commit      |
| --- | -------------- | ------ | ------- | ----------- |
| T1  | S2–S5, S7      | inline | hecha   | 87f3166     |
| T2  | S1, S5, S7, S8 | inline | hecha   | 87f3166     |
| T3  | S1, S5, S7, S8 | inline | parcial | ver git log |
| T4  | S6             | inline | hecha   | 87f3166     |

Ruta: todo inline. Riesgo previsto: ítem 6 (un cambio de contraste o tamaño no lo atrapa ningún test: capturas y revisión del usuario en el preview).

## Resultados

Lighthouse 13.6.0, móvil con 4G simulado, contra el sitio compilado servido con compresión y la API local. P = rendimiento, A = accesibilidad. Medición inicial (claro: segunda corrida con la máquina quieta; oscuro: primera corrida). Brave sin interfaz informa los archivos sin comprimir, así que los tiempos son más pesimistas que en Netlify; el TBT varía de una corrida a otra.

| Página           | Claro P | Claro A | Oscuro P | Oscuro A | LCP   |
| ---------------- | ------- | ------- | -------- | -------- | ----- |
| Inicio           | 82      | 100     | 91       | 100      | 1,2 s |
| Servicios        | 79      | 100     | 98       | 100      | 1,6 s |
| Ingreso          | 79      | 100     | 98       | 100      | 1,9 s |
| Registro         | 98      | 100     | 99       | 100      | 1,8 s |
| Política         | 99      | 100     | 99       | 100      | 1,8 s |
| Reservar         | 85      | 100     | 85       | 100      | 4,0 s |
| Mis citas        | 83      | 100     | 87       | 100      | 4,2 s |
| Agenda           | 85      | 100     | 82       | 100      | 4,1 s |
| Servicios (Caro) | 97      | 100     | 97       | 100      | 1,8 s |
| Horario          | 99      | 100     | 89       | 100      | 1,6 s |
| Clientas         | 99      | 100     | 99       | 100      | 1,2 s |

Hallazgos: accesibilidad sin fallas en ninguna página ni tema. Rendimiento: las páginas con datos (Reservar, Mis citas, Agenda) tienen LCP de ~4 s porque la API se consulta recién después de descargar y ejecutar el JavaScript; Zod (vía `@caro/shared`, 92 KB, 27 KB comprimido) se descarga en todas las páginas con islas aunque solo usen funciones de formato.

## Log

- L1 (2026-11-22, usuario): "listo, y luego de eso que? cuando hacemos deploy a producción para entregar a caro?" → plan: entrega 14 (auditoría), entrega 15 (lanzamiento), reunión con Caro. Usuario: "me parece bien".
- L2 (2026-11-22, usuario): "dale" (aprueba S2–S8 y T1–T4).

- L3: T1. Entorno: servidor temporal fuera del repo que sirve `apps/web/dist` con compresión (br/gzip) y caché larga para `/_astro`, y reenvía `/api` a la API local; Brave sin interfaz con puerto de depuración (claro en 9222, oscuro en 9223 con `preferredColorScheme=0`); sesión por cookie (`--extra-headers`) con las cuentas de prueba locales. 22 mediciones; la primera corrida en claro tuvo ruido de CPU (tests corriendo a la vez) y se repitió con la máquina quieta. Resultados en la sección Resultados.
- L4: T2 y T4 (accesibilidad). Lighthouse no encontró fallas; la revisión a mano sí: "Quitar" (bloqueos del día, `DaySchedule`) y "Cambiar" (clienta, `AppointmentForm`) medían 36 px → 44 px; "Volver al inicio" tras reservar y el teléfono en Clientas, enlaces sueltos, ahora con 44 px de alto (los enlaces dentro de una oración quedan exceptuados). Errores no anunciados: el de aceptar la política en el registro ahora se asocia a la casilla (`aria-describedby`), y los del horario y las reglas en el panel llevan `role="alert"`. Ya estaban bien: todos los campos tienen etiqueta, los demás errores se anuncian, foco visible y animación con "reducir movimiento". RED: RegisterForm 1 y AdminSchedule 1 → verdes.
- L5: T3 (rendimiento). `packages/shared` declara `"sideEffects": false`: Zod (83 KB) ya no se descarga en Reservar, Agenda ni el catálogo; Mis citas lo sigue cargando porque "Mi cuenta" valida la contraseña. `BaseLayout` acepta `preload` (`<link rel="preload" as="fetch" crossorigin="anonymous">`, mismas credenciales que `fetch` en `lib/api.ts`): Mis citas precarga `/api/auth/me` y `/api/appointments`; Reservar, `/api/auth/me`, `/api/services` y `/api/booking/days` (antes iban en dos tandas); la Agenda calcula en un script en línea el día (`?dia=` o hoy en Bogotá) y precarga `/api/admin/agenda?from=…&to=…`. Las precargas se consumen (sin pedidos duplicados). Nueva medición de las tres páginas (dos corridas por tema): rendimiento 81–88, LCP ~4 s, sin cambio. Diagnóstico: Brave (snap) recibe los archivos comprimidos (`br`) pero los informa con el tamaño descomprimido (HTML 23 KB en vez de ~5 KB; React 208 KB en vez de 57 KB), y la simulación de Lighthouse calcula los tiempos con esos tamaños, así que infla las descargas 3–4 veces; con `--throttling-method=devtools` la navegación se corta (`PROTOCOL_TIMEOUT`). Accesibilidad siguió en 100.
- L6 (2026-11-22, usuario): ante la opción de descargar Chrome for Testing para medir con números fieles, eligió "No, dejalo así". Se conservan las mejoras de rendimiento (menos JavaScript y datos pedidos antes) y queda **sin confirmar** con números fieles si Reservar, Mis citas y Agenda llegan a 90 (en la simulación inflada: 81–88); el resto de las páginas está en 90 o más en al menos una corrida limpia. Chequeos: test shared 70/70, api 36/36, web 167/167, typecheck, lint, formato y build en verde.
- L7 (2026-11-22, usuario): "quedo mergeada y probado, todo bien. limpia rama y continuemos". PR #14 mergeado en `main` (`bde6937`); preview probado por el usuario. Sin migraciones. Rama borrada (local y GitHub). Entrega cerrada.
