Objetivo: entrega 4 de Caro Restrepo Nails: pendientes de pulido primero, luego horas disponibles (RF05, RF20, RF21) y reserva con aviso por WhatsApp (RF06).
Rama: `feat/entrega-4-reserva` · Estrategia de entrega: ask-on-risk (pronóstico ~2.000 líneas; se pregunta al publicar) · Runner de tests: Vitest (pnpm).

## Specs

- S1 — Pendientes de pulido, primero: "arranquemos la entrega 4, priorizando los pendientes" (L1; Engram `odd/pulido/pendientes`). (a) L2 #1: "El alta y la edición de servicios devuelven **400** si llegan campos desconocidos." (hoy `POST /api/admin/services` descarta `active` y `sortOrder` y responde 201). (b) L2 #2: "`create-admin` deja de cancelarse cuando recibe varias líneas por tubería." El pendiente 3 (dos altas simultáneas comparten `sort_order`) sigue aceptado.
- S2 — RF20: "Bloquear automáticamente domingos y festivos de Colombia." L2 #3: "Se **calculan en código**: fechas fijas, Ley Emiliani (se pasan al lunes) y los que dependen de la Pascua. Así no hay que cargarlos cada año. Además se borra la tabla `holidays`, que está vacía y quedaría sin uso, con una migración que no pierde datos."
- S3 — Ventana de reserva (reglas de negocio): "Entre 2 días y 1 mes calendario". "Ejemplo de la ventana de reserva: una cita del 18 de diciembre se puede reservar desde el 18 de noviembre hasta el 16 de diciembre." L2 #4: "Se cuenta por **fechas de Bogotá**, como en el ejemplo de los requisitos. Hoy, 20 nov, se puede reservar del 22 nov al 20 dic." Valores de `settings` (`booking_min_days`, `booking_max_months`).
- S4 — RF05: "Ver las horas disponibles según el motor de disponibilidad." Requisitos: "El sistema ofrece horas cada 30 minutos **más** la hora justo después de cada cita existente (fin + margen). Solo se muestran las horas en las que el bloque completo entra antes del cierre y sin chocar con bloqueos ni con otras citas." "Margen después de cada cita: 10 minutos (no se exige al cierre)". L2 #5: "El bloque completo tiene que terminar antes del cierre. El margen no se exige al cierre **ni antes de un bloqueo o descanso**." L2 #6: "El motor ya tiene en cuenta las filas de `schedule_exceptions`. Cargarlas desde el panel (RF13, RF14) queda para después." La duración del bloque es la suma de los servicios elegidos ("Uno o varios; se suman duración y precio"). Supuesto: una apertura extra (`extra_open`) suma horario también un domingo o festivo, porque Caro la pone a propósito.
- S5 — RF21: "Impedir que dos citas se superpongan, con una restricción en la base de datos." (ya existe, D14, migración 0001; esta entrega la usa al reservar).
- S6 — RF06: "Reservar con confirmación automática y botón para avisar a Caro por WhatsApp." "Confirmación: Automática si el horario está libre". L2 #9: "El servidor vuelve a calcular la disponibilidad. Si otra clienta ganó la hora, responde **409** con "Esa hora ya no está disponible. Elige otra." y recarga las horas." L2 #10: "Después de confirmar aparece "Avisar a Caro por WhatsApp", un link `wa.me` con este texto: "Hola Caro, soy {nombre}. Reservé {servicios} el {día} a las {hora}." Va al teléfono de la cuenta de Caro, así que no hay nada que configurar."
- S7 — Página `/reservar`. L2 #7: "Hay que ingresar. `/reservar` sin sesión lleva a `/ingreso?next=/reservar` y después vuelve. `next` solo acepta rutas internas, para que no sirva como redirección abierta." L2 #8: "Servicios (se reusa el picker) → días hábiles dentro de la ventana como botones → horas del día elegido → confirmar."
- S8 — Fuera de alcance (L2 #11): "Mis citas (RF07), cancelar, reprogramar, notas, push, editar `settings`."

## Tasks

| ID  | Specs      | Ruta   | Estado    | Commit |
| --- | ---------- | ------ | --------- | ------ |
| T1  | S1         | inline | hecho     | ver L4 |
| T2  | S2         | inline | pendiente |        |
| T3  | S3, S4     | inline | pendiente |        |
| T4  | S5, S6 API | inline | pendiente |        |
| T5  | S6, S7 web | inline | pendiente |        |

Ruta: todo inline; T3 → T4 → T5 dependen entre sí (motor, reserva, página), así que no hay trigger de writer. Riesgo previsto: ítem 1 (migración que borra `holidays`) en T2; ítems 2 y 4 (reserva con sesión, carrera entre dos reservas) en T4; ítem 2 (redirección `next`) en T5.

## Log

- L1 (2026-11-20, usuario): "sí, bórrala y arranquemos la entrega 4, priorizando los pendientes" → alcance elegido: "Disponibilidad y reserva (Recomendado)" (RF05, RF06, RF20, RF21; reglas con los valores por defecto; RF15 después).
- L2 (2026-11-20, usuario): "sí, me sirven todas, arranquemos" (aprueba la tabla de 11 decisiones, citadas en S1–S8).
- L3: Exploración. El esquema de citas ya existe (`appointments`, `appointment_services` con copia de precios, `business_hours`, `schedule_exceptions`, `settings` de fila única) y la restricción de exclusión sobre `tstzrange(start_at, occupied_until)` (0001). El seed carga horario base y `settings`. `holidays` está vacía y nada la usa. El ingreso y el registro redirigen siempre a `/`. Bogotá no tiene horario de verano (UTC−5 fijo).
- L4: T1. (S1a) `serviceInputSchema` y `serviceUpdateSchema` pasan a objetos estrictos: un campo desconocido → 400 con `fields.form` "No se aceptan estos campos: active, sortOrder.". RED: "expected 201 to be 400" (alta) y "expected 200 to be 400" (edición) → verdes. El test del verificador de la entrega 3 que fijaba "No hay cambios para guardar." para `{ sortOrder: 99 }` y `{ id }` se actualizó al mensaje nuevo; `{}` sigue diciendo "No hay cambios para guardar.". (S1b) Reproducido: con las cuatro respuestas por tubería, el script cancelaba en "Celular" (readline perdía las líneas que llegaban antes de preguntar y el cierre de la entrada ganaba). `createAsk` ahora lee de un iterador de líneas creado de entrada: las líneas que llegan antes quedan en espera, y solo cancela si la entrada termina sin respuesta; `terminal` sigue a `process.stdin.isTTY`. RED: test del script real por tubería → "Cancelado" en stderr → verde; tests de `createAsk` reescritos (5). Terminal simulada (pty): flujo completo → "Cuenta admin lista" con la contraseña oculta (exit 0); Ctrl+D en nombre y en contraseña → "Cancelado" (exit 1). Chequeos: test:db 129/129, test 99/99, typecheck, lint y formato en verde.
