CREATE TABLE "app_content" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "app_content" ADD CONSTRAINT "app_content_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;