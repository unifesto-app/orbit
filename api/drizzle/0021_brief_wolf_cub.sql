CREATE TABLE "list_events" (
	"user_id" uuid NOT NULL,
	"list_id" text NOT NULL,
	"event_id" uuid NOT NULL,
	CONSTRAINT "list_events_user_id_list_id_event_id_pk" PRIMARY KEY("user_id","list_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"touched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lists_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "saves" (
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saves_user_id_event_id_pk" PRIMARY KEY("user_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "list_events" ADD CONSTRAINT "list_events_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_events" ADD CONSTRAINT "list_events_user_id_list_id_lists_user_id_id_fk" FOREIGN KEY ("user_id","list_id") REFERENCES "public"."lists"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saves" ADD CONSTRAINT "saves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saves" ADD CONSTRAINT "saves_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "list_events_event_id_index" ON "list_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "saves_event_id_index" ON "saves" USING btree ("event_id");