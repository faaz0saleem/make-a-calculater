CREATE TYPE "public"."availability_exception_kind" AS ENUM('block', 'extra');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('pending_tutor', 'confirmed', 'in_progress', 'completed', 'settled', 'cancelled_by_student', 'cancelled_by_tutor', 'expired', 'no_show_student', 'no_show_tutor', 'disputed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."credential_kind" AS ENUM('degree', 'diploma', 'certificate', 'teaching_licence', 'id');--> statement-breakpoint
CREATE TYPE "public"."credential_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."ledger_account" AS ENUM('student_credits', 'escrow', 'tutor_pending', 'tutor_available', 'platform_revenue', 'payout_locked');--> statement-breakpoint
CREATE TYPE "public"."party" AS ENUM('student', 'tutor', 'admin', 'system');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('requested', 'approved', 'processing', 'paid', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('pending', 'paid', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'reviewing', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."report_target" AS ENUM('user', 'tutor_profile', 'booking', 'review', 'message');--> statement-breakpoint
CREATE TYPE "public"."session_event" AS ENUM('room_started', 'participant_joined', 'participant_left', 'room_finished');--> statement-breakpoint
CREATE TYPE "public"."subject_level" AS ENUM('beginner', 'intermediate', 'advanced', 'exam_prep');--> statement-breakpoint
CREATE TYPE "public"."tutor_status" AS ENUM('draft', 'pending_review', 'verified', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('student', 'tutor', 'admin');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('uploading', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"provider" varchar(64) NOT NULL,
	"provider_account_id" varchar(255) NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" varchar(64),
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "admin_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" varchar(80) NOT NULL,
	"target_type" varchar(60) NOT NULL,
	"target_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"ip" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" "availability_exception_kind" NOT NULL,
	"start_utc" timestamp with time zone NOT NULL,
	"end_utc" timestamp with time zone NOT NULL,
	"note" varchar(200)
);
--> statement-breakpoint
CREATE TABLE "availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time_utc" time NOT NULL,
	"end_time_utc" time NOT NULL,
	"weekday_local" smallint NOT NULL,
	"start_time_local" time NOT NULL,
	"end_time_local" time NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"tutor_id" uuid NOT NULL,
	"subject_id" uuid,
	"is_trial" boolean DEFAULT false NOT NULL,
	"start_at_utc" timestamp with time zone NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"status" "booking_status" NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"commission_bps" integer DEFAULT 2000 NOT NULL,
	"escrow_cents" integer DEFAULT 0 NOT NULL,
	"student_tz" varchar(64) NOT NULL,
	"tutor_tz" varchar(64) NOT NULL,
	"livekit_room" varchar(100),
	"reschedule_count" smallint DEFAULT 0 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" "party",
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_id" uuid NOT NULL,
	"kind" "credential_kind" NOT NULL,
	"title" varchar(200) NOT NULL,
	"institution" varchar(200) NOT NULL,
	"year" smallint,
	"file_key" text NOT NULL,
	"status" "credential_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_packs" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"paid_cents" integer NOT NULL,
	"credits_cents" integer NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pack_id" varchar(32) NOT NULL,
	"paid_cents" integer NOT NULL,
	"credits_cents" integer NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_ref" varchar(200),
	"status" "purchase_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"student_id" uuid NOT NULL,
	"tutor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_student_id_tutor_id_pk" PRIMARY KEY("student_id","tutor_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"booking_id" uuid,
	"payout_id" uuid,
	"purchase_id" uuid,
	"account" "ledger_account" NOT NULL,
	"owner_id" uuid,
	"delta_cents" bigint NOT NULL,
	"reason" varchar(100) NOT NULL,
	"idempotency_key" varchar(200) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"body_masked" text NOT NULL,
	"body_raw" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_id" uuid NOT NULL,
	"account_title" varchar(200) NOT NULL,
	"bank_name" varchar(200) NOT NULL,
	"country" varchar(2) NOT NULL,
	"account_number_enc" text NOT NULL,
	"swift_enc" text,
	"cnic_enc" text,
	"last4" varchar(4) NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_id" uuid NOT NULL,
	"method_id" uuid,
	"amount_cents" integer NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"status" "payout_status" DEFAULT 'requested' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"paid_ref" varchar(120),
	"reject_reason" text
);
--> statement-breakpoint
CREATE TABLE "platform_accounts" (
	"account" "ledger_account" PRIMARY KEY NOT NULL,
	"balance_cents" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"target_type" "report_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" varchar(120) NOT NULL,
	"body" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"tutor_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"body" text,
	"tutor_reply" text,
	"hidden_at" timestamp with time zone,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"user_id" uuid,
	"event" "session_event" NOT NULL,
	"at_utc" timestamp with time zone NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_wallets" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"credits_cents" bigint DEFAULT 0 NOT NULL,
	"lifetime_purchased_cents" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"parent_id" uuid,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"tutor_id" uuid NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" "tutor_status" DEFAULT 'draft' NOT NULL,
	"headline" varchar(80),
	"bio" text,
	"intro_video_id" uuid,
	"hourly_cents" integer DEFAULT 2500 NOT NULL,
	"half_hour_cents" integer DEFAULT 1250 NOT NULL,
	"promo_cents" integer,
	"promo_starts_at" timestamp with time zone,
	"promo_ends_at" timestamp with time zone,
	"commission_bps" integer DEFAULT 2000 NOT NULL,
	"offers_trial" boolean DEFAULT false NOT NULL,
	"trial_minutes" smallint DEFAULT 15 NOT NULL,
	"max_trials_per_week" smallint DEFAULT 5 NOT NULL,
	"buffer_minutes" smallint DEFAULT 10 NOT NULL,
	"max_sessions_per_day" smallint DEFAULT 8 NOT NULL,
	"booking_horizon_days" smallint DEFAULT 30 NOT NULL,
	"min_lead_minutes" smallint DEFAULT 60 NOT NULL,
	"pending_cents" bigint DEFAULT 0 NOT NULL,
	"available_cents" bigint DEFAULT 0 NOT NULL,
	"payout_locked_cents" bigint DEFAULT 0 NOT NULL,
	"lifetime_earned_cents" bigint DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"submitted_at" timestamp with time zone,
	"rejection_reason" text,
	"strikes" smallint DEFAULT 0 NOT NULL,
	"response_median_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_ranking" (
	"tutor_id" uuid PRIMARY KEY NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"bayesian_rating_milli" integer DEFAULT 4300 NOT NULL,
	"completion_rate_bps" integer DEFAULT 0 NOT NULL,
	"trial_to_paid_bps" integer DEFAULT 0 NOT NULL,
	"availability_density_bps" integer DEFAULT 0 NOT NULL,
	"response_speed_bps" integer DEFAULT 0 NOT NULL,
	"recency_bps" integer DEFAULT 0 NOT NULL,
	"exploration_boost" integer DEFAULT 0 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"session_count" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_subjects" (
	"tutor_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"level" "subject_level" NOT NULL,
	"years_experience" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "tutor_subjects_tutor_id_subject_id_pk" PRIMARY KEY("tutor_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text,
	"roles" "user_role"[] DEFAULT ARRAY['student']::user_role[] NOT NULL,
	"name" varchar(120) NOT NULL,
	"avatar_url" text,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"country" varchar(2),
	"city" varchar(120),
	"email_verified_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"hls_url" text,
	"thumbnail_url" text,
	"thumbnail_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_s" integer,
	"status" "video_status" DEFAULT 'uploading' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_tutor_id_users_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_tutor_id_users_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tutor_id_users_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_tutor_id_users_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_purchases" ADD CONSTRAINT "credit_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_purchases" ADD CONSTRAINT "credit_purchases_pack_id_credit_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."credit_packs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_tutor_id_users_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_methods" ADD CONSTRAINT "payout_methods_tutor_id_users_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_tutor_id_users_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_method_id_payout_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."payout_methods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tutor_id_users_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_wallets" ADD CONSTRAINT "student_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_tutor_id_users_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_profiles" ADD CONSTRAINT "tutor_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_profiles" ADD CONSTRAINT "tutor_profiles_intro_video_id_videos_id_fk" FOREIGN KEY ("intro_video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_profiles" ADD CONSTRAINT "tutor_profiles_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_ranking" ADD CONSTRAINT "tutor_ranking_tutor_id_users_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_subjects" ADD CONSTRAINT "tutor_subjects_tutor_id_users_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_subjects" ADD CONSTRAINT "tutor_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_actor_idx" ON "admin_audit" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "availability_exceptions_tutor_idx" ON "availability_exceptions" USING btree ("tutor_id","date");--> statement-breakpoint
CREATE INDEX "availability_rules_tutor_idx" ON "availability_rules" USING btree ("tutor_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_no_overlap" ON "bookings" USING btree ("tutor_id","start_at_utc") WHERE status in ('pending_tutor', 'confirmed', 'in_progress');--> statement-breakpoint
CREATE UNIQUE INDEX "one_trial_per_pair" ON "bookings" USING btree ("student_id","tutor_id") WHERE is_trial = true;--> statement-breakpoint
CREATE INDEX "bookings_student_idx" ON "bookings" USING btree ("student_id","start_at_utc");--> statement-breakpoint
CREATE INDEX "bookings_tutor_idx" ON "bookings" USING btree ("tutor_id","start_at_utc");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "bookings" USING btree ("status","start_at_utc");--> statement-breakpoint
CREATE INDEX "credentials_tutor_idx" ON "credentials" USING btree ("tutor_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_purchases_idempotency_key" ON "credit_purchases" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "credit_purchases_user_idx" ON "credit_purchases" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "follows_tutor_idx" ON "follows" USING btree ("tutor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_idempotency_key" ON "ledger_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_owner_idx" ON "ledger_entries" USING btree ("account","owner_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_booking_idx" ON "ledger_entries" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "payout_methods_tutor_idx" ON "payout_methods" USING btree ("tutor_id");--> statement-breakpoint
CREATE INDEX "payouts_status_idx" ON "payouts" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_booking_key" ON "reviews" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "reviews_tutor_idx" ON "reviews" USING btree ("tutor_id","created_at");--> statement-breakpoint
CREATE INDEX "session_events_booking_idx" ON "session_events" USING btree ("booking_id","at_utc");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_slug_key" ON "subjects" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "threads_pair_key" ON "threads" USING btree ("student_id","tutor_id");--> statement-breakpoint
CREATE INDEX "tutor_profiles_status_idx" ON "tutor_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tutor_profiles_hourly_idx" ON "tutor_profiles" USING btree ("hourly_cents");--> statement-breakpoint
CREATE INDEX "tutor_ranking_score_idx" ON "tutor_ranking" USING btree ("score");--> statement-breakpoint
CREATE INDEX "tutor_subjects_subject_idx" ON "tutor_subjects" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_roles_idx" ON "users" USING gin ("roles");