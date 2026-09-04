CREATE TYPE "public"."curriculum_stage" AS ENUM('lower_secondary', 'upper_secondary', 'advanced_1', 'advanced_2', 'tertiary', 'other');--> statement-breakpoint
CREATE TABLE "board_countries" (
	"board_id" varchar(32) NOT NULL,
	"country" varchar(2) NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "board_countries_board_id_country_pk" PRIMARY KEY("board_id","country")
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curriculum_levels" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"board_id" varchar(32) NOT NULL,
	"name" varchar(120) NOT NULL,
	"stage" "curriculum_stage" NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_curriculum" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"board_id" varchar(32) NOT NULL,
	"level_id" varchar(64) NOT NULL,
	"subject_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_curriculum" (
	"tutor_id" uuid NOT NULL,
	"board_id" varchar(32) NOT NULL,
	"level_id" varchar(64) NOT NULL,
	"subject_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tutor_curriculum_tutor_id_board_id_level_id_subject_id_pk" PRIMARY KEY("tutor_id","board_id","level_id","subject_id")
);
--> statement-breakpoint
ALTER TABLE "tutor_ranking" ADD COLUMN "free_hours_mask" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "board_countries" ADD CONSTRAINT "board_countries_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_levels" ADD CONSTRAINT "curriculum_levels_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_curriculum" ADD CONSTRAINT "student_curriculum_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_curriculum" ADD CONSTRAINT "student_curriculum_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_curriculum" ADD CONSTRAINT "student_curriculum_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "curriculum_levels_board_id_key" ON "curriculum_levels" USING btree ("board_id","id");--> statement-breakpoint
ALTER TABLE "student_curriculum" ADD CONSTRAINT "student_curriculum_level_fk" FOREIGN KEY ("board_id","level_id") REFERENCES "public"."curriculum_levels"("board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_curriculum" ADD CONSTRAINT "tutor_curriculum_tutor_id_users_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_curriculum" ADD CONSTRAINT "tutor_curriculum_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_curriculum" ADD CONSTRAINT "tutor_curriculum_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_curriculum" ADD CONSTRAINT "tutor_curriculum_level_fk" FOREIGN KEY ("board_id","level_id") REFERENCES "public"."curriculum_levels"("board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_countries_country_idx" ON "board_countries" USING btree ("country","sort_order");--> statement-breakpoint
CREATE INDEX "boards_sort_idx" ON "boards" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "curriculum_levels_board_idx" ON "curriculum_levels" USING btree ("board_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "student_curriculum_position_key" ON "student_curriculum" USING btree ("student_id","board_id","level_id","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_curriculum_primary_key" ON "student_curriculum" USING btree ("student_id") WHERE is_primary;--> statement-breakpoint
CREATE INDEX "tutor_curriculum_position_idx" ON "tutor_curriculum" USING btree ("board_id","level_id","subject_id");--> statement-breakpoint
CREATE INDEX "tutor_curriculum_subject_idx" ON "tutor_curriculum" USING btree ("subject_id");