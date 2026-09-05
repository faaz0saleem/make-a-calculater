ALTER TABLE "videos" ADD COLUMN "source_key" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "preview_url" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;