DROP INDEX "one_trial_per_pair";--> statement-breakpoint
CREATE UNIQUE INDEX "one_trial_per_pair" ON "bookings" USING btree ("student_id","tutor_id") WHERE is_trial = true and status <> 'expired';