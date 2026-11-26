CREATE TABLE "notification_prefs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"push" boolean DEFAULT true NOT NULL,
	"switches" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quiet" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_devices" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"app" text NOT NULL,
	"platform" text NOT NULL,
	"env" text NOT NULL,
	"token" text NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "push_devices_token_unique" UNIQUE("token")
);
--> statement-breakpoint
DROP INDEX "deliveries_due_idx";--> statement-breakpoint
ALTER TABLE "follows" ADD COLUMN "notify" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_devices_user_id_index" ON "push_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "deliveries_due_idx" ON "deliveries" USING btree ("run_at") WHERE "deliveries"."status" in ('queued', 'held', 'sending');