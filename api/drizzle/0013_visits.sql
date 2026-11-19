CREATE TABLE "visit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"visitor" text NOT NULL,
	"path" text NOT NULL,
	"source" text NOT NULL,
	"app" text,
	"os" text,
	"country" text,
	"region" text,
	"city" text,
	"ms" integer,
	"lcp" integer,
	"inp" integer,
	"ttfb" integer,
	"cls" double precision,
	"started" boolean DEFAULT false NOT NULL,
	"code" boolean DEFAULT false NOT NULL,
	"joined" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "visit_at_idx" ON "visit" USING btree ("at");