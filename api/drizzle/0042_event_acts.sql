CREATE TABLE "event_acts" (
	"event_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "event_acts_event_id_host_id_pk" PRIMARY KEY("event_id","host_id")
);
--> statement-breakpoint
ALTER TABLE "event_acts" ADD CONSTRAINT "event_acts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_acts" ADD CONSTRAINT "event_acts_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_acts_host_id_index" ON "event_acts" USING btree ("host_id");