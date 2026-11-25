ALTER TABLE "events" ADD COLUMN "poster" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "poster_tone" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "wide" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "wide_edge" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "wide_tone" text;--> statement-breakpoint
CREATE INDEX "events_status_ends_at_index" ON "events" USING btree ("status","ends_at");