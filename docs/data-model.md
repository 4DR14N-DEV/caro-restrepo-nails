# Modelo de datos

Postgres (Supabase), definido con Drizzle en `apps/api/src/db/schema.ts`. Dinero en pesos colombianos como enteros. Fechas como `timestamptz`, mostradas en America/Bogota.

| Tabla                  | Para qué                          | Campos clave                                                                                                                               |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `users`                | Clientas y Caro                   | `name`, `phone` (único), `password_hash`, `role` (`admin`/`client`), `consent_accepted_at`, `anonymized_at`                                |
| `sessions`             | Sesiones activas                  | `id` (hash del token), `user_id`, `expires_at`                                                                                             |
| `rate_limits`          | Límites de intentos               | `key` (`login-phone:`, `login-ip:` o `register-ip:` + valor; las IPv6 por bloque /64), `failed_count`, `window_started_at`, `locked_until` |
| `services`             | Catálogo                          | `name` (único), `price_cop`, `duration_minutes`, `active`, `sort_order`                                                                    |
| `appointments`         | Citas                             | `client_id`, `start_at`, `end_at`, `occupied_until`, `status`, `total_price_cop`, `created_by`, `cancelled_by`, `cancelled_at`, `notes`    |
| `appointment_services` | Servicios de cada cita            | `appointment_id`, `service_id`, copia de `service_name`, `price_cop`, `duration_minutes`                                                   |
| `business_hours`       | Horario base                      | `weekday` (1 = lunes … 6 = sábado), `opens_at`, `closes_at`                                                                                |
| `schedule_exceptions`  | Cambios puntuales                 | `kind` (`block`/`break`/`extra_open`), `starts_at`, `ends_at`, `reason`                                                                    |
| `holidays`             | Festivos de Colombia              | `date`, `name`                                                                                                                             |
| `settings`             | Reglas configurables (fila única) | `buffer_minutes`, `slot_step_minutes`, `booking_min_days`, `booking_max_months`, `cancel_min_hours`, `reschedule_min_days`                 |
| `push_subscriptions`   | Notificaciones push               | `user_id`, `endpoint` (único), `p256dh`, `auth`                                                                                            |

## Garantías en la base de datos

- **Sin superposición de citas**: `EXCLUDE USING gist (tstzrange(start_at, occupied_until) WITH &&) WHERE (status = 'scheduled')`. `occupied_until` = `end_at` + margen. Como hay una sola profesional, no hace falta `btree_gist`.
- **Coherencia de horas**: `start_at < end_at <= occupied_until`.
- **Valores válidos**: precios ≥ 0, duraciones > 0, días de la semana entre 1 y 6.
- **Copia de precios**: `appointment_services` guarda nombre, precio y duración del momento de la reserva; si un precio cambia, el historial no se altera.
- **Settings de fila única**: `id = 1` forzado por un `CHECK`.

## Estados de una cita

`scheduled` → `completed` | `cancelled` | `no_show`. Solo las citas `scheduled` ocupan la agenda.
