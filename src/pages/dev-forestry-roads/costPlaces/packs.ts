/**
 * Cost packs: what PGMaps knows about pricing road work in one country or one province/state. A
 * pack names its currency and taxes, its region scheme (with a boundary file a road's location can
 * be read against), the project-budget items particular to it, and the reference tools it brings
 * (the BC appraisal comparisons). Adding a jurisdiction is adding a pack here, plus its evidence
 * records in the catalogue; nothing in the estimate engine changes.
 *
 * Every country is usable without a pack of its own: it falls back to the country's currency and
 * the generic budget items. Free of DOM and network access.
 */
import type { EvidenceCurrency } from '../costEvidence/costEvidence'
import type { ScheduleTemplateItem } from '../costSchedule'
import { BC_COST_REGIONS, BC_REGION_SOURCE } from '../bcCostReferences'
import { regionLocalId, type CostPlace } from './places'

export interface CountryInfo {
  code: string
  name: string
  currency: EvidenceCurrency
  /** What a province/state is called there, for labels. */
  subdivisionTerm: string
}

/** Countries with evidence in the catalogue, plus their currency. Add a row to add a country. */
export const COUNTRIES: readonly CountryInfo[] = [
  { code: 'CA', name: 'Canada', currency: 'CAD', subdivisionTerm: 'Province or territory' },
  { code: 'US', name: 'United States', currency: 'USD', subdivisionTerm: 'State' },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD', subdivisionTerm: 'Region' },
  { code: 'AU', name: 'Australia', currency: 'AUD', subdivisionTerm: 'State or territory' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', subdivisionTerm: 'Country' },
  { code: 'IE', name: 'Ireland', currency: 'EUR', subdivisionTerm: 'County' },
]

/** ISO 3166-2 names. Only these appear in pickers; a stored code outside the list still reads. */
export const SUBDIVISIONS: Readonly<Record<string, string>> = {
  'CA-AB': 'Alberta',
  'CA-BC': 'British Columbia',
  'CA-MB': 'Manitoba',
  'CA-NB': 'New Brunswick',
  'CA-NL': 'Newfoundland and Labrador',
  'CA-NS': 'Nova Scotia',
  'CA-NT': 'Northwest Territories',
  'CA-NU': 'Nunavut',
  'CA-ON': 'Ontario',
  'CA-PE': 'Prince Edward Island',
  'CA-QC': 'Quebec',
  'CA-SK': 'Saskatchewan',
  'CA-YT': 'Yukon',
  'US-AK': 'Alaska',
  'US-CA': 'California',
  'US-ID': 'Idaho',
  'US-MI': 'Michigan',
  'US-MN': 'Minnesota',
  'US-MT': 'Montana',
  'US-OR': 'Oregon',
  'US-WA': 'Washington',
  'AU-SA': 'South Australia',
  'AU-VIC': 'Victoria',
  'GB-ENG': 'England',
  'GB-SCT': 'Scotland',
  'GB-WLS': 'Wales',
}

export interface CostRegion {
  /** Scheme-qualified: `bc-nr:omineca`. */
  id: string
  name: string
  /** The boundary file's name for it, matched exactly. */
  boundaryName?: string
  /** Where the region sits and what to confirm there; shown behind an (i). */
  geography?: string
  review?: string
}

export interface RegionScheme {
  id: string
  /** "BC natural resource region". */
  name: string
  sourceUrl: string
  /** A polygon file served under `public/data`, resolved with `withBase`. */
  boundary?: { path: string; nameProperty: string }
  regions: readonly CostRegion[]
}

export interface TaxNote {
  label: string
  note: string
}

/** A reference tool a pack brings; the UI maps each id to a component. */
export type PackTool = 'bc-appraisal' | 'bc-fuel'

export interface CostPack {
  /** The subdivision or country code it covers: `CA-BC`. */
  id: string
  country: string
  subdivision?: string
  name: string
  /** Omitted: the country's. */
  currency?: EvidenceCurrency
  taxes: readonly TaxNote[]
  regionScheme?: RegionScheme
  /** Budget items particular to this jurisdiction, added after the generic ones. */
  scheduleItems?: readonly ScheduleTemplateItem[]
  tools?: readonly PackTool[]
  /** When the pack's own text was last checked. */
  reviewed: string
}

const BC_REGIONS: CostRegion[] = BC_COST_REGIONS.map((region) => ({
  id: `bc-nr:${region.id}`,
  name: region.name,
  boundaryName: `${region.name} Natural Resource Region`,
  geography: region.geography,
  review: region.review,
}))

export const BC_PACK: CostPack = {
  id: 'CA-BC',
  country: 'CA',
  subdivision: 'CA-BC',
  name: 'British Columbia',
  taxes: [
    {
      label: 'GST',
      note: '5% federal goods and services tax. Supplier prices and estimates state whether they include it; most exclude it.',
    },
    {
      label: 'PST',
      note: 'BC provincial sales tax applies to some purchased materials and equipment rentals, not to every construction service. Check each quote.',
    },
  ],
  regionScheme: {
    id: 'bc-nr',
    name: 'BC natural resource region',
    sourceUrl: BC_REGION_SOURCE,
    boundary: { path: '/data/boundaries/BCNR/nr_regions.geojson', nameProperty: 'REGION_NAME' },
    regions: BC_REGIONS,
  },
  scheduleItems: [
    {
      id: 'bc-gst',
      group: 'owner',
      label: 'GST (5%)',
      hint: 'Federal tax on the contract price, unless the owner recovers it. Estimates such as the Canim Lake memo exclude it.',
    },
    {
      id: 'bc-pst-materials',
      group: 'owner',
      label: 'PST on taxable materials and rentals',
      hint: 'BC PST on purchased materials and equipment rentals where they are not already in a quoted price.',
    },
    {
      id: 'bc-fppr-assessments',
      group: 'investigation',
      label: 'Terrain stability and riparian assessments (FPPR)',
      hint: 'Qualified registered professional field work a BC forest road needs before construction, where not in the design fee.',
    },
  ],
  tools: ['bc-appraisal', 'bc-fuel'],
  reviewed: '2026-11-14',
}

/** Every pack, most specific first within a country. Add a pack here. */
export const COST_PACKS: readonly CostPack[] = [BC_PACK]

export const countryInfo = (code: string | undefined) => COUNTRIES.find((country) => country.code === code)

export const subdivisionName = (code: string) => SUBDIVISIONS[code] ?? code

export function subdivisionsOf(country: string): { code: string; name: string }[] {
  return Object.entries(SUBDIVISIONS)
    .filter(([code]) => code.startsWith(country + '-'))
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The most specific pack for a place: its province/state's, then its country's. */
export function packFor(place: CostPlace | undefined): CostPack | undefined {
  if (!place) return undefined
  return (
    COST_PACKS.find((pack) => pack.subdivision && pack.subdivision === place.subdivision) ??
    COST_PACKS.find((pack) => !pack.subdivision && pack.country === place.country)
  )
}

/** The region record for a qualified id, from whichever pack defines it. */
export function regionById(id: string | undefined): CostRegion | undefined {
  if (!id) return undefined
  for (const pack of COST_PACKS) {
    const region = pack.regionScheme?.regions.find((item) => item.id === id)
    if (region) return region
  }
  return undefined
}

/** The pack whose region scheme names a qualified region (`bc-nr:…` → BC). */
export const packOfRegion = (id: string) =>
  COST_PACKS.find((pack) => pack.regionScheme && id.startsWith(pack.regionScheme.id + ':'))

/** The currency amounts are entered in for a place: the pack's, else the country's, else CAD. */
export function placeCurrency(place: CostPlace | undefined): EvidenceCurrency {
  return packFor(place)?.currency ?? countryInfo(place?.country)?.currency ?? 'CAD'
}

/** "Omineca, British Columbia, Canada"; a region without a known name prints its id. */
export function placeLabel(place: CostPlace | undefined, { short = false } = {}): string {
  if (!place) return 'No location'
  const parts = [
    place.locality,
    place.region ? (regionById(place.region)?.name ?? regionLocalId(place.region)) : undefined,
    place.subdivision ? subdivisionName(place.subdivision) : undefined,
    short && place.subdivision ? undefined : (countryInfo(place.country)?.name ?? place.country),
  ]
  return parts.filter(Boolean).join(', ')
}

/** The place one level up, for "nothing in the region yet: showing the province". */
export function parentPlace(place: CostPlace): CostPlace | undefined {
  if (place.locality) return { ...place, locality: undefined }
  if (place.region) return { country: place.country, subdivision: place.subdivision }
  if (place.subdivision) return { country: place.country }
  return undefined
}
