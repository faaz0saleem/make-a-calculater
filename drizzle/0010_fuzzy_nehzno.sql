DROP INDEX "slot_holds_student_slot";--> statement-breakpoint
ALTER TABLE "slot_holds" ALTER COLUMN "student_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "slot_holds" ADD COLUMN "guest_token" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "slot_holds_guest_slot" ON "slot_holds" USING btree ("guest_token","tutor_id","start_at_utc") WHERE guest_token is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "slot_holds_student_slot" ON "slot_holds" USING btree ("student_id","tutor_id","start_at_utc") WHERE student_id is not null;--> statement-breakpoint
ALTER TABLE "slot_holds" ADD CONSTRAINT "slot_holds_one_holder" CHECK ((student_id is null) <> (guest_token is null));