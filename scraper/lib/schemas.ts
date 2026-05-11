import { z } from 'zod'

// Suumo listing IDs look like the digits inside nc_<id> in the URL.
// We accept either the digits or the raw URL fallback path that older rows used.
const listingIdSchema = z.string().min(1)

const nonEmptyTrimmed = z.string().trim().min(1)

// What the listing-index parser produces for each row.
// Numeric fields can be null when Suumo's price/size strings don't parse cleanly.
export const ListingSchema = z.object({
  _id: listingIdSchema,
  category: z.string().default(''),
  name: nonEmptyTrimmed,
  address: z.string().default(''),
  station: z.string().default(''),
  description: z.string().default(''),
  image: z.string().default(''),
  url: nonEmptyTrimmed,
  price: z.string().default(''),
  size: z.string().default(''),
  age: z.string().default(''),
  updateDate: z.date(),
  salePriceYen: z.number().int().positive().nullable(),
  rentPriceYen: z.number().int().positive().nullable(),
  sizeM2: z.number().positive().nullable()
})
export type Listing = z.infer<typeof ListingSchema>

// Detail documents are mostly a key/value bag scraped from <table.bdclps> rows
// (Japanese keys like 価格, 専有面積, …) plus a fixed set of metadata fields.
// We validate the metadata fields strictly and let the table-extracted keys pass through.
export const DetailSchema = z.object({
  listingId: listingIdSchema,
  url: nonEmptyTrimmed,
  scrapedAt: z.date(),
  images: z.array(z.string().url()).default([]),
  features: z.array(z.string()).optional(),
  description: z.string().optional(),
  salePriceYen: z.number().int().positive().nullable().optional(),
  rentPriceYen: z.number().int().positive().nullable().optional(),
  sizeM2: z.number().positive().nullable().optional(),
  html: z.string().optional()
}).catchall(z.unknown())
export type Detail = z.infer<typeof DetailSchema>

// Validate without throwing. Returns either the parsed value or a structured error
// payload the caller can persist for later analysis.
export const validate = <T extends z.ZodTypeAny>(
  schema: T,
  value: unknown
): { ok: true, data: z.infer<T> } | { ok: false, issues: z.core.$ZodIssue[] } => {
  const result = schema.safeParse(value)
  if (result.success) return { ok: true, data: result.data }
  return { ok: false, issues: result.error.issues }
}
