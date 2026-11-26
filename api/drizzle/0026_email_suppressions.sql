CREATE TABLE "email_suppressions" (
	"address" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "deliveries_provider_idx" ON "deliveries" USING btree ("provider_id") WHERE "deliveries"."provider_id" is not null;