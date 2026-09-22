import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
// Astro 7 deprecated re-exporting `z` from 'astro:content'.
import { z } from 'astro/zod';

/**
 * Every collection is a folder of markdown files so Decap CMS can edit each one
 * as a form, and so `image()` can resolve covers relative to the entry itself.
 *
 * Content here comes from the company profile PDF. Where the source gives a
 * figure we carry it through verbatim; where it does not, the field is left
 * optional and the components omit it rather than printing a placeholder on a
 * live page. That is what lets the site look finished now and get richer as
 * details are filled in from /admin.
 */

const CATEGORIES = ['road', 'industrial', 'commercial', 'residential', 'institutional'] as const;
const STATUSES = ['completed', 'ongoing', 'upcoming'] as const;
const SECTORS = ['private', 'government'] as const;

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      category: z.enum(CATEGORIES),
      status: z.enum(STATUSES),
      sector: z.enum(SECTORS).default('private'),
      cover: image().optional(),
      summary: z.string().optional(),
      client: z.string().optional(),
      location: z.string().optional(),
      /** As printed in the profile, e.g. "Rs. 48 Cr". */
      value: z.string().optional(),
      /** How long the project took, e.g. "May 2019 – May 2020" or "14 months". */
      duration: z.string().optional(),
      /** Built-up area or extent, e.g. "2.4 lac sq.ft." */
      size: z.string().optional(),
      year: z.string().optional(),
      scope: z.string().optional(),
      gallery: z.array(image()).optional(),
      featured: z.boolean().default(false),
      order: z.number().default(100),
    }),
});

/** The seven divisions the company is organised into. */
const services = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/services' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      summary: z.string(),
      icon: z.enum(['road', 'building', 'factory', 'layers', 'truck', 'hardHat', 'clipboard', 'shieldCheck']),
      image: image().optional(),
      highlights: z.array(z.string()).default([]),
      /** One line for the division's own page header, under the title. */
      lead: z.string().optional(),
      /**
       * What belongs to this division. These let a division page pull the REAL
       * projects, quarries and plant already on the site instead of repeating a
       * summary — which is what makes the page worth opening. All optional: a
       * division that matches nothing simply shows fewer blocks.
       */
      projectCategory: z.enum(CATEGORIES).optional(),
      projectSector: z.enum(SECTORS).optional(),
      facilityKind: z.enum(['quarry', 'rmc', 'asphalt']).optional(),
      equipmentGroup: z.enum(['plant', 'vehicles', 'formwork', 'tools']).optional(),
      order: z.number().default(100),
    }),
});

/** Owned production assets: quarries, RMC plants, asphalt drum mix plants. */
const facilities = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/facilities' }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      kind: z.enum(['quarry', 'rmc', 'asphalt']),
      location: z.string().optional(),
      capacity: z.string().optional(),
      established: z.string().optional(),
      image: image().optional(),
      notes: z.string().optional(),
      order: z.number().default(100),
    }),
});

/** The plant and equipment register, rendered as a table. */
const equipment = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/equipment' }),
  schema: z.object({
    name: z.string(),
    quantity: z.string(),
    group: z.enum(['plant', 'vehicles', 'formwork', 'tools']),
    order: z.number().default(100),
  }),
});

/** Government road contracts, kept separate so the value totals can be shown. */
const government = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/government' }),
  schema: z.object({
    authority: z.string(),
    location: z.string().optional(),
    value: z.string().optional(),
    /** Numeric crore figure, used only to total and to size the bars. */
    valueCr: z.number().optional(),
    scope: z.string().optional(),
    order: z.number().default(100),
  }),
});

/**
 * Which part of the company somebody sits in. This drives the organisation
 * tree, and it is a FUNCTION, not a reporting line: the site says "these people
 * run materials", never "this person reports to that one", because only the
 * owner knows the real reporting lines and inventing them would be fabricating
 * a fact about named employees. Editable per person from /admin.
 */
const DIVISIONS = ['leadership', 'projects', 'materials', 'finance', 'admin'] as const;

const team = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/team' }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      role: z.string(),
      photo: image().optional(),
      division: z.enum(DIVISIONS).default('projects'),
      order: z.number().default(100),
    }),
});

const clients = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/clients' }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      logo: image().optional(),
      sector: z.enum(['corporate', 'government']),
      order: z.number().default(100),
    }),
});

const certifications = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/certifications' }),
  schema: z.object({
    title: z.string(),
    issuer: z.string().optional(),
    reference: z.string().optional(),
    summary: z.string().optional(),
    icon: z.enum(['shieldCheck', 'clipboard', 'hardHat', 'building']).default('shieldCheck'),
    order: z.number().default(100),
  }),
});

const faqs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/faqs' }),
  schema: z.object({
    question: z.string(),
    order: z.number().default(100),
  }),
});

export const collections = {
  projects,
  services,
  facilities,
  equipment,
  government,
  team,
  clients,
  certifications,
  faqs,
};
