CREATE TABLE "event_people" (
	"event_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "event_people_event_id_person_id_pk" PRIMARY KEY("event_id","person_id"),
	CONSTRAINT "event_people_role_length" CHECK (char_length("event_people"."role") between 1 and 30)
);
--> statement-breakpoint
CREATE TABLE "fest_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"when" text NOT NULL,
	"where" text NOT NULL,
	"about" text NOT NULL,
	"team" text,
	"prize" text,
	"act_host_id" uuid,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"headline" text NOT NULL,
	"bio" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_people" ADD CONSTRAINT "event_people_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_people" ADD CONSTRAINT "event_people_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fest_items" ADD CONSTRAINT "fest_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fest_items" ADD CONSTRAINT "fest_items_act_host_id_hosts_id_fk" FOREIGN KEY ("act_host_id") REFERENCES "public"."hosts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_people_person_id_index" ON "event_people" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "fest_items_event_id_position_index" ON "fest_items" USING btree ("event_id","position");