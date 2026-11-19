import { describe, expect, it } from 'vitest'
import type { CostAttribution, CostInterval } from './costAttribution'
import {
  COST_INTENSITY_COLORS,
  COST_RAMP_COLORS,
  costColourHeading,
  costColourLines,
  costRampColour,
  costRampPosition,
  costRampTicks,
  hasCostSeries,
} from './costColours'
import { defaultStretchLength } from './CostWhereItFalls'
import { buildPlanLegend } from './planLegendModel'
import { GRADE_CLASS_COLORS } from './gradeClasses'
import { costRampColors, DEFAULT_COST_COLOURING } from './roadColouring'

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
  it('colours each costed interval on the ramp by its multiple of the average, unknown grey and zero neutral', () => {
    const lines = costColourLines(roads(), attribution, 'total')
    const active = lines.features.filter((feature) => feature.properties?.selected)
    // 2.5, 7.5, 15, 30 and 45 $/m against an average of 10 $/m.
    expect(active.slice(0, 5).map((feature) => feature.properties?.costRatio)).toEqual([0.25, 0.75, 1.5, 3, 4.5])
    expect(active.map((feature) => feature.properties?.color)).toEqual([
      COST_RAMP_COLORS[0],
      costRampColour(costRampPosition(0.75)),
      costRampColour(costRampPosition(1.5)),
      costRampColour(costRampPosition(3)),
      COST_RAMP_COLORS.at(-1),
      ...Array(5).fill(COST_INTENSITY_COLORS.none),
      COST_INTENSITY_COLORS.unknown,
    ])
    expect(active.map((feature) => feature.properties?.legendRamp ?? false)).toEqual([
      ...Array(5).fill(true),
      ...Array(6).fill(false),
    ])
    expect(active.map((feature) => feature.properties?.legendOrder)).toEqual([
      ...Array(5).fill(undefined),
      ...Array(5).fill(5),
      6,
    ])
    expect(COST_INTENSITY_COLORS.unknown).toBe(GRADE_CLASS_COLORS.unknown)
    // Other roads keep their own colour and get no class.
    expect(lines.features[0].properties).toEqual({ id: 'other', selected: false, color: '#0ea5e9' })
  })

  it('runs the ramp evenly in log scale from a quarter of the average to four times it', () => {
    expect(costRampPosition(0)).toBe(0)
    expect(costRampPosition(-3)).toBe(0)
    expect(costRampPosition(0.25)).toBe(0)
    expect(costRampPosition(0.5)).toBeCloseTo(0.25)
    expect(costRampPosition(1)).toBeCloseTo(0.5)
    expect(costRampPosition(2)).toBeCloseTo(0.75)
    expect(costRampPosition(4)).toBe(1)
    expect(costRampPosition(40)).toBe(1)
    // The stops are where a CSS gradient of the same colours puts them: viridis, pale yellow first.
    const last = COST_RAMP_COLORS.length - 1
    COST_RAMP_COLORS.forEach((colour, i) => expect(costRampColour(i / last)).toBe(colour))
    expect([0, 0.25, 0.5, 0.75, 1].map((t) => costRampColour(t))).toEqual([
      '#fde725',
      '#5ec962',
      '#21918c',
      '#3b528b',
      '#440154',
    ])
  })

  it('never reuses the plan road amber, the over-grade red, or the colours off the ramp', () => {
    const colours = [...COST_RAMP_COLORS, COST_INTENSITY_COLORS.none, COST_INTENSITY_COLORS.unknown]
    expect(new Set(colours).size).toBe(colours.length)
    for (const reserved of ['#d97706', '#dc2626', '#e11d48']) expect(colours).not.toContain(reserved)
  })

  it('ticks the ramp in $/m and as multiples of the average', () => {
    expect(costRampTicks(410)).toEqual([
      { label: '≤ $103/m', note: '¼× avg' },
      { label: '$410/m', note: 'average' },
      { label: '≥ $1,640/m', note: '4× avg' },
    ])
    expect(costRampTicks(3.456).map((tick) => tick.label)).toEqual(['≤ $0.864/m', '$3.46/m', '≥ $13.8/m'])
    // Without an average the multiples stand alone.
    expect(costRampTicks(null).map((tick) => tick.label)).toEqual(['≤ ¼×', '1×', '≥ 4×'])
  })

  it('draws the costed stretches as the ramp and lists only what is off it, in order', () => {
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
    expect(roadSection.ramp?.colors).toEqual(COST_RAMP_COLORS)
    expect(roadSection.ramp?.ticks.map((tick) => tick.label)).toEqual(['≤ $2.5/m', '$10/m', '≥ $40/m'])
    expect(roadSection.entries.map((entry) => entry.label)).toEqual(['No cost placed', 'Unknown: sections incomplete'])
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

describe('cost colours with the person’s own scale', () => {
  it('reads every stretch against a target, and says so in the legend', () => {
    const settings = { ...DEFAULT_COST_COLOURING, reference: 'target' as const, targetPerMetre: 20 }
    const lines = costColourLines(roads(), attribution, 'total', settings)
    const active = lines.features.filter((feature) => feature.properties?.selected)
    // 2.5, 7.5, 15, 30 and 45 $/m against a target of 20 $/m.
    expect(active.slice(0, 5).map((feature) => feature.properties?.costRatio)).toEqual([0.125, 0.375, 0.75, 1.5, 2.25])
    const heading = costColourHeading(attribution, 'total', settings)
    expect(heading.description).toBe('Whole estimate · target $20/m · road average $10/m')
    expect(heading.ramp.ticks).toEqual([
      { label: '≤ $5/m', note: '¼× target' },
      { label: '$20/m', note: 'target' },
      { label: '≥ $80/m', note: '4× target' },
    ])
  })

  it('runs the chosen ramp between the chosen ends', () => {
    const settings = { ...DEFAULT_COST_COLOURING, minRatio: 0.5, maxRatio: 2, ramp: 'blues', reverse: false }
    expect(costRampPosition(0.5, settings)).toBe(0)
    expect(costRampPosition(1, settings)).toBeCloseTo(0.5)
    expect(costRampPosition(2, settings)).toBe(1)
    const blues = costRampColors(settings)
    const active = costColourLines(roads(), attribution, 'total', settings).features.filter(
      (feature) => feature.properties?.selected,
    )
    // 0.25× and 4.5× hold the ramp's ends.
    expect(active[0].properties?.color).toBe(blues[0])
    expect(active[4].properties?.color).toBe(blues.at(-1))
    const heading = costColourHeading(attribution, 'total', settings)
    expect(heading.ramp.colors).toEqual(blues)
    expect(heading.ramp.ticks.map((tick) => tick.note)).toEqual(['½× avg', 'average', '2× avg'])
  })
})
