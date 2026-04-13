CREATE TABLE "agent_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" uuid,
	"type" text NOT NULL,
	"key" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_memories_org_type_key_uq" ON "agent_memories" USING btree ("org_id","type","key");--> statement-breakpoint
CREATE INDEX "agent_memories_org_id_idx" ON "agent_memories" USING btree ("org_id");