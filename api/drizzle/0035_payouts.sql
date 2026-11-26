CREATE TABLE "payout_accounts" (
	"host_id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"holder" text NOT NULL,
	"account_number" text,
	"ifsc" text,
	"upi" text,
	"bank_name" text NOT NULL,
	"last4" text NOT NULL,
	"state" text DEFAULT 'checking' NOT NULL,
	"reason" text,
	"checked_by" uuid,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payout_accounts_kind" CHECK (("payout_accounts"."kind" = 'bank' and "payout_accounts"."account_number" is not null and "payout_accounts"."ifsc" is not null and "payout_accounts"."upi" is null) or ("payout_accounts"."kind" = 'upi' and "payout_accounts"."upi" is not null and "payout_accounts"."account_number" is null and "payout_accounts"."ifsc" is null)),
	CONSTRAINT "payout_accounts_state" CHECK ("payout_accounts"."state" in ('checking', 'verified', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "payouts" ALTER COLUMN "event_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "asked_by" uuid;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "from_host" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_asked_by_users_id_fk" FOREIGN KEY ("asked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payouts_host_id_created_at_index" ON "payouts" USING btree ("host_id","created_at");