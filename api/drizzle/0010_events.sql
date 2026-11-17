CREATE TABLE "event_slugs" (
	"slug" text PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"title" text NOT NULL,
	"category" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"venue" text,
	"address" text,
	"area" text,
	"city" text,
	"lat" double precision,
	"lng" double precision,
	"place_id" text,
	"online" boolean DEFAULT false NOT NULL,
	"online_link" text,
	"about" text,
	"agenda" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"faq" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"published_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug"),
	CONSTRAINT "events_ends_after_starts" CHECK ("events"."ends_at" is null or "events"."starts_at" is null or "events"."ends_at" > "events"."starts_at"),
	CONSTRAINT "events_place_all_or_nothing" CHECK (("events"."venue" is null) = ("events"."address" is null) and ("events"."venue" is null) = ("events"."area" is null) and ("events"."venue" is null) = ("events"."city" is null)),
	CONSTRAINT "events_point_both_or_neither" CHECK (("events"."lat" is null) = ("events"."lng" is null)),
	CONSTRAINT "events_point_needs_venue" CHECK ("events"."lat" is null or "events"."venue" is not null),
	CONSTRAINT "events_point_in_india" CHECK ("events"."lat" is null or ("events"."lat" between 6 and 37.5 and "events"."lng" between 68 and 97.5))
);
--> statement-breakpoint
CREATE TABLE "ticket_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_paise" integer DEFAULT 0 NOT NULL,
	"quantity" integer,
	"sales_start_at" timestamp with time zone,
	"sales_end_at" timestamp with time zone,
	"note" text,
	"per_person_limit" integer DEFAULT 10 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_types_per_person_limit" CHECK ("ticket_types"."per_person_limit" between 1 and 10),
	CONSTRAINT "ticket_types_price_not_negative" CHECK ("ticket_types"."price_paise" >= 0),
	CONSTRAINT "ticket_types_quantity_positive" CHECK ("ticket_types"."quantity" is null or "ticket_types"."quantity" > 0),
	CONSTRAINT "ticket_types_sales_end_after_start" CHECK ("ticket_types"."sales_end_at" is null or "ticket_types"."sales_start_at" is null or "ticket_types"."sales_end_at" > "ticket_types"."sales_start_at")
);
--> statement-breakpoint
ALTER TABLE "event_slugs" ADD CONSTRAINT "event_slugs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_host_id_starts_at_index" ON "events" USING btree ("host_id","starts_at");--> statement-breakpoint
CREATE INDEX "events_status_starts_at_index" ON "events" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "ticket_types_event_id_index" ON "ticket_types" USING btree ("event_id");