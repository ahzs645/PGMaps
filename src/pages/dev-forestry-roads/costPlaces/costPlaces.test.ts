import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BC_COST_REGIONS } from '../bcCostReferences'
import {
  BC_PACK,
  COST_PACKS,
  packFor,
  parentPlace,
  placeCurrency,
  placeLabel,
  regionById,
  subdivisionsOf,
} from './packs'
import { parseCostPlace, placeProblem, placeRelation, samePlace } from './places'
import { prepareBoundaries, regionAt, suggestPlace } from './locate'
import { parseProjectCostLocation, projectCurrency } from './projectLocation'
import {
  actualPerKm,
  EMPTY_PREFERENCES,
  mergeLibrary,
  parseCostPreferences,
  userRecordFrom,
  userRecordProblems,
  type UserRecordDraft,
} from './costPreferences'
import type { Coordinate } from '../types'

const omineca = { country: 'CA', subdivision: 'CA-BC', region: 'bc-nr:omineca' }

describe('places', () => {
  it('relates a record to the project from the region outwards', () => {
    expect(placeRelation(omineca, omineca)).toBe('same-region')
    expect(placeRelation({ country: 'CA', subdivision: 'CA-BC', region: 'bc-nr:cariboo' }, omineca)).toBe(
      'same-subdivision',
    )
    // A record placed only by province is "same province" even for a project with a region.
    expect(placeRelation({ country: 'CA', subdivision: 'CA-BC' }, omineca)).toBe('same-subdivision')
    expect(placeRelation({ country: 'CA', subdivision: 'CA-AB' }, omineca)).toBe('same-country')
    expect(placeRelation({ country: 'CA' }, omineca)).toBe('same-country')
    expect(placeRelation({ country: 'US', subdivision: 'US-MT' }, omineca)).toBe('elsewhere')
    expect(placeRelation(omineca, undefined)).toBe('unplaced')
  })

  it('checks codes by shape so a pack can be added later, and refuses the inconsistent', () => {
    expect(placeProblem(omineca)).toBeNull()
    expect(placeProblem({ country: 'CA', subdivision: 'CA-YT' })).toBeNull()
    expect(placeProblem({ country: 'ca' })).toMatch(/two-letter/)
    expect(placeProblem({ country: 'CA', subdivision: 'US-MT' })).toMatch(/not inside CA/)
    expect(placeProblem({ country: 'CA', region: 'bc-nr:omineca' })).toMatch(/needs its province/)
    expect(placeProblem({ country: 'CA', subdivision: 'CA-BC', region: 'Omineca' })).toMatch(/scheme:id/)
    expect(parseCostPlace({ country: 'NZ' }, 'Place')).toEqual({ country: 'NZ' })
    expect(() => parseCostPlace({ country: 'CA', subdivision: 'XX' }, 'Place')).toThrow(/ISO 3166-2/)
    expect(samePlace(omineca, { ...omineca })).toBe(true)
    expect(samePlace(omineca, { ...omineca, locality: 'Prince George' })).toBe(false)
  })
})

describe('cost packs', () => {
  it('carries every BC region under one qualified scheme with its boundary name', () => {
    expect(COST_PACKS).toContain(BC_PACK)
    const regions = BC_PACK.regionScheme!.regions
    expect(regions.map((region) => region.id)).toEqual(BC_COST_REGIONS.map((region) => `bc-nr:${region.id}`))
    expect(regionById('bc-nr:omineca')).toMatchObject({
      name: 'Omineca',
      boundaryName: 'Omineca Natural Resource Region',
    })
    expect(regionById('ab-fma:x')).toBeUndefined()
  })

  it('falls back to the country for a place without a pack, and labels any place', () => {
    expect(packFor(omineca)).toBe(BC_PACK)
    expect(packFor({ country: 'CA', subdivision: 'CA-YT' })).toBeUndefined()
    expect(placeCurrency({ country: 'CA', subdivision: 'CA-YT' })).toBe('CAD')
    expect(placeCurrency({ country: 'US', subdivision: 'US-MT' })).toBe('USD')
    expect(placeCurrency({ country: 'NZ' })).toBe('NZD')
    expect(placeCurrency(undefined)).toBe('CAD')
    expect(placeLabel({ ...omineca, locality: 'Prince George' })).toBe(
      'Prince George, Omineca, British Columbia, Canada',
    )
    expect(placeLabel({ country: 'CA', subdivision: 'CA-YT' })).toBe('Yukon, Canada')
    expect(placeLabel({ country: 'US', subdivision: 'US-MT' }, { short: true })).toBe('Montana')
    expect(parentPlace(omineca)).toEqual({ country: 'CA', subdivision: 'CA-BC' })
    expect(subdivisionsOf('CA')).toHaveLength(13)
  })

  it('adds its own budget items and tools', () => {
    expect(BC_PACK.scheduleItems!.map((item) => item.id)).toEqual(['bc-gst', 'bc-pst-materials', 'bc-fppr-assessments'])
    expect(BC_PACK.tools).toEqual(['bc-appraisal', 'bc-fuel'])
  })
})

describe('reading a location from the road', () => {
  // Two square regions side by side, the second with a hole.
  const square = (x0: number, y0: number, size: number): Coordinate[] => [
    [x0, y0],
    [x0 + size, y0],
    [x0 + size, y0 + size],
    [x0, y0 + size],
    [x0, y0],
  ]
  const features = [
    {
      properties: { REGION_NAME: 'Omineca Natural Resource Region' },
      geometry: { type: 'Polygon', coordinates: [square(-124, 53, 2)] },
    },
    {
      properties: { REGION_NAME: 'Cariboo Natural Resource Region' },
      geometry: { type: 'MultiPolygon', coordinates: [[square(-122, 53, 2), square(-121.5, 53.5, 0.5)]] },
    },
    { properties: { REGION_NAME: 'Somewhere else' }, geometry: { type: 'Polygon', coordinates: [square(0, 0, 1)] } },
  ]
  const boundaries = prepareBoundaries(BC_PACK, features)

  it('matches boundary features to pack regions by name and drops the rest', () => {
    expect(boundaries.map((b) => b.region.id)).toEqual(['bc-nr:omineca', 'bc-nr:cariboo'])
    expect(regionAt([-123, 54], boundaries)?.id).toBe('bc-nr:omineca')
    expect(regionAt([-121.8, 53.2], boundaries)?.id).toBe('bc-nr:cariboo')
    // Inside the hole, and outside everything.
    expect(regionAt([-121.25, 53.75], boundaries)).toBeNull()
    expect(regionAt([10, 10], boundaries)).toBeNull()
  })

  it('suggests the region holding most of the road, and says how much', () => {
    const road: Coordinate[] = [
      [-122.5, 54],
      [-122.2, 54],
      [-121.9, 54],
      [-121.6, 54],
    ]
    const suggestion = suggestPlace(BC_PACK, road, boundaries)!
    expect(suggestion.place).toEqual({ country: 'CA', subdivision: 'CA-BC', region: 'bc-nr:omineca' })
    expect(suggestion.share).toBe(0.5)
    expect(suggestion.basis).toBe('2 of 4 road points are in Omineca.')
    expect(suggestPlace(BC_PACK, [[10, 10]], boundaries)).toBeNull()
    expect(suggestPlace(BC_PACK, [], boundaries)).toBeNull()
  })

  it('reads the real BC region boundaries when they are synced', () => {
    let raw: string
    try {
      raw = readFileSync(join(process.cwd(), 'public/data/boundaries/BCNR/nr_regions.geojson'), 'utf8')
    } catch {
      return // The boundary file is synced from bcdatamapper and absent in a bare checkout.
    }
    const real = prepareBoundaries(BC_PACK, JSON.parse(raw).features)
    expect(real.map((b) => b.region.id).sort()).toEqual(BC_PACK.regionScheme!.regions.map((r) => r.id).sort())
    // Prince George, Williams Lake, Terrace, Fort St. John.
    expect(regionAt([-122.75, 53.92], real)?.id).toBe('bc-nr:omineca')
    expect(regionAt([-122.14, 52.13], real)?.id).toBe('bc-nr:cariboo')
    expect(regionAt([-128.6, 54.52], real)?.id).toBe('bc-nr:skeena')
    expect(regionAt([-120.85, 56.25], real)?.id).toBe('bc-nr:northeast')
  })
})

describe('the project cost location', () => {
  it('is read from the file with its basis and date, and sets the currency', () => {
    const location = parseProjectCostLocation({ place: omineca, basis: 'road-location', setOn: '2026-11-14' })!
    expect(location.place).toEqual(omineca)
    expect(projectCurrency(location)).toBe('CAD')
    expect(projectCurrency({ ...location, place: { country: 'US', subdivision: 'US-MT' } })).toBe('USD')
    expect(projectCurrency(undefined)).toBe('CAD')
    expect(parseProjectCostLocation(undefined)).toBeUndefined()
    expect(() => parseProjectCostLocation({ place: omineca, basis: 'guessed', setOn: '2026-11-14' })).toThrow(/basis/)
    expect(() => parseProjectCostLocation({ place: omineca, basis: 'chosen', setOn: 'today' })).toThrow(/YYYY-MM-DD/)
  })
})

describe('the person’s own records and preferences', () => {
  const draft: UserRecordDraft = {
    title: 'Pit run, delivered',
    kind: 'completed-project',
    party: 'Smith Gravel',
    place: omineca,
    placeName: 'Km 12, Bobtail FSR',
    currency: 'CAD',
    amount: 186000,
    unit: '',
    date: '2025-09-30',
    scope: 'Subgrade, ditching and 300 mm pit run over 1.2 km',
    tax: 'Excludes GST',
    loading: '',
    delivery: '',
    installation: '',
    notes: 'Wet fall; two days of standby',
    url: '',
    actual: { lengthKm: 1.2, subgrade: 120000, stabilization: 66000 },
  }

  it('turns a complete draft into a catalogue-shaped record with a place', () => {
    expect(userRecordProblems(draft)).toEqual([])
    expect(userRecordProblems({ ...draft, title: '', amount: null, date: 'Sept' })).toEqual([
      'Name the work or product.',
      'Enter the amount.',
      'Give the price date as YYYY or YYYY-MM-DD.',
    ])
    const record = userRecordFrom(draft, 'user-1', '2026-11-14')
    expect(record).toMatchObject({
      id: 'user-1',
      origin: 'user',
      kind: 'completed-project',
      group: 'Smith Gravel',
      country: 'CA',
      subdivision: 'CA-BC',
      regionId: 'omineca',
      amounts: { value: 186000 },
      costYear: 2025,
      effectiveDate: '2025-09-30',
      cautions: ['Wet fall; two days of standby'],
      url: '',
    })
    expect(record.unit).toBeUndefined()
    expect(actualPerKm(record)).toBe(155000)
  })

  it('round-trips through storage and an exported file, and merges an import by id', () => {
    const record = userRecordFrom(draft, 'user-1', '2026-11-14')
    const preferences = {
      version: 1 as const,
      homePlace: omineca,
      preferredKinds: ['estimate' as const],
      library: [record],
    }
    expect(parseCostPreferences(JSON.parse(JSON.stringify(preferences)))).toEqual(preferences)
    expect(() => parseCostPreferences({ version: 2 })).toThrow(/another version/)
    expect(() => parseCostPreferences({ version: 1, library: [{ ...record, kind: 'funding' }] })).toThrow(/kind/)
    const updated = { ...record, amounts: { value: 190000 } }
    const merged = mergeLibrary(EMPTY_PREFERENCES, { ...preferences, library: [record] })
    expect(merged.homePlace).toEqual(omineca)
    expect(mergeLibrary(merged, { ...EMPTY_PREFERENCES, library: [updated] }).library).toEqual([updated])
  })
})
