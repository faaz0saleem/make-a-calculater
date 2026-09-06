--
-- Split out of 0014 on purpose.
--
-- Postgres refuses to *use* a new enum value in the same transaction that
-- added it (55P04, "unsafe use of new value"). 0014 adds 'scheduled' to
-- booking_status; this rebuilds the partial index that has to mention it,
-- one commit later.
--
DROP INDEX "booking_no_overlap";--> statement-breakpoint
CREATE UNIQUE INDEX "booking_no_overlap" ON "bookings" USING btree ("tutor_id","start_at_utc") WHERE status in ('scheduled', 'pending_tutor', 'confirmed', 'in_progress');
