import express, { type ErrorRequestHandler, type Express } from "express";
import { authRouter, type ClientIp } from "./auth/routes.js";
import { adminAgendaRouter, adminAppointmentsRouter } from "./booking/admin-agenda-routes.js";
import { adminBookingRouter } from "./booking/admin-booking-routes.js";
import { adminClientsRouter } from "./clients/admin-routes.js";
import { adminExceptionsRouter } from "./booking/admin-exceptions-routes.js";
import { adminScheduleRouter } from "./booking/admin-schedule-routes.js";
import { appointmentsRouter } from "./booking/appointments-routes.js";
import { bookingRouter } from "./booking/routes.js";
import type { Database } from "./db/client.js";
import { adminPushRouter } from "./push/admin-routes.js";
import type { PushService } from "./push/sender.js";
import { adminServicesRouter } from "./services/admin-routes.js";
import { servicesRouter } from "./services/routes.js";

export interface AppDependencies {
  db: Database;
  // Cómo obtener la IP de la clienta. Depende de la plataforma (en Netlify viene en una
  // cabecera); por defecto, la dirección de la conexión.
  clientIp?: ClientIp;
  // Reloj de la app; los tests lo fijan para que la ventana de reserva sea predecible.
  now?: () => Date;
  // Avisos push para Caro (RF18). Sin él (desarrollo, tests) no se envía ningún aviso.
  push?: PushService | null;
}

const socketAddress: ClientIp = (req) => req.socket.remoteAddress;

// Construye la aplicación Express sin atarla a ninguna plataforma.
// El servidor local y el adaptador de Netlify solo la envuelven.
export function createApp({
  db,
  clientIp = socketAddress,
  now = () => new Date(),
  push = null,
}: AppDependencies): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authRouter(db, clientIp, now));
  app.use("/api/services", servicesRouter(db));
  app.use("/api/admin/services", adminServicesRouter(db));
  app.use("/api/admin/agenda", adminAgendaRouter(db, now));
  app.use("/api/admin/appointments", adminAppointmentsRouter(db, now));
  app.use("/api/admin/exceptions", adminExceptionsRouter(db, now));
  app.use("/api/admin/schedule", adminScheduleRouter(db, now));
  app.use("/api/admin/appointments", adminBookingRouter(db, now));
  app.use("/api/admin/clients", adminClientsRouter(db, now));
  app.use("/api/admin/push", adminPushRouter(db, push));
  app.use("/api/booking", bookingRouter(db, now));
  app.use("/api/appointments", appointmentsRouter(db, now));

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  // Errores siempre en JSON y sin detalles internos.
  // Express reconoce el manejador de errores por sus 4 parámetros: `_next` es obligatorio.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: "payload_too_large" });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "internal_error" });
  };
  app.use(errorHandler);

  return app;
}
