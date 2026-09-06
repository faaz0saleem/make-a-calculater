CREATE TABLE "tutor_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(120),
	"token_hash" varchar(64) NOT NULL,
	"invited_by" uuid NOT NULL,
	"note" text,
	"pre_verified" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tutor_invites" ADD CONSTRAINT "tutor_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_invites" ADD CONSTRAINT "tutor_invites_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tutor_invites_token_key" ON "tutor_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "tutor_invites_email_idx" ON "tutor_invites" USING btree ("email");