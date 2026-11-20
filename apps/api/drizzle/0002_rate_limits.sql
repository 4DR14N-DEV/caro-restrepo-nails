CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "rate_limits_failed_count" CHECK ("rate_limits"."failed_count" >= 0)
);
