import { describe, expect, it } from 'vitest'

import {
  distanceToSubject,
  lengthInside,
  overlapArea,
  prepareSubject,
  sideOfSubject,
  type Planar,
  type Ring,
} from './geometry'
import { measureRow, parseRead, planReads, readUrl, type ReadFeature } from './query'
import { printRow, quotedList, routeCardSheet, runRouteCard, type RouteCardRowState } from './results'
import {
  DEFAULT_ROUTE_CARD_PRESET,
  parseRouteCardRow,
  parseRouteCardPreset,
  presetRows,
  ROUTE_CARD_ROWS,
  routeCardRow,
} from './rows'

// A made-up 400 m × 300 m block on BC Albers, nowhere in particular.
const BLOCK_RING: Ring = [
  [1_200_000, 900_000],
  [1_200_400, 900_000],
  [1_200_400, 900_300],
  [1_200_000, 900_300],
  [1_200_000, 900_000],
]
const block: Planar = { kind: 'polygon', polygons: [[BLOCK_RING]] }
const square = (x: number, y: number, size: number): Planar => ({
  kind: 'polygon',
  polygons: [
    [
      [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
        [x, y],
      ],
    ],
  ],
})

describe('route card geometry', () => {
  const subject = prepareSubject(block)
  it('reads 0 for touching, overlapping and surrounding features', () => {
    expect(distanceToSubject(subject, square(1_200_400, 900_100, 50))).toBe(0)
    expect(distanceToSubject(subject, square(1_200_100, 900_100, 50))).toBe(0)
    expect(distanceToSubject(subject, square(1_190_000, 890_000, 50_000))).toBe(0)
  })
  it('measures the gap to a feature outside, and gives up past the limit', () => {
    expect(distanceToSubject(subject, square(1_200_401.3, 900_100, 50))).toBeCloseTo(1.3, 6)
    expect(distanceToSubject(subject, { kind: 'point', points: [[1_200_200, 900_500]] })).toBeCloseTo(200, 6)
    expect(distanceToSubject(subject, square(1_201_000, 900_100, 50), 200)).toBe(Infinity)
  })
  it('names the side a feature lies on', () => {
    expect(sideOfSubject(subject, square(1_200_150, 900_350, 50))).toBe('north')
    expect(sideOfSubject(subject, square(1_199_900, 899_900, 50))).toBe('southwest')
  })
  it('measures overlap and road length inside', () => {
    expect(
      overlapArea([[BLOCK_RING]], (square(1_200_300, 900_200, 200) as { polygons: Ring[][] }).polygons),
    ).toBeCloseTo(100 * 100, 3)
    expect(
      lengthInside(
        [
          [
            [1_199_900, 900_150],
            [1_200_500, 900_150],
          ],
        ],
        [[BLOCK_RING]],
      ),
    ).toBeCloseTo(400, 0)
  })
})

describe('route card rows', () => {
  it('reads the bundled catalogue and preset', () => {
    expect(ROUTE_CARD_ROWS).toHaveLength(70)
    expect(presetRows(DEFAULT_ROUTE_CARD_PRESET)).toHaveLength(69)
    expect(routeCardRow('existing-roads')!.search).toEqual({ yesWithinMeters: 400, nearWithinMeters: 600 })
    expect(routeCardRow('invasive-species')!.search).toEqual({ yesWithinMeters: 5000, nearWithinMeters: null })
    expect(routeCardRow('district')!.search).toEqual({ yesWithinMeters: 0, nearWithinMeters: 200 })
  })
  it('refuses a row that prints a field it does not read, and a preset naming an unknown row', () => {
    expect(() =>
      parseRouteCardRow({
        id: 'x',
        label: 'X',
        source: { kind: 'wfs', typeName: 'A.B', geometryField: 'SHAPE', fields: ['NAME'] },
        print: ['OTHER'],
      }),
    ).toThrow(/OTHER not in source.fields/)
    expect(() =>
      parseRouteCardPreset(
        {
          kind: 'route-card-preset',
          version: 1,
          id: 'p',
          name: 'P',
          description: 'd',
          sheet: { routeCard: 'A', considerations: 'B' },
          sections: [{ title: 'S', rows: ['no-such-row'] }],
          considerations: [],
          reads: [],
        },
        ROUTE_CARD_ROWS,
      ),
    ).toThrow(/no row “no-such-row”/)
  })
  it('shares one read between rows on the same layer and filter, at the widest search', () => {
    const reads = planReads(presetRows(DEFAULT_ROUTE_CARD_PRESET))
    const op = reads.find((read) => read.rows.includes('bcts-op-area'))!
    expect(op.rows).toEqual(['bcts-op-area', 'location'])
    const nonLegal = reads.find((read) => read.rows.includes('non-legal-ogma'))!
    expect(nonLegal.rows).toEqual(['cofa-non-legal-ogma', 'non-legal-ogma'])
    expect(nonLegal.fields).toEqual(['NON_LEGAL_OGMA_PROVID', 'OGMA_PRIMARY_REASON', 'NON_LEGAL_OGMA_INTERNAL_ID'])
    // The three TAP rows differ by filter: three reads.
    expect(reads.filter((read) => read.key.includes('OGSR_TAP'))).toHaveLength(3)
  })
  it('asks DataBC in EPSG:3005 with the box in CQL and the geometry field named', () => {
    const read = planReads([routeCardRow('tap-remnant')!])[0]
    const url = new URL(readUrl(read, [1000, 2000, 1100, 2100]))
    expect(url.searchParams.get('srsName')).toBe('EPSG:3005')
    expect(url.searchParams.get('bbox')).toBeNull()
    expect(url.searchParams.get('CQL_FILTER')).toBe(
      "(REMNANT_OLD_ECOSYS_IND='Y') AND BBOX(SHAPE,800.0,1800.0,1300.0,2300.0,'EPSG:3005')",
    )
    expect(url.searchParams.get('propertyName')).toBe('REMNANT_OLD_ECOSYS_ID,REMNANT_OLD_ECOSYS_IND,SHAPE')
  })
  it('asks the ArcGIS service with an envelope in 3005', () => {
    const read = planReads([routeCardRow('forest-health')!])[0]
    const url = new URL(readUrl(read, [1000, 2000, 1100, 2100]))
    expect(url.pathname).toMatch(/MapServer\/68\/query$/)
    expect(url.searchParams.get('geometry')).toBe('800.0,1800.0,1300.0,2300.0')
    expect(url.searchParams.get('inSR')).toBe('3005')
  })
})

const feature = (props: Record<string, unknown>, shape: Planar): ReadFeature => ({ props, shape })

describe('measuring a row', () => {
  const subject = prepareSubject(block)
  it('is Y on a touch, Within to 200 m, N past it, as the tool decided', () => {
    const row = routeCardRow('trapline')!
    const touching = measureRow(row, subject, [
      feature({ TRAPLINE_AREA_IDENTIFIER: 'TR01' }, square(1_200_400, 900_000, 10)),
    ])
    expect(touching.answer).toBe('yes')
    expect(touching.names).toEqual(['TR01'])
    // 1.3 m away was Within, not Y, in the tool's own output.
    expect(measureRow(row, subject, [feature({}, square(1_200_401.3, 900_000, 10))]).answer).toBe('near')
    expect(measureRow(row, subject, [feature({}, square(1_200_596, 900_000, 10))]).answer).toBe('near')
    expect(measureRow(row, subject, [feature({}, square(1_200_605, 900_000, 10))]).answer).toBe('no')
  })
  it('prints each name once, an empty field as None', () => {
    const row = routeCardRow('ungulate-winter-range')!
    const finding = measureRow(row, subject, [
      feature({ SPECIES_1: 'M-RATA-01', UWR_NUMBER: 'u-0-000' }, square(1_200_100, 900_100, 10)),
      feature({ SPECIES_1: 'M-RATA-01', UWR_NUMBER: 'u-0-000' }, square(1_200_200, 900_100, 10)),
      feature({ SPECIES_1: null, UWR_NUMBER: 'u-0-001' }, square(1_200_300, 900_100, 10)),
    ])
    expect(finding.names).toEqual(['M-RATA-01, u-0-000', 'None, u-0-001'])
  })
  it('searches roads to 400 m for Y and 600 m for Within', () => {
    const row = routeCardRow('existing-roads')!
    const road = (y: number): Planar => ({
      kind: 'line',
      lines: [
        [
          [1_200_000, y],
          [1_200_400, y],
        ],
      ],
    })
    expect(measureRow(row, subject, [feature({}, road(900_300 + 393))]).answer).toBe('yes')
    expect(measureRow(row, subject, [feature({}, road(900_300 + 442))]).answer).toBe('near')
    expect(measureRow(row, subject, [feature({}, road(900_300 + 605))]).answer).toBe('no')
  })
})

describe('printing the sheet', () => {
  it('quotes values as the tool does', () => {
    expect(quotedList(['TR0000T000'])).toBe("'TR0000T000'")
    expect(quotedList(["Made-up T'en Nation", 'Other'])).toBe(`"Made-up T'en Nation", 'Other'`)
  })
  it('never prints a row that was not read, or not public, as N', () => {
    const row = routeCardRow('district')!
    expect(printRow(row, { status: 'failed', error: 'DataBC answered 500.' }, undefined, 'block').value).toBe(
      'Not read',
    )
    expect(printRow(row, undefined, undefined, 'block').value).toBe('Not read')
    const arch = routeCardRow('arch-sites')!
    expect(printRow(arch, { status: 'notPublic' }, undefined, 'block')).toMatchObject({
      value: 'Not public',
      by: 'none',
    })
    expect(
      printRow(arch, { status: 'notPublic' }, { answer: 'yes', names: "'XxXx-1'", source: 'RAAD' }, 'block'),
    ).toMatchObject({ value: 'Y', names: "'XxXx-1'", by: 'entered', flagged: true })
  })
  it('lays the preset out section by section', () => {
    const sheet = routeCardSheet(DEFAULT_ROUTE_CARD_PRESET, { name: 'Made-up block', kind: 'block' }, {})
    expect(sheet.sections.map((section) => section.rows.length)).toEqual([11, 9, 28, 12, 9])
  })
})

describe('running a route card', () => {
  it('reads each layer once and reports every row, failures as their own', async () => {
    const asked: string[] = []
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      const layer = url.searchParams.get('typeNames') ?? url.pathname
      asked.push(`${layer}|${url.searchParams.get('CQL_FILTER') ?? url.searchParams.get('where')}`)
      if (layer.includes('TRAPLINE')) return new Response('nope', { status: 500 })
      const shape = {
        type: 'Polygon',
        coordinates: [
          [
            [1_200_100, 900_100],
            [1_200_110, 900_100],
            [1_200_110, 900_110],
            [1_200_100, 900_100],
          ],
        ],
      }
      return Response.json({
        type: 'FeatureCollection',
        features: [{ properties: { DISTRICT_NAME: 'Made-up District' }, geometry: shape }],
      })
    }) as typeof fetch
    const states: Record<string, RouteCardRowState> = {}
    await runRouteCard(
      DEFAULT_ROUTE_CARD_PRESET,
      { id: 'b', name: 'B', kind: 'block', shape: block },
      fetcher,
      (id, state) => {
        states[id] = state
      },
    )
    expect(new Set(asked).size).toBe(asked.length)
    expect(states.district).toMatchObject({ status: 'read', finding: { answer: 'yes', names: ['Made-up District'] } })
    expect(states.trapline).toMatchObject({ status: 'failed' })
    expect(states['arch-sites']).toEqual({ status: 'notPublic' })
    expect(Object.values(states).some((state) => state.status === 'reading')).toBe(false)
  })
  it('refuses an answer DataBC marks as an exception', () => {
    const read = planReads([routeCardRow('district')!])[0]
    expect(() => parseRead(read, { exceptions: [{}] })).toThrow(/refused/)
  })
})

describe('a reviewer’s own layer', () => {
  it('fills every row the file names a field of, printing real numbers as the tool does', async () => {
    const { entryFromImport, importedFeatures, importedFields, rowsFilledByFields } = await import('./imported')
    const subject = prepareSubject(block)
    // A made-up fisher-style layer in BC Albers, one polygon over the block.
    const features = importedFeatures(
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { Region: 'Made-up Region', Denning_warning: 2, Harvest_impact_warning: null },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [1_200_100, 900_100],
                  [1_200_150, 900_100],
                  [1_200_150, 900_150],
                  [1_200_100, 900_100],
                ],
              ],
            },
          },
        ],
      },
      'albers',
    )
    const filled = rowsFilledByFields(ROUTE_CARD_ROWS, importedFields(features)).map((row) => row.id)
    expect(filled).toEqual(['fisher-region', 'fisher-harvest-impact', 'fisher-denning-warning'])
    const denning = entryFromImport(
      routeCardRow('fisher-denning-warning')!,
      subject,
      features,
      'Denning_warning',
      'f.zip',
      '2026-11-18',
      new Set(['Denning_warning']),
    )
    expect(denning).toMatchObject({ answer: 'yes', names: "'2.0'" })
    expect(
      entryFromImport(
        routeCardRow('fisher-harvest-impact')!,
        subject,
        features,
        'Harvest_impact_warning',
        'f.zip',
        '2026-11-18',
      ).names,
    ).toBe("'None'")
  })
})
