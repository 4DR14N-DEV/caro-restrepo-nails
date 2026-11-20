ALTER TABLE "rate_limits" RENAME COLUMN "failed_count" TO "attempt_count";--> statement-breakpoint
ALTER TABLE "rate_limits" DROP CONSTRAINT "rate_limits_failed_count";--> statement-breakpoint
ALTER TABLE "rate_limits" ADD CONSTRAINT "rate_limits_attempt_count" CHECK ("rate_limits"."attempt_count" >= 0);