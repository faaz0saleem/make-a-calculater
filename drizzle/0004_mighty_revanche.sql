-- Nothing wrote `session_events` before this phase, so in practice the table is
-- empty. Backfilling anyway: a migration that only works on an empty table is a
-- migration that fails the one time it matters.
ALTER TABLE "session_events" ADD COLUMN "external_id" varchar(200);--> statement-breakpoint
UPDATE "session_events" SET "external_id" = 'legacy:' || "id"::text WHERE "external_id" IS NULL;--> statement-breakpoint
ALTER TABLE "session_events" ALTER COLUMN "external_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "session_events_external_id" ON "session_events" USING btree ("external_id");
