# Requisitos — Caro Restrepo Nails

Aplicación web para gestionar las citas del spa de uñas de Caro Restrepo. Reemplaza la agenda en papel: las clientas consultan disponibilidad, reservan, cancelan y reprograman; Caro administra su agenda.

## Roles

| Rol       | Quién es                                              |
| --------- | ----------------------------------------------------- |
| Visitante | Cualquier persona sin sesión iniciada.                |
| Clienta   | Persona registrada con nombre, teléfono y contraseña. |
| Admin     | Caro. Única profesional que atiende.                  |

### Matriz de roles

| Acción                                             | Visitante |     Clienta     |      Admin      |
| -------------------------------------------------- | :-------: | :-------------: | :-------------: |
| Ver inicio y catálogo                              |    ✅     |       ✅        |       ✅        |
| Registrarse e iniciar sesión                       |    ✅     |        —        |        —        |
| Reservar, cancelar y reprogramar las propias citas |    ❌     | ✅ (con reglas) |        —        |
| Gestionar cualquier cita                           |    ❌     |       ❌        | ✅ (sin reglas) |
| Agenda, bloqueos y horarios                        |    ❌     |       ❌        |       ✅        |
| Servicios y precios                                |    ❌     |       ❌        |       ✅        |
| Clientas y contraseñas                             |    ❌     |       ❌        |       ✅        |
| Borrar la propia cuenta                            |    ❌     |       ✅        |        —        |

## Requisitos funcionales

### Clienta

- **RF01** Registrarse con nombre, teléfono y contraseña, aceptando el tratamiento de datos (Ley 1581 de 2012).
- **RF02** Iniciar sesión con teléfono y contraseña, y cerrar sesión.
- **RF03** Ver el catálogo de servicios con precio y duración (público).
- **RF04** Elegir uno o varios servicios y ver el total de tiempo y precio.
- **RF05** Ver las horas disponibles según el motor de disponibilidad.
- **RF06** Reservar con confirmación automática y botón para avisar a Caro por WhatsApp.
- **RF07** Ver sus citas próximas y su historial.
- **RF08** Cancelar hasta 2 horas antes de la cita.
- **RF09** Reprogramar si faltan 2 días o más.

### Admin (Caro)

- **RF10** Ver la agenda por día, semana y mes.
- **RF11** Crear, editar y reasignar citas a nombre de una clienta, sin las restricciones de las clientas.
- **RF12** Marcar cada cita como completada, no asistió o cancelada.
- **RF13** Bloquear días o franjas horarias y programar descansos (puntuales, día por día).
- **RF14** Abrir más temprano (desde las 8:00) los días que quiera.
- **RF15** Configurar el horario base y el margen entre citas.
- **RF16** Crear, editar, activar y desactivar servicios.
- **RF17** Ver las clientas y restablecerles la contraseña.
- **RF18** Recibir una notificación push cuando alguien reserva, cancela o reprograma.
- **RF19** Abrir WhatsApp con el recordatorio de cada cita ya escrito.

### Sistema

- **RF20** Bloquear automáticamente domingos y festivos de Colombia.
- **RF21** Impedir que dos citas se superpongan, con una restricción en la base de datos.
- **RF22** Permitir que una clienta borre su cuenta: se anonimizan sus datos y se conservan las citas pasadas.

## Reglas de negocio

| Regla                       | Valor por defecto                                                     | Configurable |
| --------------------------- | --------------------------------------------------------------------- | ------------ |
| Horario base                | Lunes a sábado, 9:00–19:00                                            | Sí           |
| Días cerrados               | Domingos y festivos de Colombia                                       | —            |
| Anticipación para reservar  | Entre 2 días y 1 mes calendario                                       | Sí           |
| Cancelación                 | Hasta 2 horas antes                                                   | Sí           |
| Reprogramación              | Si faltan 2 días o más; el nuevo horario cumple la ventana de reserva | Sí           |
| Margen después de cada cita | 10 minutos (no se exige al cierre)                                    | Sí           |
| Citas activas por clienta   | Sin límite                                                            | —            |
| Confirmación                | Automática si el horario está libre                                   | —            |
| Servicios por cita          | Uno o varios; se suman duración y precio                              | —            |

Ejemplo de la ventana de reserva: una cita del 18 de diciembre se puede reservar desde el 18 de noviembre hasta el 16 de diciembre.

### Horas de inicio ofrecidas (opción combinada)

El sistema ofrece horas cada 30 minutos **más** la hora justo después de cada cita existente (fin + margen). Solo se muestran las horas en las que el bloque completo entra antes del cierre y sin chocar con bloqueos ni con otras citas.

## Requisitos no funcionales

| ID    | Requisito                                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------------------------- |
| RNF01 | Mobile first y responsive; carga rápida con 4G.                                                                        |
| RNF02 | Seguridad: Argon2id, sesiones en Postgres con cookie httpOnly, límite de intentos de login, validación con Zod, HTTPS. |
| RNF03 | Privacidad: solo nombre y teléfono; consentimiento registrado.                                                         |
| RNF04 | Zona horaria America/Bogota; fechas `timestamptz`.                                                                     |
| RNF05 | Infraestructura con costo $0 (Netlify + Supabase gratis).                                                              |
| RNF06 | Backend independiente de la plataforma (`createApp()`).                                                                |
| RNF07 | Mantenibilidad: TypeScript estricto, Vitest, linter, CI.                                                               |
| RNF08 | Accesibilidad básica: contraste, botones grandes, etiquetas.                                                           |
