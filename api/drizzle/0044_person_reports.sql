DROP INDEX "reports_one_open_event";--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "subject_user_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_one_open_user" ON "reports" USING btree ("user_id","subject_user_id") WHERE "reports"."status" = 'open' and "reports"."subject_user_id" is not null;--> statement-breakpoint
CREATE INDEX "reports_subject_user_id_index" ON "reports" USING btree ("subject_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_one_open_event" ON "reports" USING btree ("user_id","event_id") WHERE "reports"."status" = 'open' and "reports"."event_id" is not null and "reports"."subject_user_id" is null;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_person_in_event" CHECK ("reports"."subject_user_id" is null or "reports"."event_id" is not null);