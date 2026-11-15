ALTER TABLE "sessions" ADD COLUMN "fresh_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "fresh_via" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "new_device_phone_at" timestamp with time zone;