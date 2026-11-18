Objetivo: entrega 2 de Caro Restrepo Nails: registro, ingreso y salida con teléfono y contraseña (RF01, RF02, RNF02, RNF03).
Rama: `feat/entrega-2-auth` · Estrategia de entrega: ask-on-risk · Runner de tests: Vitest (pnpm).

## Specs

- S1 — Paquete compartido `@caro/shared` con los esquemas de Zod que usan la API y la web. Alcance aprobado: "API (registro, ingreso, salida, "quién soy") + páginas de registro e ingreso en la web + un paquete compartido con los esquemas de Zod".
- S2 — Teléfono: "Celular colombiano: la clienta escribe 10 dígitos (`3xx…`) y se guarda como `+57…`".
- S3 — Contraseña: "Mínimo 8 caracteres, sin reglas de "una mayúscula y un símbolo" (es lo que recomienda OWASP hoy)". Hash con Argon2id (D09).
- S4 — Sesión: "30 días, y se renueva sola con el uso". Sesiones en Postgres con cookie httpOnly, Secure, SameSite (D08).
- S5 — Límite de intentos: "5 fallidos por teléfono en 15 min bloquean ese teléfono por 15 min. Se guarda en Postgres, porque en Netlify Functions no hay memoria compartida entre ejecuciones (requiere una tabla nueva)".
- S6 — Cuenta de Caro: "No se registra desde la web: se crea con un comando (`pnpm db:create-admin`) que pide la contraseña sin mostrarla".
- S7 — Consentimiento: "Casilla obligatoria con un enlace a una página de política de datos. Te dejo un borrador que después revisa Caro". Se guarda la fecha de aceptación (RNF03).
- S8 — Endpoints: registro, ingreso, salida y "quién soy" bajo `/api/auth/*`, con validación Zod (RNF02).
- S9 — Web: páginas de registro e ingreso como islas de React, validación con los esquemas compartidos, textos en español, mobile first (RNF01, RNF08).

## Tasks

| ID  | Specs          | Ruta   | Estado    | Commit |
| --- | -------------- | ------ | --------- | ------ |
| T1  | S1, S2, S3, S7 | inline | pendiente |        |
| T2  | S5             | inline | pendiente |        |
| T3  | S3, S4, S5, S8 | inline | pendiente |        |
| T4  | S6             | inline | pendiente |        |
| T5  | S7, S9         | inline | pendiente |        |

Ruta: todo inline; las unidades dependen entre sí (T1 → T2/T3 → T4/T5), así que no hay trigger de writer. Riesgo: ítem 2 (autenticación) en T3/T4 e ítem 5 (dependencia nativa y deploy) en T3: verificador independiente al final de la entrega.

## Log

- L1 (2026-11-18, usuario): "listo, ya mergeé el PR, arranquemos la entrega 2"
- L2 (2026-11-18, usuario): "sí, me sirven todos, arranquemos" (aprueba la tabla de valores de S1–S7).
- L3: Diseño. Límite de intentos con una fila por teléfono (`login_throttles`: fallos, inicio de ventana, bloqueado hasta), también para teléfonos inexistentes, para no revelar qué cuentas existen. Ingreso con teléfono inexistente verifica contra un hash ficticio para igualar tiempos. Token de sesión de 32 bytes aleatorios; en la base solo su SHA-256 (columna existente `sessions.id`). Renovación: si quedan menos de 15 días, se extiende a 30. `@node-rs/argon2` es binario nativo: va como `external_node_modules` en Netlify. En producción, `DATABASE_URL` debe usar el pooler en modo transacción (6543).
