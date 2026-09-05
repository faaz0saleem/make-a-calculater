CREATE TYPE "public"."payout_method_kind" AS ENUM('bank', 'mobile_wallet');--> statement-breakpoint
ALTER TABLE "payout_methods" ALTER COLUMN "bank_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_methods" ADD COLUMN "kind" "payout_method_kind" DEFAULT 'bank' NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_methods" ADD COLUMN "wallet_provider" varchar(32);--> statement-breakpoint
ALTER TABLE "payout_methods" ADD COLUMN "branch_code_enc" text;--> statement-breakpoint
CREATE UNIQUE INDEX "payout_methods_default_key" ON "payout_methods" USING btree ("tutor_id") WHERE is_default;--> statement-breakpoint
ALTER TABLE "payout_methods" ADD CONSTRAINT "payout_methods_shape" CHECK ((kind = 'bank' and bank_name is not null and wallet_provider is null)
          or (kind = 'mobile_wallet' and wallet_provider is not null and bank_name is null));