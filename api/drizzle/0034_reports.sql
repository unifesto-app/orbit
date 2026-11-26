CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid,
	"host_id" uuid,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"staff_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_one_subject" CHECK (("reports"."event_id" is null) <> ("reports"."host_id" is null)),
	CONSTRAINT "reports_status" CHECK ("reports"."status" in ('open', 'resolved', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_status_created_at_index" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_one_open_event" ON "reports" USING btree ("user_id","event_id") WHERE "reports"."status" = 'open' and "reports"."event_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_one_open_host" ON "reports" USING btree ("user_id","host_id") WHERE "reports"."status" = 'open' and "reports"."host_id" is not null;--> statement-breakpoint
CREATE INDEX "reports_event_id_index" ON "reports" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "reports_host_id_index" ON "reports" USING btree ("host_id");