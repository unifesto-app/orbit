CREATE TABLE "room_asks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"from_member" uuid NOT NULL,
	"to_member" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "room_asks_not_self" CHECK ("room_asks"."from_member" <> "room_asks"."to_member"),
	CONSTRAINT "room_asks_status" CHECK ("room_asks"."status" in ('pending', 'accepted', 'declined'))
);
--> statement-breakpoint
CREATE TABLE "room_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"line" text NOT NULL,
	"reach" jsonb NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	CONSTRAINT "room_members_one_per_event" UNIQUE("event_id","user_id"),
	CONSTRAINT "room_members_line" CHECK (char_length("room_members"."line") between 1 and 120),
	CONSTRAINT "room_members_reach" CHECK (jsonb_typeof("room_members"."reach") = 'array' and jsonb_array_length("room_members"."reach") between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "user_blocks_not_self" CHECK ("user_blocks"."blocker_id" <> "user_blocks"."blocked_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "in_room_barred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "in_room_barred_by" uuid;--> statement-breakpoint
ALTER TABLE "room_asks" ADD CONSTRAINT "room_asks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_asks" ADD CONSTRAINT "room_asks_from_member_room_members_id_fk" FOREIGN KEY ("from_member") REFERENCES "public"."room_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_asks" ADD CONSTRAINT "room_asks_to_member_room_members_id_fk" FOREIGN KEY ("to_member") REFERENCES "public"."room_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "room_asks_one_per_pair" ON "room_asks" USING btree (least("from_member", "to_member"),greatest("from_member", "to_member"));--> statement-breakpoint
CREATE INDEX "room_asks_event_id_index" ON "room_asks" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "room_asks_to_member_index" ON "room_asks" USING btree ("to_member");--> statement-breakpoint
CREATE INDEX "room_members_user_id_index" ON "room_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_blocks_blocked_id_index" ON "user_blocks" USING btree ("blocked_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_in_room_barred_by_users_id_fk" FOREIGN KEY ("in_room_barred_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;