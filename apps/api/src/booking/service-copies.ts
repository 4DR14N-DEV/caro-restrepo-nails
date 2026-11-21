import { asc, inArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { appointmentServices } from "../db/schema.js";

// Nombres de los servicios de cada cita (la copia guardada al reservar), por nombre.
export async function serviceNamesByAppointment(
  db: Pick<Database, "select">,
  appointmentIds: string[],
): Promise<Map<string, string[]>> {
  const names = new Map<string, string[]>();
  if (appointmentIds.length === 0) return names;
  const copies = await db
    .select({
      appointmentId: appointmentServices.appointmentId,
      name: appointmentServices.serviceName,
    })
    .from(appointmentServices)
    .where(inArray(appointmentServices.appointmentId, appointmentIds))
    .orderBy(asc(appointmentServices.serviceName));
  for (const copy of copies) {
    names.set(copy.appointmentId, [...(names.get(copy.appointmentId) ?? []), copy.name]);
  }
  return names;
}
