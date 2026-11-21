import { serviceUnavailableMessage, slotTakenMessage } from "@caro/shared";
import type { Response } from "express";

// Respuestas 409 de la reserva, con el mensaje en el campo que la clienta tiene que cambiar.

export function serviceUnavailable(res: Response): void {
  res
    .status(409)
    .json({ error: "service_unavailable", fields: { services: serviceUnavailableMessage } });
}

export function slotTaken(res: Response): void {
  res.status(409).json({ error: "slot_taken", fields: { time: slotTakenMessage } });
}
