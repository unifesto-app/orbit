CREATE TABLE "interest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"ip" text,
	"country" text,
	"region" text,
	"city" text,
	"user_agent" text,
	"accept_language" text,
	"referrer" text,
	"utm" jsonb,
	"timezone" text,
	"language" text,
	"screen" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interest_email_unique" UNIQUE("email")
);
