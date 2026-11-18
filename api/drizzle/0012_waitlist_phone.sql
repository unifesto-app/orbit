ALTER TABLE "interest" DROP CONSTRAINT "interest_email_unique";--> statement-breakpoint
ALTER TABLE "interest" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "interest" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "interest" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "interest" ADD COLUMN "dob" date;--> statement-breakpoint
ALTER TABLE "interest" ADD COLUMN "features" jsonb;--> statement-breakpoint
ALTER TABLE "interest" ADD CONSTRAINT "interest_phone_unique" UNIQUE("phone");