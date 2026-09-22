/**
 * The database schema.
 *
 * Normalised deliberately. The content this replaces lived as markdown with
 * Zod-checked frontmatter, so the constraints below are not new rules invented
 * here — they are the same rules, moved somewhere the database can enforce them
 * on every writer rather than only on the build.
 *
 * Conventions, applied everywhere so no table is a special case:
 *   - UUID primary keys via `gen_random_uuid()` (core Postgres since 13), so ids
 *     can be minted client-side during import and never collide across batches.
 *   - `timestamptz` for every instant. A construction firm working across
 *     Gujarat, Daman and Silvassa has one timezone today, but storing local time
 *     is the kind of decision that is free to get right now and expensive later.
 *   - `deleted_at` where content must be recoverable. An owner who deletes a
 *     project by mistake should not need a database backup to undo it.
 *   - `display_order` mirrors the markdown `order` field the site already sorts
 *     by, so the existing ordering survives the migration exactly.
 *
 * A note on what is NOT a table: `sector` (2 values) and `status` (3 values) are
 * Postgres enums. They are closed sets the frontend switches on, and a join to
 * recover a two-row lookup table would cost more than it explains. `category`
 * IS a table, because the owner must be able to add one from the dashboard.
 */
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums — each mirrors a union already enforced in src/content.config.ts
// ---------------------------------------------------------------------------

export const userRole = pgEnum('user_role', ['admin', 'editor', 'viewer']);
export const projectStatus = pgEnum('project_status', ['completed', 'ongoing', 'upcoming']);
export const projectSector = pgEnum('project_sector', ['private', 'government']);
export const facilityKind = pgEnum('facility_kind', ['quarry', 'rmc', 'asphalt']);
export const equipmentGroup = pgEnum('equipment_group', ['plant', 'vehicles', 'formwork', 'tools']);
export const teamDivision = pgEnum('team_division', [
  'leadership',
  'projects',
  'materials',
  'finance',
  'admin',
]);
export const clientSector = pgEnum('client_sector', ['corporate', 'government']);
export const serviceIcon = pgEnum('service_icon', [
  'road',
  'building',
  'factory',
  'layers',
  'truck',
  'hardHat',
  'clipboard',
  'shieldCheck',
]);
export const certificationIcon = pgEnum('certification_icon', [
  'shieldCheck',
  'clipboard',
  'hardHat',
  'building',
]);
export const enquiryStatus = pgEnum('enquiry_status', [
  'new',
  'read',
  'in_progress',
  'closed',
  'spam',
]);

// Shared column builders. Repeating these by hand is how tables drift apart.
const id = () => varchar('id', { length: 36 }).primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const deletedAt = () => timestamp('deleted_at', { withTimezone: true });
const displayOrder = () => integer('display_order').notNull().default(100);

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Staff accounts for the dashboard.
 *
 * `passwordHash` holds a scrypt digest with its parameters and salt encoded in
 * the string (see server/auth/password.ts). Storing the parameters alongside
 * the digest is what allows the cost to be raised later without invalidating
 * every existing password.
 *
 * `failedAttempts` / `lockedUntil` implement lockout in the database on purpose:
 * serverless invocations share no memory, so an in-process counter would reset
 * on every cold start and protect nothing.
 */
export const users = pgTable(
  'users',
  {
    id: id(),
    email: varchar('email', { length: 255 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull().default('viewer'),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    // Case-insensitive uniqueness: addresses are stored lowercased on write, and
    // this guarantees it even if a writer forgets.
    uniqueIndex('users_email_unique').on(sql`lower(${t.email})`),
    index('users_role_idx').on(t.role),
  ],
);

/**
 * Server-side sessions.
 *
 * Chosen over stateless JWTs because this application needs revocation: an
 * owner who suspects a laptop is compromised must be able to end every session
 * immediately, which a self-contained token cannot offer without building the
 * very denylist that makes it stateful anyway.
 *
 * The cookie carries only the id; `tokenHash` is a digest of the secret half,
 * so a leaked database backup does not hand over live sessions.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipHash: varchar('ip_hash', { length: 64 }),
    userAgent: varchar('user_agent', { length: 400 }),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    // The sweep that deletes expired sessions runs on this.
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/**
 * One uploaded file.
 *
 * Binary content is NOT here — `storageKey` points into whichever storage
 * driver is configured (see server/storage). Postgres is a poor blob store and
 * the free tier is metered on exactly the bytes a photograph would consume.
 *
 * `width`/`height` are recorded at upload time so the frontend can reserve the
 * correct box before the image loads. That is what keeps layout shift at zero,
 * and it is also how the site guarantees an image is never stretched: the real
 * aspect ratio is known, so it can always be honoured.
 */
export const media = pgTable(
  'media',
  {
    id: id(),
    storageKey: varchar('storage_key', { length: 400 }).notNull(),
    filename: varchar('filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    byteSize: integer('byte_size').notNull(),
    width: integer('width'),
    height: integer('height'),
    /** Empty string is a deliberate, valid value: it marks an image decorative. */
    alt: varchar('alt', { length: 300 }).notNull().default(''),
    checksum: varchar('checksum', { length: 64 }),
    uploadedBy: varchar('uploaded_by', { length: 36 }).references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('media_storage_key_unique').on(t.storageKey),
    // Re-uploading a byte-identical file should reuse the existing row.
    index('media_checksum_idx').on(t.checksum),
  ],
);

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export const categories = pgTable(
  'categories',
  {
    id: id(),
    slug: varchar('slug', { length: 120 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    displayOrder: displayOrder(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('categories_slug_unique').on(t.slug), index('categories_order_idx').on(t.displayOrder)],
);

/**
 * A project.
 *
 * Money is stored twice on purpose. `valueText` is what the company profile
 * actually printed ("₹50 Cr+", "Rs. 48 Cr") and is what the site displays,
 * because rewriting a client-facing figure into a number would change a
 * published claim. `valueCrore` is the numeric reading of it where one exists,
 * used only for sorting and totals. Neither is derived from the other at read
 * time, so an unparseable figure stays displayable.
 */
export const projects = pgTable(
  'projects',
  {
    id: id(),
    slug: varchar('slug', { length: 160 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    summary: varchar('summary', { length: 500 }),
    /** Long-form markdown, as the body of the original entry. */
    body: text('body'),

    categoryId: varchar('category_id', { length: 36 })
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    sector: projectSector('sector').notNull().default('private'),
    status: projectStatus('status').notNull().default('completed'),

    client: varchar('client', { length: 200 }),
    location: varchar('location', { length: 200 }),
    valueText: varchar('value_text', { length: 60 }),
    valueCrore: numeric('value_crore', { precision: 12, scale: 2 }),
    sizeText: varchar('size_text', { length: 80 }),
    durationText: varchar('duration_text', { length: 120 }),
    year: varchar('year', { length: 20 }),
    scope: text('scope'),
    completionDate: timestamp('completion_date', { withTimezone: true }),

    coverMediaId: varchar('cover_media_id', { length: 36 }).references(() => media.id, {
      onDelete: 'set null',
    }),

    featured: boolean('featured').notNull().default(false),
    /** Unpublished rows are invisible to every public endpoint and to the build. */
    isPublished: boolean('is_published').notNull().default(true),
    displayOrder: displayOrder(),

    seoTitle: varchar('seo_title', { length: 200 }),
    seoDescription: varchar('seo_description', { length: 320 }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    // Partial: a soft-deleted project releases its slug, so the owner can
    // recreate a project under the same URL without first purging the old row.
    uniqueIndex('projects_slug_unique')
      .on(t.slug)
      .where(sql`${t.deletedAt} is null`),
    // The public list query: published, not deleted, ordered.
    index('projects_public_idx')
      .on(t.isPublished, t.displayOrder)
      .where(sql`${t.deletedAt} is null`),
    index('projects_category_idx').on(t.categoryId),
    index('projects_status_idx').on(t.status),
    index('projects_sector_idx').on(t.sector),
    index('projects_featured_idx').on(t.featured).where(sql`${t.featured} = true`),
  ],
);

/**
 * Gallery membership. A join table rather than an array column because the
 * ORDER of the photographs is content the owner controls, and because the same
 * image can legitimately appear in more than one project.
 */
export const projectMedia = pgTable(
  'project_media',
  {
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    mediaId: varchar('media_id', { length: 36 })
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    displayOrder: displayOrder(),
    caption: varchar('caption', { length: 300 }),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.mediaId] }),
    index('project_media_order_idx').on(t.projectId, t.displayOrder),
  ],
);

/** Free-form spec rows ("Built-up area", "2.5 lac sq.ft."), ordered by the owner. */
export const projectSpecs = pgTable(
  'project_specs',
  {
    id: id(),
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 120 }).notNull(),
    value: varchar('value', { length: 300 }).notNull(),
    displayOrder: displayOrder(),
  },
  (t) => [index('project_specs_project_idx').on(t.projectId, t.displayOrder)],
);

/** The seven divisions. `projectCategoryId` etc. drive each division page's pulls. */
export const services = pgTable(
  'services',
  {
    id: id(),
    slug: varchar('slug', { length: 120 }).notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    summary: varchar('summary', { length: 500 }).notNull(),
    lead: varchar('lead', { length: 400 }),
    body: text('body'),
    icon: serviceIcon('icon').notNull(),
    imageMediaId: varchar('image_media_id', { length: 36 }).references(() => media.id, {
      onDelete: 'set null',
    }),
    highlights: jsonb('highlights').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    projectCategoryId: varchar('project_category_id', { length: 36 }).references(() => categories.id, {
      onDelete: 'set null',
    }),
    projectSector: projectSector('project_sector'),
    facilityKind: facilityKind('facility_kind'),
    equipmentGroup: equipmentGroup('equipment_group'),
    isPublished: boolean('is_published').notNull().default(true),
    displayOrder: displayOrder(),
    seoTitle: varchar('seo_title', { length: 200 }),
    seoDescription: varchar('seo_description', { length: 320 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('services_slug_unique')
      .on(t.slug)
      .where(sql`${t.deletedAt} is null`),
    index('services_order_idx').on(t.displayOrder),
  ],
);

export const facilities = pgTable(
  'facilities',
  {
    id: id(),
    slug: varchar('slug', { length: 120 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    kind: facilityKind('kind').notNull(),
    location: varchar('location', { length: 200 }),
    capacity: varchar('capacity', { length: 120 }),
    established: varchar('established', { length: 40 }),
    notes: text('notes'),
    imageMediaId: varchar('image_media_id', { length: 36 }).references(() => media.id, {
      onDelete: 'set null',
    }),
    isPublished: boolean('is_published').notNull().default(true),
    displayOrder: displayOrder(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('facilities_slug_unique')
      .on(t.slug)
      .where(sql`${t.deletedAt} is null`),
    index('facilities_kind_idx').on(t.kind, t.displayOrder),
  ],
);

export const equipment = pgTable(
  'equipment',
  {
    id: id(),
    slug: varchar('slug', { length: 120 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    /** Kept as text: the register prints values like "12 Nos." and "2 sets". */
    quantity: varchar('quantity', { length: 60 }).notNull(),
    group: equipmentGroup('group').notNull(),
    isPublished: boolean('is_published').notNull().default(true),
    displayOrder: displayOrder(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('equipment_slug_unique')
      .on(t.slug)
      .where(sql`${t.deletedAt} is null`),
    index('equipment_group_idx').on(t.group, t.displayOrder),
  ],
);

export const governmentWorks = pgTable(
  'government_works',
  {
    id: id(),
    slug: varchar('slug', { length: 120 }).notNull(),
    authority: varchar('authority', { length: 200 }).notNull(),
    location: varchar('location', { length: 200 }),
    valueText: varchar('value_text', { length: 60 }),
    valueCrore: numeric('value_crore', { precision: 12, scale: 2 }),
    scope: text('scope'),
    isPublished: boolean('is_published').notNull().default(true),
    displayOrder: displayOrder(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('government_works_slug_unique')
      .on(t.slug)
      .where(sql`${t.deletedAt} is null`),
    index('government_works_order_idx').on(t.displayOrder),
  ],
);

export const teamMembers = pgTable(
  'team_members',
  {
    id: id(),
    slug: varchar('slug', { length: 120 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    role: varchar('role', { length: 160 }).notNull(),
    division: teamDivision('division').notNull().default('projects'),
    photoMediaId: varchar('photo_media_id', { length: 36 }).references(() => media.id, {
      onDelete: 'set null',
    }),
    isPublished: boolean('is_published').notNull().default(true),
    displayOrder: displayOrder(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('team_members_slug_unique')
      .on(t.slug)
      .where(sql`${t.deletedAt} is null`),
    index('team_members_division_idx').on(t.division, t.displayOrder),
  ],
);

export const clients = pgTable(
  'clients',
  {
    id: id(),
    slug: varchar('slug', { length: 120 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    sector: clientSector('sector').notNull(),
    logoMediaId: varchar('logo_media_id', { length: 36 }).references(() => media.id, {
      onDelete: 'set null',
    }),
    isPublished: boolean('is_published').notNull().default(true),
    displayOrder: displayOrder(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('clients_slug_unique')
      .on(t.slug)
      .where(sql`${t.deletedAt} is null`),
    index('clients_sector_idx').on(t.sector, t.displayOrder),
  ],
);

export const certifications = pgTable(
  'certifications',
  {
    id: id(),
    slug: varchar('slug', { length: 120 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    issuer: varchar('issuer', { length: 200 }),
    reference: varchar('reference', { length: 120 }),
    summary: text('summary'),
    icon: certificationIcon('icon').notNull().default('shieldCheck'),
    isPublished: boolean('is_published').notNull().default(true),
    displayOrder: displayOrder(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('certifications_slug_unique')
      .on(t.slug)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const faqs = pgTable(
  'faqs',
  {
    id: id(),
    slug: varchar('slug', { length: 160 }).notNull(),
    question: varchar('question', { length: 400 }).notNull(),
    answer: text('answer').notNull(),
    isPublished: boolean('is_published').notNull().default(true),
    displayOrder: displayOrder(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('faqs_slug_unique')
      .on(t.slug)
      .where(sql`${t.deletedAt} is null`),
  ],
);

// ---------------------------------------------------------------------------
// Enquiries
// ---------------------------------------------------------------------------

/**
 * A submitted enquiry.
 *
 * The caller's IP is stored ONLY as a salted hash. Rate limiting and abuse
 * investigation both work fine against a hash, and an enquiry table that is
 * one query away from a list of visitor IP addresses is a liability that buys
 * nothing. `userAgent` is truncated for the same reason.
 */
export const enquiries = pgTable(
  'enquiries',
  {
    id: id(),
    name: varchar('name', { length: 160 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 40 }),
    company: varchar('company', { length: 200 }),
    subject: varchar('subject', { length: 200 }),
    message: text('message').notNull(),
    /** Free text from the form's interest field, or a service slug. */
    interest: varchar('interest', { length: 120 }),
    serviceId: varchar('service_id', { length: 36 }).references(() => services.id, {
      onDelete: 'set null',
    }),
    projectId: varchar('project_id', { length: 36 }).references(() => projects.id, {
      onDelete: 'set null',
    }),
    status: enquiryStatus('status').notNull().default('new'),
    adminNotes: text('admin_notes'),
    handledBy: varchar('handled_by', { length: 36 }).references(() => users.id, {
      onDelete: 'set null',
    }),
    ipHash: varchar('ip_hash', { length: 64 }),
    userAgent: varchar('user_agent', { length: 400 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    // The dashboard's default view: open enquiries, newest first.
    index('enquiries_status_created_idx')
      .on(t.status, t.createdAt)
      .where(sql`${t.deletedAt} is null`),
    index('enquiries_created_idx').on(t.createdAt),
    index('enquiries_email_idx').on(t.email),
  ],
);

// ---------------------------------------------------------------------------
// Operational
// ---------------------------------------------------------------------------

/**
 * Rate limiting counters.
 *
 * In the database because serverless functions share no memory: an in-process
 * counter resets on every cold start, which means it would let an attacker
 * through simply by arriving slowly enough to get fresh containers.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    /** "<bucket>:<subject hash>", e.g. "enquiry:9f86d081…". */
    key: varchar('key', { length: 200 }).primaryKey(),
    count: integer('count').notNull().default(0),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('rate_limits_expires_idx').on(t.expiresAt)],
);

/**
 * What changed, who changed it, and when.
 *
 * Git gave the previous CMS this for free; moving content into a database is
 * exactly what takes it away, so it has to be rebuilt deliberately. Without it
 * there is no answer to "who unpublished that project".
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    userId: varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 60 }).notNull(),
    entity: varchar('entity', { length: 60 }).notNull(),
    entityId: varchar('entity_id', { length: 36 }),
    /** Redacted before it is written — see server/logging/logger.ts. */
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    ipHash: varchar('ip_hash', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entity, t.entityId),
    index('audit_log_created_idx').on(t.createdAt),
    index('audit_log_user_idx').on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Relations — these are what let the repositories load a project and its
// gallery in ONE query instead of one per image.
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  auditEntries: many(auditLog),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  category: one(categories, { fields: [projects.categoryId], references: [categories.id] }),
  cover: one(media, { fields: [projects.coverMediaId], references: [media.id] }),
  gallery: many(projectMedia),
  specs: many(projectSpecs),
}));

export const projectMediaRelations = relations(projectMedia, ({ one }) => ({
  project: one(projects, { fields: [projectMedia.projectId], references: [projects.id] }),
  media: one(media, { fields: [projectMedia.mediaId], references: [media.id] }),
}));

export const projectSpecsRelations = relations(projectSpecs, ({ one }) => ({
  project: one(projects, { fields: [projectSpecs.projectId], references: [projects.id] }),
}));

export const servicesRelations = relations(services, ({ one }) => ({
  image: one(media, { fields: [services.imageMediaId], references: [media.id] }),
  projectCategory: one(categories, {
    fields: [services.projectCategoryId],
    references: [categories.id],
  }),
}));

export const facilitiesRelations = relations(facilities, ({ one }) => ({
  image: one(media, { fields: [facilities.imageMediaId], references: [media.id] }),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  photo: one(media, { fields: [teamMembers.photoMediaId], references: [media.id] }),
}));

export const clientsRelations = relations(clients, ({ one }) => ({
  logo: one(media, { fields: [clients.logoMediaId], references: [media.id] }),
}));

export const enquiriesRelations = relations(enquiries, ({ one }) => ({
  service: one(services, { fields: [enquiries.serviceId], references: [services.id] }),
  project: one(projects, { fields: [enquiries.projectId], references: [projects.id] }),
  handler: one(users, { fields: [enquiries.handledBy], references: [users.id] }),
}));

/** Every table, for the Drizzle client and for the test truncation helper. */
export const schema = {
  users,
  sessions,
  media,
  categories,
  projects,
  projectMedia,
  projectSpecs,
  services,
  facilities,
  equipment,
  governmentWorks,
  teamMembers,
  clients,
  certifications,
  faqs,
  enquiries,
  rateLimits,
  auditLog,
  usersRelations,
  sessionsRelations,
  categoriesRelations,
  projectsRelations,
  projectMediaRelations,
  projectSpecsRelations,
  servicesRelations,
  facilitiesRelations,
  teamMembersRelations,
  clientsRelations,
  enquiriesRelations,
};
