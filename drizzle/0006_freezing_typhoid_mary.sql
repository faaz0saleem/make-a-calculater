CREATE TYPE "public"."reschedule_status" AS ENUM('pending', 'accepted', 'declined', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "reschedule_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"requested_by" "party" NOT NULL,
	"new_start_at_utc" timestamp with time zone NOT NULL,
	"status" "reschedule_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"note" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "slot_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"tutor_id" uuid NOT NULL,
	"start_at_utc" timestamp with time zone NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reschedule_requests" ADD CONSTRAINT "reschedule_requests_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reschedule_requests" ADD CONSTRAINT "reschedule_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_holds" ADD CONSTRAINT "slot_holds_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_holds" ADD CONSTRAINT "slot_holds_tutor_id_users_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reschedule_one_open_per_booking" ON "reschedule_requests" USING btree ("booking_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "reschedule_booking_idx" ON "reschedule_requests" USING btree ("booking_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "slot_holds_student_slot" ON "slot_holds" USING btree ("student_id","tutor_id","start_at_utc");--> statement-breakpoint
CREATE INDEX "slot_holds_slot_idx" ON "slot_holds" USING btree ("tutor_id","start_at_utc","expires_at");