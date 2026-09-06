CREATE TABLE "curriculum_interest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"board_id" varchar(32) NOT NULL,
	"level_id" varchar(64) NOT NULL,
	"subject_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "curriculum_interest" ADD CONSTRAINT "curriculum_interest_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_interest" ADD CONSTRAINT "curriculum_interest_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_interest" ADD CONSTRAINT "curriculum_interest_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_interest" ADD CONSTRAINT "curriculum_interest_level_fk" FOREIGN KEY ("board_id","level_id") REFERENCES "public"."curriculum_levels"("board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "curriculum_interest_position_idx" ON "curriculum_interest" USING btree ("board_id","level_id","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "curriculum_interest_daily_key" ON "curriculum_interest" USING btree (coalesce("user_id", '00000000-0000-0000-0000-000000000000'::uuid),"board_id","level_id","subject_id",((created_at at time zone 'UTC')::date));