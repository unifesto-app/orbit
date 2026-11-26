CREATE TABLE "slot_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "slot_alerts_count_positive" CHECK ("slot_alerts"."count" > 0),
	CONSTRAINT "slot_alerts_ends_after_starts" CHECK ("slot_alerts"."ends_at" > "slot_alerts"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "stations" DROP CONSTRAINT "stations_price_positive";--> statement-breakpoint
ALTER TABLE "station_claims" ADD COLUMN "qr" text;--> statement-breakpoint
ALTER TABLE "station_claims" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "slot_alerts" ADD CONSTRAINT "slot_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_alerts" ADD CONSTRAINT "slot_alerts_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slot_alerts_one_open" ON "slot_alerts" USING btree ("user_id","station_id","starts_at") WHERE "slot_alerts"."sent_at" is null;--> statement-breakpoint
CREATE INDEX "slot_alerts_waiting" ON "slot_alerts" USING btree ("starts_at") WHERE "slot_alerts"."sent_at" is null;--> statement-breakpoint
CREATE INDEX "slot_alerts_created_at_index" ON "slot_alerts" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "station_claims" ADD CONSTRAINT "station_claims_qr_unique" UNIQUE("qr");--> statement-breakpoint
ALTER TABLE "station_claims" ADD CONSTRAINT "station_claims_code_unique" UNIQUE("code");--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_price_not_negative" CHECK ("stations"."price_paise" >= 0);