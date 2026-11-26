CREATE TABLE "email_suppressions" (
	"address" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
