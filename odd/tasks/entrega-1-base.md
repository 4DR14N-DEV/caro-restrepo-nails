Objetivo: entrega 1 (base) de Caro Restrepo Nails: monorepo, herramientas, CI, esquema de base de datos con migraciones y documentación de decisiones.
Rama: `feat/entrega-1-base` · Estrategia de entrega: ask-on-risk · Runner de tests: Vitest (pnpm).

## Specs

- S1 — Documentar en el repo las decisiones del discovery (requisitos, roles, reglas de negocio, modelo de datos, stack) para que no dependan solo de Engram. Fuente: decisiones aprobadas el 2026-11-17/18.
- S2 — Monorepo con pnpm workspaces: `apps/api` (Express + TS) y `apps/web` (Astro + React en islas + Tailwind). TypeScript estricto, ESLint + Prettier. "Recuerda que el gestor de paquetes es pnpm".
- S3 — Backend independiente de la plataforma: `createApp()` de Express + adaptador fino para Netlify Functions (`serverless-http`). Endpoint `/api/health` con test (Vitest + Supertest).
- S4 — Esquema de base de datos con Drizzle sobre `pg` y migraciones: users, sessions, services, appointments (`occupied_until` = fin + margen, restricción de exclusión sobre `tstzrange(start_at, occupied_until)` para citas activas), appointment_services (copia de nombre, precio y duración), business_hours, schedule_exceptions (block | break | extra_open), holidays, settings (fila única con reglas configurables), push_subscriptions. Dinero en COP como enteros; fechas `timestamptz`.
- S5 — Datos iniciales: catálogo real de servicios, horario base lunes a sábado 9:00–19:00 y reglas por defecto (margen 10 min, anticipación 2 días a 1 mes, cancelar hasta 2 h antes, reprogramar con 2 días).
- S6 — CI en GitHub Actions: lint, typecheck y tests en cada PR.
- S7 — Convenciones: código e identificadores en inglés; "comentarios en español, al momento somos tu y yo en el proyecto"; textos de UI en español; Conventional Commits.

## Tasks

| ID  | Specs    | Ruta   | Estado | Commit           |
| --- | -------- | ------ | ------ | ---------------- |
| T1  | S1, S7   | inline | hecho  | 8689835          |
| T2  | S2, S7   | inline | hecho  | 8689835, d0a3fc7 |
| T3  | S3       | inline | hecho  | 8689835          |
| T4  | S4, S5   | inline | hecho  | be40d32          |
| T5  | S2 (web) | inline | hecho  | 5b1bb7b          |
| T6  | S6       | inline | hecho  | 5b1bb7b, d0a3fc7 |

Ruta: todo inline; no hay trigger de writer (las unidades dependen entre sí y cada una es chica).

## Log

- L1 (2026-11-18, usuario): "Sí, va, arranquemos con la entrega 1. una unica cosa, comentarios en español, al momento somos tu y yo en el proyecto"
- L2 (2026-11-18, usuario): "Recurda que el gestor de paquetes es pnpm"
- L3: TypeScript fijado en 6.0.x porque typescript-eslint 8.73 exige `typescript <6.1.0` (TS 7 es `latest`).
- L4: RED/GREEN observado: health (módulo inexistente → 3 verdes); anti-superposición (2 rojos por falta de restricción → 6 verdes con 0001); seed (módulo inexistente → 10 verdes).
- L5: Verificador independiente (ítem 5): S1–S5 y S7 pasan; S6 bloqueado porque pnpm 12 rechaza `install --frozen-lockfile` sin aprobar esbuild. Corregido con `allowBuilds` (d0a3fc7); recheck: install, format, lint, typecheck, test, test:db y build en exit 0.
- L6: Pendiente de verificar en el primer deploy: redirección `/api/*` → función con serverless-http, bundling con esbuild y Node 24 en Netlify.
- L7: Sugerencias no bloqueantes para entregas siguientes: índices en `appointment_services.service_id` y `push_subscriptions.user_id`; la app debe actualizar `updated_at`; confirmar con Caro si un servicio puede repetirse en una cita.
- L8: Revisión nativa: assess high (ítem 5 + shell en CI), lentes risk y reliability. El candidato completo (desde el árbol vacío) excedió el presupuesto de contexto del revisor (`lens_context_budget_exceeded`, sin autoridad creada); se redujo al tramo de riesgo be40d32..d0a3fc7 (CI, Netlify, política de builds). Consentimiento otorgado; resultado: aprobado y acuse hecho (`authority: burned`, lineage review-ea64b5e959474286).
- L9: Hallazgos no bloqueantes de la revisión: (a) fijar las actions de GitHub por SHA en vez de tag mayor; (b) "caro_test no existe en CI": descartado, `test/db/helpers.ts` la crea vía la base `postgres` y el usuario del servicio es superusuario; (c) confirmar en el primer deploy que Express recibe `/api/...` y no `/.netlify/functions/api/...` (ya anotado en L6).
