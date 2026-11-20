-- Los festivos se calculan en código (src/booking/holidays.ts). La tabla nunca se cargó:
-- si tuviera filas, la migración se detiene en vez de borrarlas. Sin CASCADE, para que
-- falle si algo creado a mano depende de ella.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "holidays") THEN
    RAISE EXCEPTION 'La tabla holidays tiene filas: revísalas antes de borrarla.';
  END IF;
END $$;--> statement-breakpoint
DROP TABLE "holidays";
