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

| ID  | Specs          | Ruta   | Estado | Commit           |
| --- | -------------- | ------ | ------ | ---------------- |
| T1  | S1, S2, S3, S7 | inline | hecho  | d536874          |
| T2  | S5             | inline | hecho  | 054f848          |
| T3  | S3, S4, S5, S8 | inline | hecho  | 5cdf57b, 8060d4e |
| T4  | S6             | inline | hecho  | 32da171          |
| T5  | S7, S9         | inline | hecho  | 1d2638c, c20d4f7 |

Ruta: todo inline; las unidades dependen entre sí (T1 → T2/T3 → T4/T5), así que no hay trigger de writer. Riesgo: ítem 2 (autenticación) en T3/T4 e ítem 5 (dependencia nativa y deploy) en T3: verificador independiente al final de la entrega.

## Log

- L1 (2026-11-18, usuario): "listo, ya mergeé el PR, arranquemos la entrega 2"
- L2 (2026-11-18, usuario): "sí, me sirven todos, arranquemos" (aprueba la tabla de valores de S1–S7).
- L3: Diseño. Límite de intentos con una fila por teléfono (`login_throttles`: fallos, inicio de ventana, bloqueado hasta), también para teléfonos inexistentes, para no revelar qué cuentas existen. Ingreso con teléfono inexistente verifica contra un hash ficticio para igualar tiempos. Token de sesión de 32 bytes aleatorios; en la base solo su SHA-256 (columna existente `sessions.id`). Renovación: si quedan menos de 15 días, se extiende a 30. `@node-rs/argon2` es binario nativo: va como `external_node_modules` en Netlify. En producción, `DATABASE_URL` debe usar el pooler en modo transacción (6543).
- L4: RED/GREEN observado: shared (módulo inexistente → 17 verdes); auth (21 rojos con 404 → 21 verdes); create-admin (módulo inexistente → 3 verdes). `pnpm test:db` completo: 34 verdes. El comando `db:create-admin` se probó con una terminal simulada: no muestra la contraseña y guarda la cuenta admin con hash Argon2id.
- L5: Corrección: lint falló en 5cdf57b por el parámetro `_next` del manejador de errores (Express lo necesita); excepción explícita en 8060d4e.
- L6: T5 sin test automático en la web (no hay runner en `apps/web`; la validación está cubierta por los tests de `@caro/shared`). Chequeo funcional: `astro check` y build en verde; con la API y Astro en local, las 4 páginas responden 200 y por el proxy `/api` funcionan registro (201 + cookie `HttpOnly; Secure; SameSite=Lax`, 30 días), quién soy, salida (204) e ingreso fallido (401). Falta probarlo en un navegador real. La política de datos es un borrador: falta el canal de contacto (`[pendiente: celular o correo de contacto]`) y la revisión de Caro.
- L7: Verificador independiente lanzado sobre 9c707bf..c20d4f7 (ítems 2 y 5).
- L8: Contacto de la política (usuario): "el WhatsApp de Caro, te paso el número: +57 3007445676" → 04d88ff.
- L9: Verificador independiente: S1–S4, S7–S9 pasan; dos bloqueos. (1) S5: con intentos simultáneos se evaluaban 20 contraseñas en vez de 5 (se chequeaba el bloqueo antes de verificar y se registraba el fallo después). (2) S6: promover a admin un teléfono ya registrado dejaba vivas las sesiones de quien lo registró, ahora con rol admin. Argon2 en Netlify: `external_node_modules` es necesario (sin él esbuild falla con el `.node`) y el bundle funciona con el módulo externo; confirmar en el deploy preview que el zip incluye el binario.
- L10: Corrección única (103bf7e): el intento se reserva de forma atómica antes de verificar (`claimAttempt`, un solo INSERT … ON CONFLICT … RETURNING) y se bloquea tras el 5.º fallo o ante una ráfaga; `createAdmin` corre en una transacción que borra las sesiones del usuario y su bloqueo; cuerpo demasiado grande → 413. Tests de regresión agregados (RED: 3 fallaban; GREEN: 38/38 en tres corridas).
- L11: Sugerencias no bloqueantes pendientes: limpiar filas viejas de `login_throttles`; calcular el hash ficticio al cargar el módulo; borrar la sesión anterior al ingresar; manejar Ctrl+D en `db:create-admin`; cualquiera puede bloquear un celular 15 min con 5 intentos (es lo que pide S5); límite de registros por teléfono/IP.
- L12: Revisión nativa: assess high (autenticación), lentes risk y reliability sobre 9c707bf..b7dab1a. Consentimiento otorgado por el usuario; resultado: aprobado sin bloqueos y acuse hecho (`authority: burned`, lineage review-0cc40da36b28850a). Hallazgos no bloqueantes: (a) el registro no tiene límite y su 409 permite averiguar qué celulares tienen cuenta (además, cada intento calcula un Argon2); (b) el límite es solo por teléfono: probar una contraseña común contra muchos celulares no bloquea nada; (c) si algo falla entre reservar el intento y responder, el intento queda contado (500 que suma al bloqueo); (d) `login_throttles` crece sin límite; (e) "Salir" ignora si la API falló; (f) Ctrl+D en `db:create-admin`; (g) hash ficticio perezoso; (h) islas de la web sin tests.
