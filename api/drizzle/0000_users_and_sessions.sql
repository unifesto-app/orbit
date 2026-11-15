CREATE TABLE "legal_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document" text NOT NULL,
	"version" integer NOT NULL,
	"client" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_acceptances_user_id_document_version_unique" UNIQUE("user_id","document","version")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_hash" text NOT NULL,
	"client" text NOT NULL,
	"name" text NOT NULL,
	"refresh_hash" text NOT NULL,
	"prev_refresh_hash" text,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "sessions_user_id_device_hash_unique" UNIQUE("user_id","device_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"phone" text,
	"phone_verified_at" timestamp with time zone,
	"email" text,
	"email_verified_at" timestamp with time zone,
	"dob" date,
	"gender" text,
	"photo" text,
	"suspended_at" timestamp with time zone,
	"suspended_until" timestamp with time zone,
	"suspension_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_device_hash_index" ON "sessions" USING btree ("device_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_index" ON "sessions" USING btree ("user_id") WHERE "sessions"."ended_at" is null;