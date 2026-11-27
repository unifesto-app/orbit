ALTER TABLE "events" ADD COLUMN "details" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "in_room" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "min_age" integer;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_min_age" CHECK ("events"."min_age" in (18, 21));