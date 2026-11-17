CREATE TABLE "pm_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"actor" text NOT NULL,
	"user_id" uuid,
	"token_id" uuid,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pm_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"track_key" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"owner" text,
	"due_date" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pm_tasks_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "pm_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pm_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "pm_tracks" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pm_activity" ADD CONSTRAINT "pm_activity_task_id_pm_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."pm_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pm_activity" ADD CONSTRAINT "pm_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pm_activity" ADD CONSTRAINT "pm_activity_token_id_pm_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."pm_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pm_tasks" ADD CONSTRAINT "pm_tasks_track_key_pm_tracks_key_fk" FOREIGN KEY ("track_key") REFERENCES "public"."pm_tracks"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pm_tokens" ADD CONSTRAINT "pm_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pm_tokens" ADD CONSTRAINT "pm_tokens_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pm_activity_created_at_index" ON "pm_activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pm_activity_task_id_created_at_index" ON "pm_activity" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "pm_tasks_track_key_sort_order_index" ON "pm_tasks" USING btree ("track_key","sort_order");--> statement-breakpoint
CREATE INDEX "pm_tasks_status_index" ON "pm_tasks" USING btree ("status");