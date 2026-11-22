Objetivo: entrega 9 de Caro Restrepo Nails: Caro crea, edita y reasigna citas a nombre de una clienta, sin las restricciones de las clientas (RF11).
Rama: `feat/entrega-9-citas-caro` · Estrategia de entrega: ask-on-risk (un PR) · Runner de tests: Vitest (pnpm). Verificación y revisión: OpenCode, por Engram.

## Specs

- S1 — RF11: "Crear, editar y reasignar citas a nombre de una clienta, sin las restricciones de las clientas." Para quién (L2 #1): "Solo clientas que ya tienen cuenta, buscadas por nombre o celular. Una clienta nueva se registra ella misma (así acepta el tratamiento de datos). Crear cuentas desde el panel queda para cuando hagamos clientas (RF17)."
- S2 — Crear (L2 #2): "En la vista de día, un botón "Nueva cita": clienta, uno o varios servicios, día (por defecto el que se está viendo) y hora. Se guarda como creada por Caro."
- S3 — Sin las restricciones de las clientas (L2 #3): "Cualquier día desde hoy, sin la ventana de 2 días a 1 mes, también domingos, festivos o días bloqueados. Cualquier hora en pasos de 15 minutos, aunque esté fuera del horario. Lo único que no se puede es pisar otra cita agendada: "Esa hora choca con otra cita.""
- S4 — Editar (L2 #4): "Cada cita agendada tiene "Editar" con el mismo formulario: cambia día, hora y servicios. Si cambian los servicios, se vuelven a copiar con sus precios de hoy."
- S5 — Reasignar (L2 #5): "En "Editar", Caro puede cambiar la clienta por otra."
- S6 — Precios (L2 #6): "Los del catálogo, sumados como al reservar. Precios especiales o descuentos quedan fuera."
- S7 — Sin carreras (L2 #7): "Guardar toma el turno del día (o de los dos días, si la cita se mueve), igual que las reservas."
- S8 — Avisar a la clienta (L2 #8): "Después de guardar aparece "Avisar a {nombre} por WhatsApp" con el mensaje según el caso. Al crear o reasignar: "Hola {nombre}, soy Caro. Te agendé {servicios} el {día} a las {hora}. ¡Te espero!" Al mover: "Hola {nombre}, soy Caro. Moví tu cita de {servicios} al {día} a las {hora}. ¡Te espero!""
- S9 — Verificación y revisión (L2 #9): "En OpenCode, por Engram, como en la entrega 8."
- S10 — Fuera de alcance (L2 #10): "Crear cuentas de clientas, precios especiales, notas internas, citas en el pasado y el resto de RF15, RF17 y RF18."

## Tasks

| ID  | Specs                | Ruta   | Estado | Commit  |
| --- | -------------------- | ------ | ------ | ------- |
| T1  | S1–S7 (API)          | inline | hecha  | 6344a22 |
| T2  | S2, S4, S5, S8 (web) | inline | hecha  | ver log |

Ruta: todo inline; T2 depende de T1. Riesgo previsto: ítems 1 (cambiar citas guardadas), 2 (solo admin; datos de clientas) y 4 (turnos de uno o dos días) en T1.

## Log

- L1 (2026-11-21, usuario): "dale, arranquemos la entrega 9" (RF11, según la partición de la entrega 7).
- L2 (2026-11-21, usuario): "sí, me sirven todas, arranquemos." (aprueba la tabla de 10 decisiones, citadas en S1–S10).
- L3: T1. `GET /api/admin/clients?q=` solo admin: clientas activas (sin admins ni cuentas borradas) por nombre (sin distinguir mayúsculas) o por celular (los dígitos de la búsqueda, desde 3), por nombre, hasta 10; menos de 2 caracteres → `[]`; `no-store`. `POST /api/admin/appointments` `{ clientId, serviceIds, date, time }` (estricto, hora en múltiplos de 15 minutos): cualquier día y hora desde ahora, también domingos, festivos, días bloqueados y fuera de horario; clienta inexistente, admin o borrada → 409 `client_unavailable` "Esa clienta ya no está disponible."; servicio inactivo → 409 `service_unavailable`; hora pasada → 409 `past_time` "Esa hora ya pasó."; pisa otra cita agendada (con su margen) → 409 `slot_taken` "Esa hora choca con otra cita.". Guarda con el turno del día, `created_by` admin, precios del catálogo y la copia de servicios; responde 201 con la cita de la agenda. `PATCH /api/admin/appointments/:id` con los mismos campos: mueve, cambia servicios (si son los mismos conserva copias y precios; si cambian, los vuelve a copiar con los de hoy) y reasigna; solo agendadas (409 `not_editable` "Solo se puede editar una cita agendada."); toma los turnos del día viejo y del nuevo en orden y relee la cita `FOR UPDATE`. `writeConflict` en `db/errors.ts` clasifica los errores al guardar (lo usan reservar y este módulo). RED 14 de 15 → verdes. Mutaciones: sin el turno → falla "guarda con el turno del día"; sin el filtro de clientas → falla "solo para clientas con cuenta activa"; sin `requireAdmin` → falla la búsqueda (crear y editar siguen protegidos por el router de estados del mismo prefijo); restaurado. Chequeos: test:db 229/229, test 185/185, typecheck, lint y formato en verde.
- L4: T2. La agenda devuelve `client.id` y `serviceIds` de cada cita (`serviceCopiesByAppointment` en `service-copies.ts`) para precargar "Editar". shared: `adminBookedMessage` y `adminMovedMessage` con sus tests. web: `api.searchClients`, `createAppointment`, `updateAppointment`; nuevo `AppointmentForm.tsx` (búsqueda de clienta, servicios, día y hora en pasos de 15 minutos, Guardar / Cancelar); "Editar" en `AgendaCard` solo para citas agendadas; "Nueva cita" en `AdminAgenda` (hoy o después) y, al guardar, "Cita guardada." con "Avisar a {nombre} por WhatsApp": mensaje de mover si es la misma clienta con otro día u hora, de agendar en otro caso. Excepción test-first: los tests de los mensajes de shared se escribieron junto con el código, sin observar RED antes.
- L5 (2026-11-21): sesión pausada por tokens y retomada. Chequeos al retomar: formato, lint, typecheck, test 193/193 (shared 58, api 33, web 102), test:db 229/229 (14 archivos) y build web en verde.
