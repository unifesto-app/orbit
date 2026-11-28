ALTER TABLE "users" ADD COLUMN "review" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_review_unique" UNIQUE("review");