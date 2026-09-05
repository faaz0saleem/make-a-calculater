CREATE TYPE "public"."contact_flag_status" AS ENUM('pending', 'confirmed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."sanction_level" AS ENUM('warning', 'restriction', 'review');--> statement-breakpoint
CREATE TYPE "public"."sanction_status" AS ENUM('issued', 'acknowledged', 'appealed', 'lifted', 'upheld');--> statement-breakpoint
CREATE TABLE "contact_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"score" smallint NOT NULL,
	"band" varchar(8) NOT NULL,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "contact_flag_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sanctions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"level" "sanction_level" NOT NULL,
	"reason" text NOT NULL,
	"source" varchar(32) NOT NULL,
	"source_id" uuid,
	"issued_by" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"restricted_until" timestamp with time zone,
	"status" "sanction_status" DEFAULT 'issued' NOT NULL,
	"appeal_note" text,
	"appealed_at" timestamp with time zone,
	"appeal_decided_by" uuid,
	"appeal_decided_at" timestamp with time zone,
	"appeal_outcome" text
);
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "resolution_action" varchar(40);--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "resolution_reason" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "contact_flags" ADD CONSTRAINT "contact_flags_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_flags" ADD CONSTRAINT "contact_flags_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_flags" ADD CONSTRAINT "contact_flags_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_flags" ADD CONSTRAINT "contact_flags_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_appeal_decided_by_users_id_fk" FOREIGN KEY ("appeal_decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_flags_message_key" ON "contact_flags" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "contact_flags_queue_idx" ON "contact_flags" USING btree ("status","score");--> statement-breakpoint
CREATE INDEX "contact_flags_sender_idx" ON "contact_flags" USING btree ("sender_id","created_at");--> statement-breakpoint
CREATE INDEX "user_sanctions_user_idx" ON "user_sanctions" USING btree ("user_id","issued_at");--> statement-breakpoint
CREATE INDEX "user_sanctions_active_idx" ON "user_sanctions" USING btree ("user_id","restricted_until");--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target_type","target_id");