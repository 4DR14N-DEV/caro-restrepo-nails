Objetivo: entrega 7 de Caro Restrepo Nails: agenda de Caro por día, semana y mes (RF10), marcar estado de cada cita (RF12) y recordatorio por WhatsApp (RF19).
Rama: `feat/entrega-7-agenda` · Estrategia de entrega: ask-on-risk (un PR) · Runner de tests: Vitest (pnpm).

## Specs

- S1 — Página (L2 #1): "`/admin/agenda`, solo Caro (401/403 como el panel de servicios). Se enlaza desde el inicio con "Ver agenda"."
- S2 — RF10: "Ver la agenda por día, semana y mes." Día (L2 #2): "Las citas del día por hora: hora, clienta (nombre y celular), servicios, duración, total y estado. Botones para pasar al día anterior y al siguiente." Vista por defecto: hoy.
- S3 — Semana (L2 #3): "De lunes a sábado, cada día con sus citas en una lista (en el celular, columnas no entran). Tocar un día abre su vista de día."
- S4 — Mes (L2 #4): "Calendario con la cantidad de citas agendadas de cada día; tocar un día lo abre."
- S5 — Qué citas muestra (L2 #5): "Agendadas, completadas y "no asistió". Las canceladas no aparecen por defecto; hay un interruptor "Mostrar canceladas"."
- S6 — RF12: "Marcar cada cita como completada, no asistió o cancelada." (L2 #6) ""Completada" y "No asistió" solo cuando la cita ya empezó. "Cancelar" en cualquier momento, sin el plazo de las clientas: queda cancelada por admin y libera la hora. Completada y "No asistió" se pueden corregir entre sí; una cancelada no vuelve atrás."
- S7 — Confirmación (L2 #7): "Cancelar pide el mismo paso dentro de la página que usa la clienta."
- S8 — Avisar a la clienta (L2 #8): "Después de que Caro cancela aparece "Avisar a {nombre} por WhatsApp" con el mensaje: "Hola {nombre}, soy Caro. Tuve que cancelar tu cita de {servicios} del {día} a las {hora}. Escríbeme para buscar otro horario.""
- S9 — RF19: "Abrir WhatsApp con el recordatorio de cada cita ya escrito." (L2 #9) "Cada cita agendada del día tiene "Recordar por WhatsApp" con: "Hola {nombre}, te recuerdo tu cita de {servicios} el {día} a las {hora}. ¡Te espero!""
- S10 — Fuera de alcance (L2 #10): "RF11, RF13 y RF14 (entregas 8 y 9), editar reglas (RF15), clientas (RF17) y push (RF18)."

## Tasks

| ID  | Specs       | Ruta   | Estado    | Commit |
| --- | ----------- | ------ | --------- | ------ |
| T1  | S2–S5 (API) | inline | pendiente |        |
| T2  | S6 (API)    | inline | pendiente |        |
| T3  | S1–S9 (web) | inline | pendiente |        |

Ruta: todo inline; T1 → T2 → T3 dependen entre sí. Riesgo previsto: ítem 2 (solo admin; datos de clientas) en T1; ítems 1 y 2 (cambiar estados guardados) en T2.

## Log

- L1 (2026-11-21, usuario): "dale, arranquemos la entrega 7" → propuesta: panel de Caro en tres entregas (7: RF10 + RF12; 8: RF13 + RF14; 9: RF11).
- L2 (2026-11-21, usuario): "sí, me sirven todas, arranquemos" (aprueba la partición y la tabla de 10 decisiones, citadas en S1–S10).
- L3: T1. `GET /api/admin/agenda?from=&to=&cancelled=1` solo admin (401/403): citas cuyo inicio cae en el rango (fechas de Bogotá), en orden de hora, con clienta (nombre y celular; sin celular si está anonimizada), servicios (copia), duración, total, estado y qué se puede hacer (`canMark`: empezó y no está cancelada; `canCancel`: agendada). Canceladas solo con `cancelled=1`. Rango de hasta 42 días (`AGENDA_MAX_DAYS`, un mes en 6 semanas); si no, 400 "Elige un rango de hasta 42 días.". `Cache-Control: no-store`. Tipos y validación en `packages/shared/src/agenda.ts`. Los servicios por cita salen de `serviceNamesByAppointment` (`booking/service-copies.ts`), que ahora usa también "Mis citas". El ayudante de tests `signedIn` acepta el rol. RED 7 × 404 → 7 verdes. Mutación sin `requireAdmin` → falla "sin sesión 401; una clienta 403"; restaurado. Chequeos: test:db 192/192, test 155/155, typecheck, lint y formato en verde.
