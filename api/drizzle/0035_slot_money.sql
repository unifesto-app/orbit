ALTER TABLE "payouts" ALTER COLUMN "event_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "slot_booked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "payments" SET "slot_booked" = true WHERE "kind" = 'slot' AND "status" = 'paid';--> statement-breakpoint
CREATE INDEX "payouts_host_id_index" ON "payouts" USING btree ("host_id");