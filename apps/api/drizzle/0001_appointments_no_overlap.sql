-- Ninguna cita activa puede cruzarse con otra, incluido el margen de Caro.
-- El rango es semiabierto [start_at, occupied_until): una cita puede empezar
-- justo cuando termina el margen de la anterior. Hay una sola profesional,
-- así que no hace falta btree_gist.
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (tstzrange("start_at", "occupied_until", '[)') WITH &&)
  WHERE ("status" = 'scheduled');
