-- Play's slots (Orbit flows: Play): a Venue's address and weekly hours, its station types, and every claim on them
-- (bookings, walk-ins, blocks). A Venue's counter seat (Desk) is a crew row in team_roles, which needs no change here.
CREATE TABLE "station_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"count" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"hold_ends_at" timestamp with time zone,
	"user_id" uuid,
	"reason" text,
	"admitted" integer DEFAULT 0 NOT NULL,
	"checked_in_at" timestamp with time zone,
	"checked_in_by" uuid,
	"released_at" timestamp with time zone,
	"released_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "station_claims_count_positive" CHECK ("station_claims"."count" > 0),
	CONSTRAINT "station_claims_ends_after_starts" CHECK ("station_claims"."ends_at" > "station_claims"."starts_at"),
	CONSTRAINT "station_claims_held_has_end" CHECK ("station_claims"."status" <> 'held' or "station_claims"."hold_ends_at" is not null),
	CONSTRAINT "station_claims_admitted_in_count" CHECK ("station_claims"."admitted" between 0 and "station_claims"."count")
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"tile" text NOT NULL,
	"count" integer NOT NULL,
	"whole" boolean NOT NULL,
	"step" integer NOT NULL,
	"price_paise" integer NOT NULL,
	"coop_paise" integer,
	"off_peak_from" integer,
	"off_peak_to" integer,
	"off_peak_weekdays" boolean,
	"off_peak_paise" integer,
	"games" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stations_count_range" CHECK ("stations"."count" between 1 and 200),
	CONSTRAINT "stations_step" CHECK ("stations"."step" in (30, 60)),
	CONSTRAINT "stations_price_positive" CHECK ("stations"."price_paise" > 0),
	CONSTRAINT "stations_coop_positive" CHECK ("stations"."coop_paise" is null or "stations"."coop_paise" > 0),
	CONSTRAINT "stations_off_peak_all_or_nothing" CHECK (("stations"."off_peak_from" is null) = ("stations"."off_peak_to" is null) and ("stations"."off_peak_from" is null) = ("stations"."off_peak_weekdays" is null) and ("stations"."off_peak_from" is null) = ("stations"."off_peak_paise" is null)),
	CONSTRAINT "stations_off_peak_sane" CHECK ("stations"."off_peak_from" is null or ("stations"."off_peak_from" >= 0 and "stations"."off_peak_from" < "stations"."off_peak_to" and "stations"."off_peak_to" <= 24 and "stations"."off_peak_paise" < "stations"."price_paise"))
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"host_id" uuid PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"area" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"place_id" text,
	"desk_phone" text NOT NULL,
	"week" jsonb NOT NULL,
	"cutoff_minutes" integer DEFAULT 120 NOT NULL,
	"logs_walk_ins" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_cutoff_in_a_day" CHECK ("venues"."cutoff_minutes" between 0 and 1440),
	CONSTRAINT "venues_point_in_india" CHECK ("venues"."lat" between 6 and 37.5 and "venues"."lng" between 68 and 97.5)
);
--> statement-breakpoint
ALTER TABLE "station_claims" ADD CONSTRAINT "station_claims_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_claims" ADD CONSTRAINT "station_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_claims" ADD CONSTRAINT "station_claims_checked_in_by_users_id_fk" FOREIGN KEY ("checked_in_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_claims" ADD CONSTRAINT "station_claims_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_claims" ADD CONSTRAINT "station_claims_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_host_id_venues_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."venues"("host_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "station_claims_station_id_starts_at_index" ON "station_claims" USING btree ("station_id","starts_at");--> statement-breakpoint
CREATE INDEX "station_claims_user_id_index" ON "station_claims" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stations_host_id_index" ON "stations" USING btree ("host_id");