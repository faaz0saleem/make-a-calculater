ALTER TABLE "tutor_profiles" ALTER COLUMN "commission_bps" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tutor_profiles" ALTER COLUMN "commission_bps" DROP NOT NULL;--> statement-breakpoint
-- The column is a *negotiated floor*, and 2000 was the old default standing in
-- for "nothing was negotiated". Left as 2000 it would cap every existing tutor
-- at the old 20% first-booking rate and make the rise to 22% a no-op for
-- everybody already on the platform. Rows that were deliberately set to
-- something else -- 1500 in the seed -- are real promises and are left alone.
UPDATE "tutor_profiles" SET "commission_bps" = NULL WHERE "commission_bps" = 2000;--> statement-breakpoint
ALTER TABLE "credit_packs" ADD COLUMN "first_purchase_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_purchases" ADD COLUMN "first_purchase_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" varchar(32);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_adult" boolean;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "guardian_email" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "guardian_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "guardian_linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_guardian_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_purchases_first_only_key" ON "credit_purchases" USING btree ("user_id") WHERE first_purchase_only and status <> 'failed';