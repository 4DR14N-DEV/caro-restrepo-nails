Objetivo: entrega 10 de Caro Restrepo Nails: Caro configura el horario base, el margen entre citas y las reglas de reserva (RF15).
Rama: `feat/entrega-10-horario-base` · Estrategia de entrega: ask-on-risk (un PR) · Runner de tests: Vitest (pnpm). Verificación y revisión: OpenCode, por Engram.

## Specs

- S1 — RF15: "Configurar el horario base y el margen entre citas." Página (L2 #1): "`/admin/horario`, solo Caro, con un enlace "Horario y reglas" desde el inicio."
- S2 — Horario base (L2 #2): "De lunes a sábado: abre, cierra o "cerrado". Domingos y festivos siguen cerrados siempre."
- S3 — Límites de horas (L2 #3): "Abre desde las 8:00, cierra hasta las 21:00, en pasos de 15 minutos, y la apertura tiene que ser antes del cierre."
- S4 — Margen entre citas (L2 #4): "De 0 a 60 minutos, en pasos de 5. Solo vale para las citas nuevas: las ya agendadas conservan su margen y la base no se toca."
- S5 — Otras reglas (L2 #5): "Se agregan también la anticipación para reservar (días mínimos y meses máximos), las horas antes para cancelar y los días antes para reprogramar." Supuesto (no lo pidió el usuario; límites para que la ventana nunca quede vacía): días mínimos 0–14, meses máximos 1–6, horas para cancelar 0–48, días para reprogramar 0–14, todos enteros.
- S6 — Citas fuera del nuevo horario (L2 #6): "Se guarda igual y las citas no se tocan. Aparece el aviso "Hay N citas agendadas fuera del nuevo horario", con la lista, para que Caro decida qué hacer con cada una." Supuesto: cuentan las citas agendadas desde ahora que entraban en el horario base anterior y no entran en el nuevo (las que Caro agendó fuera de horario a propósito, RF11, no se repiten en cada guardado).
- S7 — Excepciones del día (L2 #7): "Los bloqueos, descansos y aperturas tempranas ya cargados se mantienen tal cual."
- S8 — Carreras (L2 #8): "Guardar no toma el turno de los días. Si justo se confirma una reserva con el horario viejo, queda como cualquier otra cita existente (y la ve el aviso del punto 6)."
- S9 — Verificación y revisión (L2 #9): "En OpenCode, por Engram, como en la entrega 9."
- S10 — Fuera de alcance (L2 #10): "Horarios por temporada, descansos que se repiten, y RF17, RF18 y RF22."

## Tasks

| ID  | Specs                | Ruta   | Estado | Commit  |
| --- | -------------------- | ------ | ------ | ------- |
| T1  | S1–S8 (shared + API) | inline | hecha  | 8cd9690 |
| T2  | S1–S6 (web)          | inline | hecha  | ver log |

Ruta: todo inline (sin motivo de escritor delegado); T2 depende de T1. Riesgo previsto: ítem 2 (solo admin) en T1. Previsión: ~700 líneas propias.

## Log

- L1 (2026-11-22, usuario): "dale, arranquemos la entrega 10" → propuesta: reparto 10: RF15; 11: RF17 + RF22; 12: RF18, y una tabla de 10 decisiones.
- L2 (2026-11-22, usuario): "sí, me sirven todas, arranquemos." (aprueba el reparto y la tabla de 10 decisiones, citadas en S1–S10).
- L3: T1. shared `schedule.ts`: `scheduleSettingsRequestSchema` estricto (`hours`: los seis días de lunes a sábado, cada uno con `opensAt`/`closesAt` en múltiplos de 15 o los dos `null` = cerrado; abre desde 8:00, cierra hasta 21:00, apertura antes del cierre; `rules`: margen 0–60 de a 5, días mínimos 0–14, meses máximos 1–6, cancelar 0–48 horas, reprogramar 0–14 días, enteros), `fitsHours` (el margen no se exige al cierre) y `outsideHoursMessage`. `quarterTime` de `agenda.ts` pasa a exportarse. API: `GET /api/admin/schedule` y `PUT /api/admin/schedule` solo admin, `no-store`. Guardar reemplaza las filas de `business_hours` (un día cerrado no tiene fila) y actualiza `settings` en una transacción, sin turno de días (S8); responde `{ hours, rules, outside }`: las citas agendadas desde ahora que entraban en el horario anterior y no en el nuevo, sin festivos. Las citas y las excepciones no se tocan. RED: shared (módulo inexistente) y API 7 de 7 → verdes. Mutaciones: sin `requireAdmin` falla "sin sesión 401; una clienta 403"; sin el filtro del horario anterior falla el aviso; restaurado. Chequeos: test 201/201 (shared 66), test:db 237/237, typecheck, lint y formato en verde.
- L4: T2. Página `/admin/horario` con `AdminSchedule` (contenedor; 401 → "Ingresa con la cuenta de Caro para cambiar el horario." con "Ingresar" a `/ingreso?next=%2Fadmin%2Fhorario`; 403 → "Esta página es solo para Caro."; falla al cargar → "Reintentar"). Un grupo por día de lunes a sábado con "Abre" y "Desde"/"Hasta" (8:00 a. m. a 9:00 p. m. de a 15 minutos); abrir un día cerrado propone 9:00 a. m.–7:00 p. m.; "Domingos y festivos no se atiende.". Cinco reglas numéricas. Antes de enviar valida con el esquema compartido y muestra el mensaje junto al campo (la API colapsa el 400 en `hours`/`rules`). Al guardar: "Horario guardado." y, si hay, el aviso con la lista (día y hora, clienta, servicios) y "Ver agenda". Enlace "Horario y reglas" en el inicio para Caro; fila nueva en el README. RED: AdminSchedule (componente inexistente) y AuthStatus (1 de 6) → verdes. Chequeos: test 211/211 (web 112), test:db 237/237, typecheck, lint, formato y build web en verde.
- L5 (2026-11-22): OpenCode, sobre `bd80fb7..2c3f5c0`. Verificador: S1–S10 cumplen, sin bloqueantes ni avisos (ítem 2 probado: 401/403, sesión vencida, admin anonimizada, un PUT fallido no cambia nada; carrera reserva vs. guardar sin 500). Observación: si la apertura base pasa a ser más tarde que el fin de una apertura más temprano ya cargada, esa franja queda abierta con un hueco hasta la nueva apertura; es lo que pide S7, así que se agregó en la página: "Las aperturas más temprano ya cargadas tampoco cambian: si mueves la apertura de un día, revísalas en la agenda.". Revisión nativa APROBADA, lineage `review-dc767be4bea12669`, autoridad quemada; un hallazgo (R3-all-closed-untested, SUGGESTION): aplicado, test de guardar con todos los días cerrados (sin días ofrecidos y con el aviso); el comportamiento ya existía: mutación sin la guarda de lista vacía → falla; restaurado. Scratch del verificador borrado. Chequeos: test 211/211, test:db 238/238, typecheck, lint, formato y build web en verde.
