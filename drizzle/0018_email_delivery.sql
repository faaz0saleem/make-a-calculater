CREATE TYPE "public"."email_kind" AS ENUM('booking_confirmed', 'booking_cancelled', 'reminder_24h', 'reminder_1h', 'session_starting', 'session_completed', 'trial_requested', 'trial_decision', 'credits_purchased', 'credits_low', 'verification_decision', 'payout_status', 'new_review', 'followed_tutor_slots');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('queued', 'sent', 'skipped', 'dead');--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "email_kind" NOT NULL,
	"to_email" varchar(320) NOT NULL,
	"subject" varchar(300) NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"status" "email_status" DEFAULT 'queued' NOT NULL,
	"skip_reason" varchar(80),
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"last_error" text,
	"provider" varchar(32),
	"provider_message_id" varchar(200),
	"correlation_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "email_deliveries_attempts" CHECK (attempts >= 0 and attempts <= 20)
);
--> statement-breakpoint
CREATE TABLE "email_preferences" (
	"user_id" uuid NOT NULL,
	"kind" "email_kind" NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_preferences_user_id_kind_pk" PRIMARY KEY("user_id","kind")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_unsubscribed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_deliveries_idempotency_key" ON "email_deliveries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "email_deliveries_due_idx" ON "email_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_user_idx" ON "email_deliveries" USING btree ("user_id","created_at");