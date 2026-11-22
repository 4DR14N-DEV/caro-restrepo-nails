Objetivo: entrega 11 de Caro Restrepo Nails: Caro ve las clientas y les genera una contraseña nueva (RF17); la clienta cambia su contraseña y puede borrar su cuenta (RF22).
Rama: `feat/entrega-11-clientas-cuenta` · Estrategia de entrega: ask-on-risk (un PR) · Runner de tests: Vitest (pnpm). Verificación y revisión: OpenCode, por Engram.

## Specs

- S1 — RF17: "Ver las clientas y restablecerles la contraseña." Página (tabla #1): "`/admin/clientas`, solo Caro, con un enlace "Clientas" desde el inicio."
- S2 — Qué muestra (tabla #2): "Todas las clientas con cuenta, ordenadas por nombre: nombre, celular, fecha de registro y cuántas citas próximas tiene. Arriba, un filtro por nombre o celular. Las cuentas borradas no aparecen."
- S3 — Restablecer contraseña (tabla #3): "Botón "Restablecer contraseña". El sistema genera una clave nueva de 10 caracteres, sin letras que se confundan, y se la muestra a Caro una sola vez. Al mismo tiempo cierra las sesiones abiertas de la clienta y le quita el bloqueo por intentos fallidos."
- S4 — Avisarle la clave (tabla #4): "Mensaje: "Hola {nombre}, soy Caro. Tu nueva contraseña es {clave}. Ingresa con tu celular y esta contraseña; puedes cambiarla en "Mis citas".""
- S5 — Borrar mi cuenta, RF22: "Permitir que una clienta borre su cuenta: se anonimizan sus datos y se conservan las citas pasadas." Dónde (tabla #5): "Al final de "Mis citas", un botón "Borrar mi cuenta". Para confirmar, la clienta escribe su contraseña en la misma página, porque es algo que no se puede deshacer."
- S6 — Qué se borra (tabla #6): "El nombre pasa a "Clienta eliminada". Se borran el celular y la contraseña, se cierran sus sesiones y se borran los registros de intentos de ingreso que tenían su celular."
- S7 — Sus citas (tabla #7): "Las citas pasadas se conservan, sin sus datos. Las próximas se cancelan y liberan la hora, sin el límite de 2 horas antes, porque si no quedarían a nombre de nadie."
- S8 — Después de borrar (tabla #8): "La clienta vuelve al inicio con el mensaje "Tu cuenta fue borrada.". Ese celular puede volver a registrarse como una cuenta nueva."
- S9 — Caro (tabla #9): "No puede borrar cuentas desde el panel: así lo dice la tabla de roles. Tampoco puede restablecer la contraseña de otra cuenta admin; la suya sigue con el comando de siempre."
- S10 — Cambiar contraseña (tabla #11): "Al final de "Mis citas", una sección "Mi cuenta" con "Cambiar contraseña". Pide la contraseña actual y la nueva dos veces, con las mismas reglas del registro (al menos 8 caracteres). Al guardar, se cierran sus otras sesiones abiertas y la sesión actual sigue."
- S11 — Contraseña actual incorrecta (tabla #12): "Responde "La contraseña actual no es correcta." y cuenta como un intento fallido de ingreso, con el mismo límite. Así nadie la puede adivinar desde una sesión abierta. Lo mismo vale para la contraseña que pide "Borrar mi cuenta"."
- S12 — Fuera de alcance (tabla #10, ajustada en L2): "Crear cuentas desde el panel, exportar los datos y los avisos push (RF18, entrega 12)." Verificación y revisión: en OpenCode, por Engram, como en la entrega 10.

## Tasks

| ID  | Specs      | Ruta   | Estado    | Commit |
| --- | ---------- | ------ | --------- | ------ |
| T1  | S1–S4, S9  | inline | pendiente |        |
| T2  | S10, S11   | inline | pendiente |        |
| T3  | S5–S8, S11 | inline | pendiente |        |

Ruta: todo inline (sin motivo de escritor delegado; T2 y T3 comparten la revisión de la contraseña actual). Riesgo previsto: ítem 2 (contraseñas, sesiones, solo admin) en las tres; ítem 1 (anonimizar datos guardados, irreversible) en T3. Cada tarea va en su commit. Previsión: ~1.200 líneas propias.

## Log

- L1 (2026-11-22, usuario): "dale, arranquemos la entrega 11" → propuesta: tabla de 10 decisiones para RF17 y RF22.
- L2 (2026-11-22, usuario): "Esta bien que las clientas puedan cambiar su contraseña, pero tambien conservemos que Caro pueda generar una nueva contraseña para una clienta por si olvidó la contraseña. ¿te parece?" → se ajusta la decisión 4, se agregan la 11 y la 12, y sale de la 10 "que la clienta cambie su propia contraseña".
- L3 (2026-11-22, usuario): "sí, arranquemos así" (aprueba las decisiones 1–12 y las tres tareas, citadas en S1–S12).
- L4: T1. La búsqueda de clientas (`GET /api/admin/clients?q=`) pasa sin cambios de `booking/admin-booking-routes.ts` a `clients/admin-routes.ts`, que suma `GET /api/admin/clients/list` (clientas activas por nombre, sin admins ni borradas, con `registeredOn` en fecha de Bogotá y `upcoming` = agendadas desde ahora; `no-store`) y `POST /api/admin/clients/:id/password` (clave de 10 caracteres de `abcdefghjkmnpqrstuvwxyz23456789` con `randomInt`; guarda su hash Argon2id, cierra las sesiones de la clienta y borra su fila `login-phone`, en una transacción; responde `{ client, password }` con `no-store`; admin, borrada, inexistente o id inválido → 404 `not_found` sin cambios). shared `clients.ts`: `ClientRow`, `PasswordReset`, `newPasswordMessage`. Web: `/admin/clientas` con `AdminClients` (401 → "Ingresa con la cuenta de Caro para ver las clientas." con `next`; 403; Reintentar; filtro sin mayúsculas ni tildes o por dígitos desde 3; "Registrada el …", "N citas próximas"), enlace "Clientas" en el inicio y fila en el README. Supuesto (no lo pidió el usuario): "Restablecer contraseña" pide confirmar en la misma fila ("¿Generar una contraseña nueva para {nombre}? La actual deja de servir.") porque un toque accidental deja a la clienta sin entrar. RED: API 3 de 6 (los de acceso y 404 ya pasaban por el guard del prefijo y la ruta comodín), shared 1, AdminClients (inexistente), AuthStatus 1 de 6 → verdes. Mutaciones: sin el filtro de rol falla "solo clientas con cuenta"; sin cerrar sesiones falla "cierra las sesiones"; restaurado. Chequeos: test 221/221, test:db 244/244, typecheck, lint, formato y build web en verde.
