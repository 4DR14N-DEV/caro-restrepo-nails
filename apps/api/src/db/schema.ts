import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Todas las fechas se guardan con zona horaria; la app las muestra en America/Bogota.
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

const createdAt = timestamptz("created_at").notNull().defaultNow();
const updatedAt = timestamptz("updated_at").notNull().defaultNow();

export const userRole = pgEnum("user_role", ["admin", "client"]);
export const appointmentStatus = pgEnum("appointment_status", [
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
]);
// Quién realizó una acción sobre una cita (crearla o cancelarla).
export const actor = pgEnum("actor", ["admin", "client"]);
export const scheduleExceptionKind = pgEnum("schedule_exception_kind", [
  "block",
  "break",
  "extra_open",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // Teléfono en formato E.164 (+573001234567). Es el identificador de login.
    // Queda en null cuando la cuenta se anonimiza.
    phone: text("phone").unique(),
    passwordHash: text("password_hash"),
    role: userRole("role").notNull().default("client"),
    consentAcceptedAt: timestamptz("consent_accepted_at").notNull(),
    anonymizedAt: timestamptz("anonymized_at"),
    createdAt,
    updatedAt,
  },
  (t) => [
    check("users_phone_e164", sql`${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    // Una cuenta activa siempre tiene teléfono y contraseña; una anonimizada, ninguno.
    check(
      "users_anonymization_consistent",
      sql`(${t.anonymizedAt} IS NULL) = (${t.phone} IS NOT NULL AND ${t.passwordHash} IS NOT NULL)`,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    // Hash SHA-256 del token; el token en claro solo vive en la cookie.
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamptz("expires_at").notNull(),
    createdAt,
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    // Pesos colombianos como enteros: nunca decimales.
    priceCop: integer("price_cop").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt,
    updatedAt,
  },
  (t) => [
    check("services_price_non_negative", sql`${t.priceCop} >= 0`),
    check("services_duration_positive", sql`${t.durationMinutes} > 0`),
  ],
);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    startAt: timestamptz("start_at").notNull(),
    endAt: timestamptz("end_at").notNull(),
    // Fin de la cita + margen de Caro. La restricción anti-superposición usa este valor.
    occupiedUntil: timestamptz("occupied_until").notNull(),
    status: appointmentStatus("status").notNull().default("scheduled"),
    totalPriceCop: integer("total_price_cop").notNull(),
    createdBy: actor("created_by").notNull(),
    cancelledBy: actor("cancelled_by"),
    cancelledAt: timestamptz("cancelled_at"),
    notes: text("notes"),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("appointments_start_at_idx").on(t.startAt),
    index("appointments_client_id_idx").on(t.clientId),
    check(
      "appointments_time_order",
      sql`${t.startAt} < ${t.endAt} AND ${t.endAt} <= ${t.occupiedUntil}`,
    ),
    check("appointments_price_non_negative", sql`${t.totalPriceCop} >= 0`),
    // Una cita cancelada siempre registra quién y cuándo; las demás, nunca.
    check(
      "appointments_cancellation_consistent",
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} IS NOT NULL AND ${t.cancelledBy} IS NOT NULL)`,
    ),
  ],
);

// Copia de cada servicio al momento de reservar: si el precio cambia, el historial no.
export const appointmentServices = pgTable(
  "appointment_services",
  {
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    serviceName: text("service_name").notNull(),
    priceCop: integer("price_cop").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.appointmentId, t.serviceId] }),
    check("appointment_services_price_non_negative", sql`${t.priceCop} >= 0`),
    check("appointment_services_duration_positive", sql`${t.durationMinutes} > 0`),
  ],
);

export const businessHours = pgTable(
  "business_hours",
  {
    // Día ISO: 1 = lunes … 6 = sábado. El domingo no se atiende.
    weekday: smallint("weekday").primaryKey(),
    opensAt: time("opens_at").notNull(),
    closesAt: time("closes_at").notNull(),
  },
  (t) => [
    check("business_hours_weekday_range", sql`${t.weekday} BETWEEN 1 AND 6`),
    check("business_hours_order", sql`${t.opensAt} < ${t.closesAt}`),
  ],
);

// Cambios puntuales al horario que Caro pone día por día: bloqueos, descansos y aperturas extra.
export const scheduleExceptions = pgTable(
  "schedule_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: scheduleExceptionKind("kind").notNull(),
    startsAt: timestamptz("starts_at").notNull(),
    endsAt: timestamptz("ends_at").notNull(),
    reason: text("reason"),
    createdAt,
  },
  (t) => [
    index("schedule_exceptions_starts_at_idx").on(t.startsAt),
    check("schedule_exceptions_order", sql`${t.startsAt} < ${t.endsAt}`),
  ],
);

export const holidays = pgTable("holidays", {
  date: date("date").primaryKey(),
  name: text("name").notNull(),
});

// Reglas de negocio configurables desde el panel. Siempre existe una sola fila (id = 1).
export const settings = pgTable(
  "settings",
  {
    id: smallint("id").primaryKey().default(1),
    bufferMinutes: integer("buffer_minutes").notNull().default(10),
    slotStepMinutes: integer("slot_step_minutes").notNull().default(30),
    bookingMinDays: integer("booking_min_days").notNull().default(2),
    bookingMaxMonths: integer("booking_max_months").notNull().default(1),
    cancelMinHours: integer("cancel_min_hours").notNull().default(2),
    rescheduleMinDays: integer("reschedule_min_days").notNull().default(2),
    updatedAt,
  },
  (t) => [
    check("settings_single_row", sql`${t.id} = 1`),
    check(
      "settings_values_valid",
      sql`${t.bufferMinutes} >= 0 AND ${t.slotStepMinutes} > 0 AND ${t.bookingMinDays} >= 0 AND ${t.bookingMaxMonths} > 0 AND ${t.cancelMinHours} >= 0 AND ${t.rescheduleMinDays} >= 0`,
    ),
  ],
);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt,
});
