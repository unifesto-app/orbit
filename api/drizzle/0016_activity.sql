CREATE TABLE "activity" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"platform" text NOT NULL,
	"version" text,
	CONSTRAINT "activity_user_id_day_platform_pk" PRIMARY KEY("user_id","day","platform")
);
--> statement-breakpoint
CREATE TABLE "activity_days" (
	"day" date PRIMARY KEY NOT NULL,
	"active" integer NOT NULL,
	"ios" integer NOT NULL,
	"android" integer NOT NULL,
	"web" integer NOT NULL,
	"app" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_day_idx" ON "activity" USING btree ("day");