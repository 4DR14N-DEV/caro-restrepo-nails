Objetivo: entrega 5 de Caro Restrepo Nails: "Mis citas" para la clienta (RF07) y dos pendientes chicos de pulido.
Rama: `feat/entrega-5-mis-citas` · Estrategia de entrega: ask-on-risk (un PR, como las anteriores) · Runner de tests: Vitest (pnpm).

## Specs

- S1 — Página (L2 #1): "`/mis-citas`, solo con sesión. Sin sesión lleva a `/ingreso?next=/mis-citas`, igual que `/reservar`."
- S2 — RF07: "Ver sus citas próximas y su historial." Próximas (L2 #2): "Las citas agendadas que todavía no empezaron, de la más cercana a la más lejana."
- S3 — Historial (L2 #3): "El resto, de la más reciente a la más vieja, con su estado: "Completada", "No asistió", "Cancelada" o "Pasada" (agendada pero Caro todavía no la marcó). Se muestran las últimas 20, sin paginación por ahora."
- S4 — Qué muestra cada cita (L2 #4): "Día y hora, servicios, duración y total, con los precios del momento en que se reservó."
- S5 — API (L2 #5): "`GET /api/appointments` devuelve solo las citas de quien tiene la sesión; sin sesión, 401."
- S6 — Enlaces (L2 #6): ""Mis citas" en el inicio cuando hay sesión, y "Ver mis citas" en la confirmación de la reserva."
- S7 — Pendiente de pulido 3 (L2 #7): "Si se corta internet al confirmar, el aviso dice: "No pudimos confirmar si tu cita quedó guardada. Revisa Mis citas antes de volver a intentarlo." y enlaza a `/mis-citas`."
- S8 — Pendientes chicos (L2 #8): "Si el cuerpo de una petición no es un objeto, el error pasa a estar en español (A2). El motor deja de ofrecer horas que ya pasaron, para cuando la anticipación mínima sea 0 (R3-002)."
- S9 — Fuera de alcance (L2 #9): "Cancelar (RF08) y reprogramar (RF09) quedan para la entrega 6."

## Tasks

| ID  | Specs             | Ruta   | Estado    | Commit |
| --- | ----------------- | ------ | --------- | ------ |
| T1  | S8                | inline | pendiente |        |
| T2  | S2–S5 API         | inline | pendiente |        |
| T3  | S1–S4, S6, S7 web | inline | pendiente |        |

Ruta: todo inline; T2 → T3 dependen entre sí. Riesgo previsto: ítem 2 (la API tiene que devolver solo las citas propias) en T2.

## Log

- L1 (2026-11-21, usuario): "dale, continuemos con la entrega 5" (propuesta: "Mis citas", RF07).
- L2 (2026-11-21, usuario): "sí, me sirven todas, arranquemos" (aprueba la tabla de 9 decisiones, citadas en S1–S9).
- L3: T1. (A2) `invalidInput` reemplaza el mensaje de zod cuando lo que llegó no es un objeto (sin cuerpo, un arreglo) por "Los datos enviados no son válidos." (en `fields.form`); vale para todas las rutas que lo usan. (R3-002) `offeredTimes` filtra las horas que ya pasaron. RED: "expected { … } to deeply equal" (mensaje en inglés) y "expected '09:00' to be '10:30'" (anticipación 0 a las 10:10) → verdes. También L19 en `odd/tasks/entrega-4-reserva.md` (cierre de la entrega 4). Chequeos: test:db 153/153, test 141/141, typecheck, lint y formato en verde.
- L4: T1 (f347bf1): assess medium, `under_budget`. T2. `GET /api/appointments` con sesión (401 sin ella): `{ upcoming, history }`. Próximas = `scheduled` con inicio después de ahora, ascendente; historial = el resto (canceladas aunque sean futuras, y agendadas que ya empezaron como `past`), descendente, últimas 20 (`HISTORY_LIMIT`). Cada cita: día y hora de Bogotá, servicios (copia de `appointment_services`, por nombre), duración (fin − inicio), total guardado y estado (`upcoming`, `past`, `completed`, `no_show`, `cancelled`). Tipos compartidos `MyAppointment`, `MyAppointments`, `AppointmentState`. RED 7 × 404 → 7 verdes. Mutación sin el filtro por clienta → falla "muestra solo las citas propias"; restaurado. Chequeos: test:db 160/160, test 141/141, typecheck, lint y formato en verde.
