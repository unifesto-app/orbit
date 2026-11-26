CREATE TABLE "failed_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"excerpt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"event_id" uuid,
	"ticket_type_id" uuid,
	"claim_id" uuid,
	"quantity" integer NOT NULL,
	"unit_price_paise" integer NOT NULL,
	"plan" text NOT NULL,
	"buyer_fee_bps" integer NOT NULL,
	"buyer_fee_paise" integer NOT NULL,
	"commission_bps" integer NOT NULL,
	"commission_paise" integer NOT NULL,
	"fee_included" boolean NOT NULL,
	"gst_fee_paise" integer DEFAULT 0 NOT NULL,
	"gst_commission_paise" integer DEFAULT 0 NOT NULL,
	"amount_paise" integer NOT NULL,
	"merchant" text DEFAULT 'orbit' NOT NULL,
	"razorpay_order_id" text NOT NULL,
	"razorpay_payment_id" text,
	"razorpay_fee_paise" integer,
	"razorpay_tax_paise" integer,
	"status" text DEFAULT 'created' NOT NULL,
	"booking_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payments_razorpay_order_id_unique" UNIQUE("razorpay_order_id"),
	CONSTRAINT "payments_razorpay_payment_id_unique" UNIQUE("razorpay_payment_id"),
	CONSTRAINT "payments_amounts" CHECK ("payments"."amount_paise" > 0 and "payments"."quantity" > 0 and "payments"."unit_price_paise" > 0),
	CONSTRAINT "payments_status" CHECK ("payments"."status" in ('created', 'paid', 'refundPending', 'refunded', 'expired', 'failed')),
	CONSTRAINT "payments_plan" CHECK ("payments"."plan" in ('3+2', '5+0')),
	CONSTRAINT "payments_kind" CHECK (("payments"."kind" = 'ticket' and "payments"."event_id" is not null and "payments"."ticket_type_id" is not null) or ("payments"."kind" = 'slot' and "payments"."claim_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"utr" text,
	"reason" text,
	"by" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payouts_utr_unique" UNIQUE("utr"),
	CONSTRAINT "payouts_amount_positive" CHECK ("payouts"."amount_paise" > 0),
	CONSTRAINT "payouts_utr" CHECK ("payouts"."utr" is null or (length("payouts"."utr") between 6 and 40 and "payouts"."utr" = upper("payouts"."utr"))),
	CONSTRAINT "payouts_status" CHECK ("payouts"."status" in ('requested', 'paid', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "razorpay_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"handled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"razorpay_payment_id" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"reason" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"razorpay_refund_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "refunds_razorpay_refund_id_unique" UNIQUE("razorpay_refund_id"),
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount_paise" > 0),
	CONSTRAINT "refunds_status" CHECK ("refunds"."status" in ('requested', 'sent', 'processed', 'failed')),
	CONSTRAINT "refunds_kind" CHECK ("refunds"."kind" in ('auto', 'staff', 'request'))
);
--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "fee_plan" text DEFAULT '3+2' NOT NULL;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "fee_included" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_ticket_type_id_ticket_types_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_claim_id_station_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."station_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "failed_webhooks_received_at_index" ON "failed_webhooks" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_open_per_type" ON "payments" USING btree ("user_id","ticket_type_id") WHERE "payments"."status" = 'created';--> statement-breakpoint
CREATE INDEX "payments_status_created_at_index" ON "payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payments_host_id_created_at_index" ON "payments" USING btree ("host_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_event_id_index" ON "payments" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "payouts_event_id_index" ON "payouts" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "refunds_payment_id_index" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refunds_status_next_attempt_at_index" ON "refunds" USING btree ("status","next_attempt_at");