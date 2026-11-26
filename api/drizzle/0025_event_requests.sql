CREATE TABLE "event_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"host" jsonb NOT NULL,
	"event" jsonb,
	"host_id" uuid,
	"event_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_requests" ADD CONSTRAINT "event_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_requests" ADD CONSTRAINT "event_requests_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_requests" ADD CONSTRAINT "event_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_requests" ADD CONSTRAINT "event_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_requests_one_open_per_user" ON "event_requests" USING btree ("user_id") WHERE "event_requests"."status" in ('open', 'changes');--> statement-breakpoint
CREATE INDEX "event_requests_status_idx" ON "event_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "event_requests_user_idx" ON "event_requests" USING btree ("user_id","created_at");