CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"contact" text,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"target" text DEFAULT '' NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"tries" integer DEFAULT 0 NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"provider_id" text,
	"broadcast_id" uuid,
	"inbox_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "deliveries_dedupe_uq" UNIQUE("dedupe_key","channel","target")
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"app" text NOT NULL,
	"kind" text NOT NULL,
	"type" text NOT NULL,
	"from_name" text NOT NULL,
	"text" text NOT NULL,
	"picture" jsonb,
	"opens" jsonb,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_items_user_dedupe_uq" UNIQUE("user_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "notification_switches" (
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"off_by" uuid NOT NULL,
	"off_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "notification_switches_kind_channel_pk" PRIMARY KEY("kind","channel")
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"subject" text,
	"title" text,
	"body" text NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notification_templates_kind_channel_pk" PRIMARY KEY("kind","channel")
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_switches" ADD CONSTRAINT "notification_switches_off_by_users_id_fk" FOREIGN KEY ("off_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliveries_due_idx" ON "deliveries" USING btree ("run_at") WHERE "deliveries"."status" in ('queued', 'sending');--> statement-breakpoint
CREATE INDEX "deliveries_user_idx" ON "deliveries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "deliveries_created_idx" ON "deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "inbox_items_user_app_idx" ON "inbox_items" USING btree ("user_id","app","created_at");--> statement-breakpoint
CREATE INDEX "inbox_items_created_idx" ON "inbox_items" USING btree ("created_at");