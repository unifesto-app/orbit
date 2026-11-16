CREATE TABLE "follows" (
	"user_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_user_id_host_id_pk" PRIMARY KEY("user_id","host_id")
);
--> statement-breakpoint
CREATE TABLE "host_slugs" (
	"slug" text PRIMARY KEY NOT NULL,
	"host_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "target_host" uuid;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "about" text;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "logo" text;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "banner" text;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "verified_by" uuid;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "suspend_reason" text;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "lift_to" text;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_slugs" ADD CONSTRAINT "host_slugs_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "follows_host_id_index" ON "follows" USING btree ("host_id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_target_host_hosts_id_fk" FOREIGN KEY ("target_host") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_parent_id_hosts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_target_host_index" ON "audit_log" USING btree ("target_host");--> statement-breakpoint
CREATE INDEX "hosts_parent_id_index" ON "hosts" USING btree ("parent_id");--> statement-breakpoint
-- Every existing host keeps its current slug as its first row, so old links resolve from here on.
insert into host_slugs (slug, host_id, created_at) select slug, id, created_at from hosts;
