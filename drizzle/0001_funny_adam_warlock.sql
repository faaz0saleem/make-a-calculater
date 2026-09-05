CREATE TYPE "public"."language_proficiency" AS ENUM('basic', 'conversational', 'fluent', 'native');--> statement-breakpoint
CREATE TABLE "tutor_languages" (
	"tutor_id" uuid NOT NULL,
	"language_code" varchar(8) NOT NULL,
	"proficiency" "language_proficiency" NOT NULL,
	CONSTRAINT "tutor_languages_tutor_id_language_code_pk" PRIMARY KEY("tutor_id","language_code")
);
--> statement-breakpoint
ALTER TABLE "tutor_languages" ADD CONSTRAINT "tutor_languages_tutor_id_users_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tutor_languages_code_idx" ON "tutor_languages" USING btree ("language_code");