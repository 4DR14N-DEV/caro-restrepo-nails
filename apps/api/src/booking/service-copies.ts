import { asc, inArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { appointmentServices } from "../db/schema.js";

// Los servicios de cada cita (la copia guardada al reservar), ordenados por nombre.
export async function serviceCopiesByAppointment(
  db: Pick<Database, "select">,
  appointmentIds: string[],
): Promise<Map<string, { serviceId: string; name: string }[]>> {
  const copies = new Map<string, { serviceId: string; name: string }[]>();
  if (appointmentIds.length === 0) return copies;
  const rows = await db
    .select({
      appointmentId: appointmentServices.appointmentId,
      serviceId: appointmentServices.serviceId,
      name: appointmentServices.serviceName,
    })
    .from(appointmentServices)
    .where(inArray(appointmentServices.appointmentId, appointmentIds))
    .orderBy(asc(appointmentServices.serviceName));
  for (const row of rows) {
    copies.set(row.appointmentId, [
      ...(copies.get(row.appointmentId) ?? []),
      { serviceId: row.serviceId, name: row.name },
    ]);
  }
  return copies;
}

// Solo los nombres de los servicios de cada cita.
export async function serviceNamesByAppointment(
  db: Pick<Database, "select">,
  appointmentIds: string[],
): Promise<Map<string, string[]>> {
  const copies = await serviceCopiesByAppointment(db, appointmentIds);
  return new Map([...copies].map(([id, list]) => [id, list.map((copy) => copy.name)]));
}
