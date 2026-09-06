CREATE TABLE "series_topics" (
	"series_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "series_topics_series_id_topic_id_pk" PRIMARY KEY("series_id","topic_id")
);
--> statement-breakpoint
ALTER TABLE "recurring_series" ADD COLUMN "topic_note" text;--> statement-breakpoint
ALTER TABLE "series_topics" ADD CONSTRAINT "series_topics_series_id_recurring_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."recurring_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_topics" ADD CONSTRAINT "series_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "series_topics_topic_idx" ON "series_topics" USING btree ("topic_id");