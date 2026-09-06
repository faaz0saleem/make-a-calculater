ALTER TABLE "email_deliveries" ALTER COLUMN "subject" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_deliveries" ALTER COLUMN "html" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_deliveries" ALTER COLUMN "text" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD COLUMN "payload" jsonb DEFAULT '{}'::jsonb NOT NULL;