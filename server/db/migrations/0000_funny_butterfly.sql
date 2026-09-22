CREATE TYPE "public"."certification_icon" AS ENUM('shieldCheck', 'clipboard', 'hardHat', 'building');--> statement-breakpoint
CREATE TYPE "public"."client_sector" AS ENUM('corporate', 'government');--> statement-breakpoint
CREATE TYPE "public"."enquiry_status" AS ENUM('new', 'read', 'in_progress', 'closed', 'spam');--> statement-breakpoint
CREATE TYPE "public"."equipment_group" AS ENUM('plant', 'vehicles', 'formwork', 'tools');--> statement-breakpoint
CREATE TYPE "public"."facility_kind" AS ENUM('quarry', 'rmc', 'asphalt');--> statement-breakpoint
CREATE TYPE "public"."project_sector" AS ENUM('private', 'government');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('completed', 'ongoing', 'upcoming');--> statement-breakpoint
CREATE TYPE "public"."service_icon" AS ENUM('road', 'building', 'factory', 'layers', 'truck', 'hardHat', 'clipboard', 'shieldCheck');--> statement-breakpoint
CREATE TYPE "public"."team_division" AS ENUM('leadership', 'projects', 'materials', 'finance', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'editor', 'viewer');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(36),
	"action" varchar(60) NOT NULL,
	"entity" varchar(60) NOT NULL,
	"entity_id" varchar(36),
	"meta" jsonb,
	"ip_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"display_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certifications" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(120) NOT NULL,
	"title" varchar(200) NOT NULL,
	"issuer" varchar(200),
	"reference" varchar(120),
	"summary" text,
	"icon" "certification_icon" DEFAULT 'shieldCheck' NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name" varchar(200) NOT NULL,
	"sector" "client_sector" NOT NULL,
	"logo_media_id" varchar(36),
	"is_published" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(40),
	"company" varchar(200),
	"subject" varchar(200),
	"message" text NOT NULL,
	"interest" varchar(120),
	"service_id" varchar(36),
	"project_id" varchar(36),
	"status" "enquiry_status" DEFAULT 'new' NOT NULL,
	"admin_notes" text,
	"handled_by" varchar(36),
	"ip_hash" varchar(64),
	"user_agent" varchar(400),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name" varchar(200) NOT NULL,
	"quantity" varchar(60) NOT NULL,
	"group" "equipment_group" NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name" varchar(200) NOT NULL,
	"kind" "facility_kind" NOT NULL,
	"location" varchar(200),
	"capacity" varchar(120),
	"established" varchar(40),
	"notes" text,
	"image_media_id" varchar(36),
	"is_published" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "faqs" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(160) NOT NULL,
	"question" varchar(400) NOT NULL,
	"answer" text NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "government_works" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(120) NOT NULL,
	"authority" varchar(200) NOT NULL,
	"location" varchar(200),
	"value_text" varchar(60),
	"value_crore" numeric(12, 2),
	"scope" text,
	"is_published" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" varchar(400) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"alt" varchar(300) DEFAULT '' NOT NULL,
	"checksum" varchar(64),
	"uploaded_by" varchar(36),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_media" (
	"project_id" varchar(36) NOT NULL,
	"media_id" varchar(36) NOT NULL,
	"display_order" integer DEFAULT 100 NOT NULL,
	"caption" varchar(300),
	CONSTRAINT "project_media_project_id_media_id_pk" PRIMARY KEY("project_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "project_specs" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar(36) NOT NULL,
	"label" varchar(120) NOT NULL,
	"value" varchar(300) NOT NULL,
	"display_order" integer DEFAULT 100 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(160) NOT NULL,
	"title" varchar(200) NOT NULL,
	"summary" varchar(500),
	"body" text,
	"category_id" varchar(36) NOT NULL,
	"sector" "project_sector" DEFAULT 'private' NOT NULL,
	"status" "project_status" DEFAULT 'completed' NOT NULL,
	"client" varchar(200),
	"location" varchar(200),
	"value_text" varchar(60),
	"value_crore" numeric(12, 2),
	"size_text" varchar(80),
	"duration_text" varchar(120),
	"year" varchar(20),
	"scope" text,
	"completion_date" timestamp with time zone,
	"cover_media_id" varchar(36),
	"featured" boolean DEFAULT false NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 100 NOT NULL,
	"seo_title" varchar(200),
	"seo_description" varchar(320),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" varchar(200) PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(120) NOT NULL,
	"title" varchar(160) NOT NULL,
	"summary" varchar(500) NOT NULL,
	"lead" varchar(400),
	"body" text,
	"icon" "service_icon" NOT NULL,
	"image_media_id" varchar(36),
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"project_category_id" varchar(36),
	"project_sector" "project_sector",
	"facility_kind" "facility_kind",
	"equipment_group" "equipment_group",
	"is_published" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 100 NOT NULL,
	"seo_title" varchar(200),
	"seo_description" varchar(320),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_hash" varchar(64),
	"user_agent" varchar(400),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name" varchar(160) NOT NULL,
	"role" varchar(160) NOT NULL,
	"division" "team_division" DEFAULT 'projects' NOT NULL,
	"photo_media_id" varchar(36),
	"is_published" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(120) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_logo_media_id_media_id_fk" FOREIGN KEY ("logo_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_image_media_id_media_id_fk" FOREIGN KEY ("image_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_media" ADD CONSTRAINT "project_media_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_media" ADD CONSTRAINT "project_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_specs" ADD CONSTRAINT "project_specs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_cover_media_id_media_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_image_media_id_media_id_fk" FOREIGN KEY ("image_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_project_category_id_categories_id_fk" FOREIGN KEY ("project_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_photo_media_id_media_id_fk" FOREIGN KEY ("photo_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_unique" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_order_idx" ON "categories" USING btree ("display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "certifications_slug_unique" ON "certifications" USING btree ("slug") WHERE "certifications"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_slug_unique" ON "clients" USING btree ("slug") WHERE "clients"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "clients_sector_idx" ON "clients" USING btree ("sector","display_order");--> statement-breakpoint
CREATE INDEX "enquiries_status_created_idx" ON "enquiries" USING btree ("status","created_at") WHERE "enquiries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "enquiries_created_idx" ON "enquiries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "enquiries_email_idx" ON "enquiries" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_slug_unique" ON "equipment" USING btree ("slug") WHERE "equipment"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "equipment_group_idx" ON "equipment" USING btree ("group","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "facilities_slug_unique" ON "facilities" USING btree ("slug") WHERE "facilities"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "facilities_kind_idx" ON "facilities" USING btree ("kind","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "faqs_slug_unique" ON "faqs" USING btree ("slug") WHERE "faqs"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "government_works_slug_unique" ON "government_works" USING btree ("slug") WHERE "government_works"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "government_works_order_idx" ON "government_works" USING btree ("display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "media_storage_key_unique" ON "media" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "media_checksum_idx" ON "media" USING btree ("checksum");--> statement-breakpoint
CREATE INDEX "project_media_order_idx" ON "project_media" USING btree ("project_id","display_order");--> statement-breakpoint
CREATE INDEX "project_specs_project_idx" ON "project_specs" USING btree ("project_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_slug_unique" ON "projects" USING btree ("slug") WHERE "projects"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "projects_public_idx" ON "projects" USING btree ("is_published","display_order") WHERE "projects"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "projects_category_idx" ON "projects" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_sector_idx" ON "projects" USING btree ("sector");--> statement-breakpoint
CREATE INDEX "projects_featured_idx" ON "projects" USING btree ("featured") WHERE "projects"."featured" = true;--> statement-breakpoint
CREATE INDEX "rate_limits_expires_idx" ON "rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "services_slug_unique" ON "services" USING btree ("slug") WHERE "services"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "services_order_idx" ON "services" USING btree ("display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_slug_unique" ON "team_members" USING btree ("slug") WHERE "team_members"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "team_members_division_idx" ON "team_members" USING btree ("division","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");