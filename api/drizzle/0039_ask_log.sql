CREATE TABLE "ask_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"question" text NOT NULL,
	"reply" text,
	"status" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ask_log" ADD CONSTRAINT "ask_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ask_log_at_index" ON "ask_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "ask_log_user_id_at_index" ON "ask_log" USING btree ("user_id","at");