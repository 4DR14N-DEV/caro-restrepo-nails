Objetivo: entrega 3 de Caro Restrepo Nails: pendientes y limpieza de la entrega 2, catálogo público de servicios con selección y total (RF03, RF04) y gestión de servicios para Caro (RF16).
Rama: `feat/entrega-3-catalogo` · Estrategia de entrega: ask-on-risk · Runner de tests: Vitest (pnpm).

## Specs

- S1 — Pendientes de la entrega 2, primero: "mete esos pendientes primero" (entrega 2, L24). (a) R4-001: en el ingreso correcto, si falla la base al limpiar los intentos o al crear la sesión, el error no cuenta como intento ni para el teléfono ni para la IP; (b) R2-004: si falta `Retry-After`, la web no inventa una espera (decía 15 minutos también en el registro, que bloquea 1 hora); (c) R3-001: entre 3541 y 3599 segundos la espera se muestra como "1 hora", no "60 minutos"; (d) R2-005: en `db:create-admin`, solo el cierre de la entrada (Ctrl+D) cancela; cualquier otro error se muestra como error, y no se acumulan listeners de `close`.
- S2 — Limpieza: "hagamso tambien limpieza para no arrastrar basura". (a) R2-001, R2-002: las duraciones de los límites se escriben una sola vez y la ventana más larga se deriva de los límites; (b) R2-003: `failed_count` ya no describe lo que guarda (decisión pendiente, ver L4); (c) R3-002: test del aviso de "Salir" (decisión pendiente, ver L4).
- S3 — RF03: "Ver el catálogo de servicios con precio y duración (público)." Detalle pendiente de aprobación (L4).
- S4 — RF04: "Elegir uno o varios servicios y ver el total de tiempo y precio." Detalle pendiente de aprobación (L4).
- S5 — RF16: "Crear, editar, activar y desactivar servicios." (Caro, admin). Detalle pendiente de aprobación (L4).

## Tasks

| ID  | Specs    | Ruta   | Estado    | Commit |
| --- | -------- | ------ | --------- | ------ |
| T1  | S1, S2a  | inline | hecho     | ver L3 |
| T2  | S2b, S2c | inline | pendiente |        |
| T3  | S3, S4   | inline | pendiente |        |
| T4  | S5 (API) | inline | pendiente |        |
| T5  | S5 (web) | inline | pendiente |        |

Ruta: todo inline; las unidades dependen entre sí (T3 → T4 → T5 comparten esquema y validación), así que no hay trigger de writer. Riesgo: ítem 2 (permisos de admin) en T4; ítem 1 (migración) en T2 si se renombra la columna.

## Log

- L1 (2026-11-20, usuario): "empecemos la entrega 3 ¿no queda nada pendiente de la entrega 1 o 2?" → "sí, el catálogo, y mete esos pendientes primero. hagamso tambien limpieza para no arrastrar basura"
- L2: Exploración. La tabla `services` ya existe (nombre único, `price_cop` ≥ 0, `duration_minutes` > 0, `active`, `sort_order`) y el seed trae los 10 servicios reales de Caro: el catálogo no necesita migración. `appointment_services` copia nombre, precio y duración al reservar, así que editar un servicio no cambia el historial. La web no tiene herramienta de tests de componentes (solo funciones de `lib/`).
- L3: T1. RED observado: ingreso correcto con falla al limpiar los intentos → "expected 1 to be +0" (intento contado); web sin `Retry-After` y con 3541 s → mensajes incorrectos (2 tests). GREEN: la limpieza del ingreso correcto y la creación de la sesión van dentro del mismo esquema de intentos pendientes; la web dice "más tarde" sin la cabecera y redondea a horas desde 60 minutos; `create-admin` usa un solo aviso de cierre y solo cancela si la entrada se cerró; los límites guardan `windowSeconds`/`lockSeconds` y la ventana más larga se deriva. Extra de limpieza: `FormEvent` (deprecado en @types/react 19.3) → `SubmitEvent`. Chequeos: `pnpm test:db` 54/54, `pnpm test` 39/39, typecheck sin errores ni warnings, lint y formato en verde. `create-admin` por terminal simulada: Ctrl+D en nombre y en contraseña → "Cancelado" (exit 1); contraseñas distintas → "no coinciden"; flujo completo → "Cuenta admin lista" (exit 0).
