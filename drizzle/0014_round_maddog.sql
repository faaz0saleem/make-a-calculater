CREATE TYPE "public"."grasp" AS ENUM('struggling', 'developing', 'secure');--> statement-breakpoint
CREATE TYPE "public"."homework_status" AS ENUM('assigned', 'submitted', 'marked', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."recurring_status" AS ENUM('active', 'ending', 'ended');--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'scheduled' BEFORE 'pending_tutor';--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'lapsed' BEFORE 'no_show_student';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'session_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'session_waiting';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'series_short';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'series_lapsed';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'series_ending';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'homework_assigned';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'homework_submitted';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'homework_marked';--> statement-breakpoint
CREATE TABLE "booking_topics" (
	"booking_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"covered" boolean,
	"grasp" "grasp",
	"marked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_topics_booking_id_topic_id_pk" PRIMARY KEY("booking_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "homework" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"tutor_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"topic_id" uuid,
	"title" varchar(200) NOT NULL,
	"body" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"due_at" timestamp with time zone,
	"status" "homework_status" DEFAULT 'assigned' NOT NULL,
	"submission_body" text,
	"submission_attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"mark" smallint,
	"mark_out_of" smallint,
	"feedback" text,
	"marked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homework_mark_range" CHECK (mark is null or (mark_out_of is not null and mark between 0 and mark_out_of))
);
--> statement-breakpoint
CREATE TABLE "recurring_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"tutor_id" uuid NOT NULL,
	"subject_id" uuid,
	"weekdays" smallint[] NOT NULL,
	"start_time_local" time NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"price_cents" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"status" "recurring_status" DEFAULT 'active' NOT NULL,
	"ended_by" "party",
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"materialised_through" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_series_weekdays" CHECK (array_length(weekdays, 1) between 1 and 7
          and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
	CONSTRAINT "recurring_series_duration" CHECK (duration_minutes in (30, 60, 90, 120)),
	CONSTRAINT "recurring_series_price" CHECK (price_cents > 0)
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" varchar(32) NOT NULL,
	"level_id" varchar(64) NOT NULL,
	"subject_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"reference" varchar(32),
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_topics" (
	"tutor_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tutor_topics_tutor_id_topic_id_pk" PRIMARY KEY("tutor_id","topic_id")
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "occurrence_date" date;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "topic_note" text;--> statement-breakpoint
ALTER TABLE "booking_topics" ADD CONSTRAINT "booking_topics_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_topics" ADD CONSTRAINT "booking_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework" ADD CONSTRAINT "homework_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework" ADD CONSTRAINT "homework_tutor_id_users_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework" ADD CONSTRAINT "homework_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework" ADD CONSTRAINT "homework_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "recurring_series_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "recurring_series_tutor_id_users_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "recurring_series_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_level_fk" FOREIGN KEY ("board_id","level_id") REFERENCES "public"."curriculum_levels"("board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_topics" ADD CONSTRAINT "tutor_topics_tutor_id_users_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_topics" ADD CONSTRAINT "tutor_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_topics_topic_idx" ON "booking_topics" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "homework_student_idx" ON "homework" USING btree ("student_id","status","due_at");--> statement-breakpoint
CREATE INDEX "homework_tutor_idx" ON "homework" USING btree ("tutor_id","status");--> statement-breakpoint
CREATE INDEX "homework_booking_idx" ON "homework" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "recurring_series_tutor_idx" ON "recurring_series" USING btree ("tutor_id","status");--> statement-breakpoint
CREATE INDEX "recurring_series_student_idx" ON "recurring_series" USING btree ("student_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "topics_position_name_key" ON "topics" USING btree ("board_id","level_id","subject_id","name");--> statement-breakpoint
CREATE INDEX "topics_position_idx" ON "topics" USING btree ("board_id","level_id","subject_id","sort_order");--> statement-breakpoint
CREATE INDEX "tutor_topics_topic_idx" ON "tutor_topics" USING btree ("topic_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_series_id_recurring_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."recurring_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_booking_per_occurrence" ON "bookings" USING btree ("series_id","occurrence_date") WHERE series_id is not null;--> statement-breakpoint
CREATE INDEX "bookings_series_idx" ON "bookings" USING btree ("series_id","start_at_utc");
