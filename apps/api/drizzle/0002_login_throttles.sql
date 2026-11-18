CREATE TABLE "login_throttles" (
	"phone" text PRIMARY KEY NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "login_throttles_failed_count" CHECK ("login_throttles"."failed_count" >= 0)
);
