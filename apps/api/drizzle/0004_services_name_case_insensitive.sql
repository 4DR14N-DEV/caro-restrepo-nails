ALTER TABLE "services" DROP CONSTRAINT "services_name_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "services_name_lower_unique" ON "services" USING btree (lower("name"));