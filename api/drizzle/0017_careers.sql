CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opening_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"linkedin" text,
	"link" text,
	"note" text,
	"resume_key" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "applications_opening_email_uq" UNIQUE("opening_id","email")
);
--> statement-breakpoint
CREATE TABLE "openings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"team" text NOT NULL,
	"place" text NOT NULL,
	"kind" text NOT NULL,
	"pay" text,
	"about" text NOT NULL,
	"does" jsonb NOT NULL,
	"needs" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "openings_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_opening_id_openings_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."openings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openings" ADD CONSTRAINT "openings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_opening_idx" ON "applications" USING btree ("opening_id","created_at");--> statement-breakpoint
CREATE INDEX "openings_status_idx" ON "openings" USING btree ("status");