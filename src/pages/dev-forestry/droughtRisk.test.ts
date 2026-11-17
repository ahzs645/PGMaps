import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePublishedCsv } from '@/features/forest-drought/published'
import {
  becQueryUrl,
  droughtReading,
  droughtRiskLink,
  fordratSpecies,
  landformSamples,
  landformStand,
  parseBecPolygons,
  wfsExceptionReason,
} from './droughtRisk'

const dataset = parsePublishedCsv(
  readFileSync(new URL('../../../public/data/forest-drought/fordrat.csv', import.meta.url), 'utf8'),
)
const box = (a: number, b: number, c: number, d: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [a, b],
      [c, b],
      [c, d],
      [a, d],
      [a, b],
    ],
  ],
})

describe('drought risk to the landform’s standing timber', () => {
  it('asks the BEC map for the landform’s box longitude first, in the CQL filter', () => {
    const url = new URL(becQueryUrl([-122.8, 53.8, -122.6, 53.95]))
    expect(url.searchParams.get('CQL_FILTER')).toBe("BBOX(GEOMETRY,-122.8,53.8,-122.6,53.95,'EPSG:4326')")
    expect(url.searchParams.get('bbox')).toBeNull()
    expect(url.searchParams.get('propertyName')).toContain('GEOMETRY')
  })

  it('rates only the inventory codes that are the table’s species', () => {
    expect(fordratSpecies('PLI')).toBe('Pl')
    expect(fordratSpecies('sw')).toBe('Sx')
    expect(fordratSpecies('FDI')).toBe('Fd')
    // Coastal Douglas-fir, black spruce and balsam poplar are other species than the table's.
    expect(fordratSpecies('FDC')).toBeNull()
    expect(fordratSpecies('SB')).toBeNull()
    expect(fordratSpecies('ACB')).toBeNull()
  })

  it('weights species by inventory percentage over the treed ground the landform covers', () => {
    const landform = box(0, 0, 0.02, 0.01)
    const stands = [
      // West half: pine–spruce stand.
      {
        treed: true,
        speciesCode: 'PLI',
        speciesComposition: [
          { code: 'PLI', percent: 70, heightMeters: 20 },
          { code: 'SX', percent: 30, heightMeters: 22 },
        ],
        geometry: box(0, 0, 0.01, 0.01),
      },
      // East half: not treed (a lake), so it adds no species.
      { treed: false, speciesCode: null, geometry: box(0.01, 0, 0.02, 0.01) },
    ]
    const bec = parseBecPolygons({
      features: [
        { geometry: box(-1, -1, 0.015, 1), properties: { MAP_LABEL: 'IDFdk3' } },
        { geometry: box(0.015, -1, 1, 1), properties: { MAP_LABEL: 'SBSmk1' } },
        { geometry: null, properties: { MAP_LABEL: 'ignored' } },
      ],
    })
    const stand = landformStand(landform, stands, bec)
    expect(stand.samples).toBeGreaterThan(300)
    expect(stand.treedShare).toBeCloseTo(0.5, 1)
    expect(stand.becUnits[0]).toMatchObject({ label: 'IDFdk3' })
    expect(stand.becUnits[0].share).toBeCloseTo(0.75, 1)
    expect(stand.species.map((s) => [s.vriCode, s.fordrat])).toEqual([
      ['PLI', 'Pl'],
      ['SX', 'Sx'],
    ])
    expect(stand.species[0].share).toBeCloseTo(0.7, 5)
  })

  it('reads the published ratings for the unit, regime and period beside 1981–2010', () => {
    const species = [
      { vriCode: 'PLI', fordrat: 'Pl' as const, share: 0.6 },
      { vriCode: 'SX', fordrat: 'Sx' as const, share: 0.25 },
      { vriCode: 'SW', fordrat: 'Sx' as const, share: 0.05 },
      { vriCode: 'SB', fordrat: null, share: 0.1 },
    ]
    // IDFdk3,1981-2010,submesic: Pl L, Sx H; IDFdk3,2080,submesic: Pl H, Sx VH (rows 3854 and 3869 of the CSV).
    const reading = droughtReading(dataset, 'IDFdk3', 3, '2080', species)!
    expect(reading.baselineAetPet).toBeCloseTo(0.849062045, 9)
    expect(reading.projectedAetPet).toBeCloseTo(0.749066955, 9)
    expect(reading.rows).toEqual([
      { code: 'Pl', vriCodes: ['PLI'], share: 0.6, baseline: 'L', projected: 'H' },
      { code: 'Sx', vriCodes: ['SX', 'SW'], share: 0.3, baseline: 'H', projected: 'VH' },
    ])
    expect(reading.unrated).toEqual([species[3]])
    // A unit the BEC v11 table does not hold has no reading rather than a neighbour's.
    expect(droughtReading(dataset, 'SBSmk9', 3, '2080', species)).toBeNull()
  })

  it('links to the drought page without a soil regime until one is chosen', () => {
    expect(droughtRiskLink('SBSmk1', '', '2050')).toBe('/dev/forestry/drought-risk?bgc=SBSmk1&period=2050')
    expect(droughtRiskLink('SBSmk1', 4, '2080')).toBe('/dev/forestry/drought-risk?bgc=SBSmk1&smr=4&period=2080')
  })

  it('samples a thin landform densely enough to read', () => {
    const points = landformSamples(box(0, 0, 0.05, 0.0005))
    expect(points.length).toBeGreaterThan(300)
  })

  it('names a busy DataBC database rather than a bare HTTP 400', () => {
    const report = (text: string) =>
      `<?xml version="1.0"?><ows:ExceptionReport><ows:Exception><ows:ExceptionText>${text}</ows:ExceptionText></ows:Exception></ows:ExceptionReport>`
    expect(
      wfsExceptionReason(
        report(
          'java.lang.RuntimeException: Unable to obtain connection: HikariPool idwprod1 - Connection is not available, request timed out after 500ms.',
        ),
      ),
    ).toBe("DataBC's server could not reach its database; try again later")
    expect(wfsExceptionReason(report('java.lang.IllegalArgumentException: Illegal property name: FOO'))).toBe(
      'Illegal property name: FOO',
    )
    expect(wfsExceptionReason('not xml')).toBeNull()
  })
})
