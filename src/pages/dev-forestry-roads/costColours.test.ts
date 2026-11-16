import { describe, expect, it } from 'vitest'
import type { CostAttribution, CostInterval } from './costAttribution'
import {
  COST_INTENSITY_COLORS,
  costColourHeading,
  costColourLines,
  costIntensityLabel,
  hasCostSeries,
} from './costColours'
import { defaultStretchLength } from './CostWhereItFalls'
import { buildPlanLegend } from './planLegendModel'
import { GRADE_CLASS_COLORS } from './gradeClasses'

// Eleven 10 m intervals; the known ones average exactly 10 $/m and the last is incomplete
// (the fixture `costAttribution.test.ts` classes).
const amounts = [25, 75, 150, 300, 450, 0, 0, 0, 0, 0, 500]
const intervals: CostInterval[] = amounts.map((_, k) => ({
  stationIndex: k + 1,
  start: k * 10,
  end: (k + 1) * 10,
  lengthM: 10,
  complete: k < 10,
}))
const placedTotal = amounts.reduce((sum, value) => sum + value, 0)
const attribution: CostAttribution = {
  intervals,
  rows: [
    {
      rowId: 'fill',
      label: 'Fill placement',
      amount: 1000,
      placed: amounts.map((value, k) => (k < 10 ? value : null)),
      placedTotal: 1000,
      unplaced: 0,
      driverLabel: 'm³',
      quantity: amounts.map((value, k) => (k < 10 ? value / 3 : null)),
    },
  ],
  total: amounts,
  totalAmount: placedTotal,
  placedTotal,
  unplacedTotal: 0,
}

const segment = (properties: Record<string, unknown>): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: [
      [-122.7, 53.9],
      [-122.71, 53.91],
    ],
  },
  properties,
})
/** The active road as the plan draws it: one segment per interval, named by the station ending it. */
const roads = (): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: [
    segment({ id: 'other', selected: false, color: '#0ea5e9' }),
    ...intervals.map((interval) =>
      segment({ id: 'road', selected: true, chainage: interval.end, color: interval.complete ? '#d97706' : '#9ca3af' }),
    ),
  ],
})

describe('cost colours on the plan', () => {
  it('colours each interval by its class, cheapest pale and costliest deep, unknown grey and zero neutral', () => {
    const lines = costColourLines(roads(), attribution, 'total')
    const active = lines.features.filter((feature) => feature.properties?.selected)
    expect(active.map((feature) => feature.properties?.color)).toEqual([
      COST_INTENSITY_COLORS[0],
      COST_INTENSITY_COLORS[1],
      COST_INTENSITY_COLORS[2],
      COST_INTENSITY_COLORS[3],
      COST_INTENSITY_COLORS[4],
      ...Array(5).fill(COST_INTENSITY_COLORS.none),
      COST_INTENSITY_COLORS.unknown,
    ])
    expect(active.map((feature) => feature.properties?.legendOrder)).toEqual([0, 1, 2, 3, 4, 5, 5, 5, 5, 5, 6])
    expect(COST_INTENSITY_COLORS.unknown).toBe(GRADE_CLASS_COLORS.unknown)
    // Other roads keep their own colour and get no class.
    expect(lines.features[0].properties).toEqual({ id: 'other', selected: false, color: '#0ea5e9' })
  })

  it('never reuses the plan road amber, the over-grade red, or another class colour', () => {
    const ramp = [0, 1, 2, 3, 4, 'none', 'unknown'] as const
    const colours = ramp.map((cls) => COST_INTENSITY_COLORS[cls])
    expect(new Set(colours).size).toBe(colours.length)
    for (const reserved of ['#d97706', '#dc2626', '#e11d48']) expect(colours).not.toContain(reserved)
  })

  it('labels each class by its $/m range and multiple of the road average', () => {
    expect(costIntensityLabel(0, 410)).toBe('Under $205/m (under 0.5× avg)')
    expect(costIntensityLabel(2, 410)).toBe('$410–$820/m (1–2× avg)')
    expect(costIntensityLabel(4, 410)).toBe('$1,640/m or more (4× avg or more)')
    expect(costIntensityLabel(1, 3.456)).toBe('$1.73–$3.46/m (0.5–1× avg)')
    expect(costIntensityLabel('unknown', 410)).toBe('Unknown: sections incomplete')
    expect(costIntensityLabel('none', 410)).toBe('No cost placed')
    // Without an average the bin's own wording stands.
    expect(costIntensityLabel(3, null)).toBe('2–4× the road average')
  })

  it('lists the legend in bin order, not road order', () => {
    const shuffled = roads()
    shuffled.features.reverse()
    const legend = buildPlanLegend({
      sources: {
        roads: costColourLines(shuffled, attribution, 'total'),
        context: { type: 'FeatureCollection', features: [] },
        corridor: { type: 'FeatureCollection', features: [] },
        formation: { type: 'FeatureCollection', features: [] },
        edges: { type: 'FeatureCollection', features: [] },
        ditches: { type: 'FeatureCollection', features: [] },
        cable: { type: 'FeatureCollection', features: [] },
        structures: { type: 'FeatureCollection', features: [] },
        draft: { type: 'FeatureCollection', features: [] },
        section: { type: 'FeatureCollection', features: [] },
        ticks: { type: 'FeatureCollection', features: [] },
      },
      alignments: [],
      maxGradePercent: 12,
      terrainOnly: false,
      showEarthwork: true,
      roadsHeading: costColourHeading(attribution, 'total'),
    })
    const roadSection = legend.find((section) => section.id === 'roads')!
    expect(roadSection.title).toBe('Cost per metre')
    expect(roadSection.description).toBe('Whole estimate · road average $10/m')
    expect(roadSection.entries.map((entry) => entry.label)).toEqual([
      'Under $5/m (under 0.5× avg)',
      '$5–$10/m (0.5–1× avg)',
      '$10–$20/m (1–2× avg)',
      '$20–$40/m (2–4× avg)',
      '$40/m or more (4× avg or more)',
      'No cost placed',
      'Unknown: sections incomplete',
    ])
  })

  it('colours by one row, names it, and falls back to the whole estimate for a row that is gone', () => {
    expect(hasCostSeries(attribution, 'fill')).toBe(true)
    expect(hasCostSeries(attribution, 'gone')).toBe(false)
    expect(costColourHeading(attribution, 'fill').description).toBe('Fill placement · road average $10/m')
    expect(costColourHeading(attribution, 'gone').description).toBe('Whole estimate · road average $10/m')
    const row = costColourLines(roads(), attribution, 'fill').features.at(-1)!.properties
    expect(row?.color).toBe(COST_INTENSITY_COLORS.unknown)
    expect(() => costColourLines(roads(), attribution, 'gone')).not.toThrow()
  })

  it('calls a segment with no interval at its chainage unknown', () => {
    const drawn = roads()
    drawn.features[1] = segment({ id: 'road', selected: true, chainage: 5, color: '#d97706' })
    const lines = costColourLines(drawn, attribution, 'total')
    expect(lines.features[1].properties).toMatchObject({
      color: COST_INTENSITY_COLORS.unknown,
      legendLabel: 'Unknown: sections incomplete',
    })
  })
})

describe('stretch length', () => {
  it('defaults to the offered length nearest a tenth of the road', () => {
    expect(defaultStretchLength(0)).toBe(20)
    expect(defaultStretchLength(150)).toBe(20)
    expect(defaultStretchLength(700)).toBe(50)
    expect(defaultStretchLength(1000)).toBe(100)
    expect(defaultStretchLength(1500)).toBe(200)
    expect(defaultStretchLength(40000)).toBe(500)
  })
})
