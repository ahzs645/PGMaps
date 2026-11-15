import { describe, expect, it } from 'vitest'
import { estimateHtml, packageSummaryHtml, tilesSvg, type SummaryInput } from './packageSummary'
import { textWidth } from '@/lib/mapSheet/textMetrics'
import {
  packagePlan,
  packagePreset,
  parseReportPackage,
  presetSettings,
  withPlacement,
  withSummary,
} from './reportPackage'
import type { EngineeringCosts } from './engineeringTypes'
import type { ReadinessRow } from './readiness'
import type { RoadAnalysis, RoadStation } from './types'

const costs: EngineeringCosts = {
  cut: 300_000,
  stripping: 20_000,
  fill: 150_000,
  surfacing: 100_000,
  clearing: 40_000,
  structures: 30_000,
  haul: 200_000,
  borrow: 50_000,
  waste: 10_000,
  sitePreparation: 0,
  mobilization: 7_500,
  subtotal: 907_500,
  contingency: 136_125,
  total: 1_043_625,
}
const station = (chainage: number, z: number, grade: number) =>
  ({ chainage, designElevation: z, gradePercent: grade, cutVolumeM3: 10, fillVolumeM3: 5 }) as unknown as RoadStation
const analysis = {
  stations: [station(0, 900, 10), station(1000, 1000, 10), station(2000, 1150, 15)],
  length: 2000,
  cutVolumeM3: 50_000,
  fillVolumeM3: 30_000,
  estimatedCost: costs.total,
  coveragePercent: 98.7,
  engineering: { costs },
} as unknown as RoadAnalysis
/** The page with each tile's wrapped label lines read back as one string. */
const joined = (html: string) =>
  html.replace(/<\/text><text x="[\d.]+" y="[\d.]+" font-size="[\d.]+" fill="#4b5563">/g, ' ')
const row = (state: ReadinessRow['state'], check: string, result: string) =>
  ({ id: check, group: 'cost', check, state, result }) as ReadinessRow
const input = (settings: SummaryInput['settings']): SummaryInput => ({
  projectName: 'Demo',
  roads: [
    {
      name: 'Road A',
      analysis,
      review: [row('met', 'Grade within the standard', 'ok'), row('attention', 'Rates priced', 'Haul is unpriced')],
    },
  ],
  settings,
  rule: { favourablePercent: 12, adversePercent: 12, loadedDirection: null, shortPitch: null },
  terrain: { name: 'Regional DEM', resolutionM: 22, kind: 'regional' },
  stamp: ['Rev A · draft for review'],
  contents: [{ label: 'Road A · plot book', page: 2 }],
  appendices: [],
  omitted: [],
})

describe('package summary page', () => {
  it('prints the figures, the road table, costs with contingency, findings and open items', () => {
    const html = packageSummaryHtml(input(withSummary(undefined, { front: 'summary' })))
    expect(joined(html)).toContain('estimate with 15% contingency')
    expect(html).toContain('$1,043,625')
    expect(html).toContain('<td>Contingency (15%)</td>')
    // The largest costs are named by what they are, with their dollars and share.
    expect(html).toContain(
      'The largest costs are excavation and stripping $320,000 (31%), haul, borrow and waste $260,000 (25%) and fill placement $150,000 (14%) of the estimate.',
    )
    expect(html).toContain('steeper than the 12.0% sustained limit on Road A for 1,000 m (50% of its length)')
    expect(html).toContain('Earthwork is known over 98.7% of Road A.')
    expect(html).toContain('That is regional terrain')
    expect(html).toContain('Rates priced: Haul is unpriced')
    expect(html).toContain('Road A · plot book, page 2')
    expect(html).not.toContain('earthwork, not the road surface')
  })

  it('states every cost before contingency when asked, and leaves out switched-off sections', () => {
    let settings = withSummary(undefined, { front: 'summary', contingency: false })
    settings = withSummary(settings, { section: ['openItems', false] })
    settings = withSummary(settings, { section: ['findings', false] })
    const html = packageSummaryHtml(input(settings))
    expect(joined(html)).toContain('estimate before contingency')
    expect(html).toContain('$907,500')
    expect(html).toContain('Total before contingency')
    expect(html).not.toContain('Contingency (15%)')
    expect(html).not.toContain('$1,043,625')
    expect(html).not.toContain('<h2>Open items</h2>')
    expect(html).not.toContain('<h2>Findings</h2>')
  })
  it('says when the project has no contingency or mobilization instead of printing $0 lines', () => {
    const bare = { ...costs, mobilization: 0, contingency: 0, subtotal: 900_000, total: 900_000 }
    const html = packageSummaryHtml({
      ...input(withSummary(undefined, { front: 'summary' })),
      roads: [
        {
          name: 'Road A',
          analysis: { ...analysis, engineering: { costs: bare } } as unknown as RoadAnalysis,
          review: null,
        },
      ],
    })
    expect(joined(html)).toContain('estimate (no contingency entered)')
    expect(html).toContain('Total (no contingency entered)')
    expect(html).not.toContain('Contingency (0%)')
    expect(html).not.toContain('mobilization')
    expect(html).toContain('No contingency is entered in the project.')
    expect(html).not.toContain('estimate before contingency.')
  })
})

describe('package summary cost rates', () => {
  it('prints the assumed rate beside each cost item', () => {
    const base = input(withSummary(undefined, { front: 'summary' }))
    const html = packageSummaryHtml({
      ...base,
      roads: [
        { ...base.roads[0], rates: { cut: '$6/bank m³', fill: '$4/m³ placed', contingency: '15% of the subtotal' } },
      ],
    })
    expect(html).toContain('<th>Rate assumed</th>')
    expect(html).toContain('<tr><td>Excavation</td><td>$6/bank m³</td><td>$300,000</td></tr>')
    expect(html).toContain('<tr><td>Contingency (15%)</td><td>15% of the subtotal</td>')
    expect(html).toContain('<tr><th>Total</th><th></th><th>$1,043,625</th></tr>')
    // Without rates the table keeps its two columns.
    expect(packageSummaryHtml(base)).not.toContain('Rate assumed')
  })
})

describe('key-figure tiles', () => {
  it('keeps every value and label inside its tile', () => {
    const svg = tilesSvg([
      ['3,578 m', 'road length'],
      ['18,671 m³', 'cut'],
      ['16,392 m³', 'fill'],
      ['$639,605', 'estimate (no contingency entered)'],
      ['$178,773/km', 'per kilometre'],
    ])
    const tiles = [...svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => ({
      x: Number(m[1]),
      right: Number(m[1]) + Number(m[2]),
      height: Number(m[3]),
    }))
    const texts = [
      ...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" font-size="([\d.]+)"( font-weight="700")?[^>]*>([^<]+)</g),
    ]
    for (const [, x, size, bold, text] of texts) {
      const tile = tiles.find((t) => Number(x) >= t.x && Number(x) < t.right)!
      const plain = text.replace(/&amp;/g, '&')
      expect(Number(x) + textWidth(plain, Number(size), bold ? 'bold' : 'normal')).toBeLessThanOrEqual(tile.right - 9)
    }
    // The long label wraps to a second line, and its row grows to hold it.
    expect(svg).toContain('>estimate (no contingency<')
    expect(svg).toContain('>entered)<')
    expect(tiles[3].height).toBeGreaterThan(54)
  })
})

describe('package presets', () => {
  it('simplified opens with the summary and prints only the charts sheet', () => {
    const simplified = presetSettings('simplified')
    const plan = packagePlan(simplified, 'R')
    expect(simplified.front).toBe('summary')
    expect(simplified.summaryOff).toEqual(['openItems', 'contents'])
    expect(plan.main.report).toEqual([])
    expect(plan.main.plotbook).toEqual(['charts'])
    expect(plan.main.sheets).toEqual([])
    expect(plan.appendices).toEqual([])
    // Its charts sheet leaves out mass haul and prints stations and statistics every 200 m.
    expect(simplified.charts).toEqual({ panels: ['profile', 'grade'], stationTickM: 200, intervalM: 200 })
    expect(parseReportPackage(JSON.parse(JSON.stringify(simplified)))).toEqual(simplified)
    expect(packagePreset(withSummary(simplified, { charts: { intervalM: 500 } }))).toBe('custom')
    expect(packagePreset(simplified)).toBe('simplified')
    expect(packagePreset(presetSettings('simplified', false))).toBe('simplified')
    expect(packagePreset(undefined)).toBe('full')
    expect(packagePreset(withPlacement(simplified, 'report:review', 'main'))).toBe('custom')
  })
})

describe('a road with no engineering inputs', () => {
  it('still prints the breakdown at the base rates and says what is not priced', () => {
    const base: EngineeringCosts = {
      ...costs,
      stripping: 0,
      structures: 0,
      haul: 0,
      borrow: 0,
      waste: 0,
      mobilization: 0,
      subtotal: 590_000,
      contingency: 0,
      total: 590_000,
    }
    const plain = { ...analysis, engineering: undefined, estimatedCost: 590_000 } as unknown as RoadAnalysis
    const html = packageSummaryHtml({
      ...input(withSummary(undefined, { front: 'summary' })),
      roads: [
        { name: 'Road A', analysis: plain, review: null, baseCosts: base, rates: { cut: '$12/m³ (project rate)' } },
      ],
    })
    expect(html).toContain('<h2>Cost breakdown (CAD)</h2>')
    expect(html).toContain('<td>$12/m³ (project rate)</td>')
    expect(html).toContain('Total (no contingency entered)')
    expect(html).toContain(
      'This road has no engineering inputs, so its estimate is cut, fill, surfacing and clearing at the project&#39;s rates',
    )
    expect(html).toContain(
      'Haul, borrow, waste, culverts, site preparation, mobilization and contingency are not priced.',
    )
  })
})

describe('the slope sheet on the summary', () => {
  const check = {
    sheet: 'Slope.pdf',
    coveredLengthM: 1800,
    roadLengthM: 2000,
    samples: 9000,
    exactPercent: 30,
    sheetSteepPercent: 22,
    terrainSteepPercent: 9,
    intervals: [],
    stretches: [{ from: 200, to: 397, samples: 900, sheetSteepPercent: 19.4, terrainSteepPercent: 0 }],
  }
  const withSheet = (settings: SummaryInput['settings'], highCase?: unknown) =>
    packageSummaryHtml({
      ...input(settings),
      roads: [
        {
          name: 'Road A',
          analysis,
          review: null,
          slopeSheet: { check, ...(highCase ? { highCase: highCase as never } : {}) },
        },
      ],
    })
  const priced = (cut: number) =>
    ({
      ...analysis,
      engineering: {
        costs: { ...costs, cut, subtotal: costs.subtotal - costs.cut + cut, total: costs.total - costs.cut + cut },
      },
    }) as unknown as RoadAnalysis
  it('sets the sheet beside the estimate and names the steeper stretch', () => {
    const html = withSheet(withSummary(undefined, { front: 'summary' }))
    expect(html).toContain('<h2>Slope sheet check</h2>')
    expect(html).toContain('<td>1,800 of 2,000 m</td><td>22%</td><td>9%</td><td>0+200–0+397 (19% against 0%)</td>')
    expect(html).toContain('so full bench and end haul may be understated there.')
    expect(html).not.toContain('High case')
  })
  it('with the high case, prints what benching adds beside the estimate without changing it', () => {
    const settings = withSummary(withSummary(undefined, { front: 'summary' }), { slopeSheet: 'range' })
    const html = withSheet(settings, {
      base: priced(300_000),
      case: priced(340_000),
      change: 'Full bench on 1 stretch',
    })
    expect(html).toContain('<th>High case</th><th>Adds</th>')
    expect(html).toContain('<td>$1,083,625</td><td>$40,000</td>')
    expect(html).toContain('Full-benching those stretches adds $40,000 to the estimate')
    // The estimate tile is the road's own.
    expect(joined(html)).toContain('$1,043,625')
    expect(html).toContain('Road A: Full bench on 1 stretch.')
  })
  it('leaves it off the summary when asked', () => {
    const html = withSheet(withSummary(withSummary(undefined, { front: 'summary' }), { slopeSheet: 'off' }))
    expect(html).not.toContain('Slope sheet check')
    expect(html).not.toContain('may be understated')
  })
})

describe('the estimate range on the summary', () => {
  const level = (estimate: number | null, changes: string[], extra: object = {}) => ({
    changes,
    estimate,
    roadEstimate: estimate,
    cutM3: 1,
    fillM3: 1,
    balanceM3: 0,
    completePercent: 100,
    crossDrains: null,
    endHaul: null,
    ...extra,
  })
  const range = {
    asIs: { estimate: 900_000, completePercent: 90 },
    low: level(1_000_000, ['1:1 fill on 2 stretches']),
    medium: level(1_200_000, ['Full bench on 1 stretch'], { crossDrains: { count: 10, cost: null } }),
    high: level(1_400_000, ['Full bench on 3 fill stretches'], {
      crossDrains: { count: 10, cost: null },
      endHaul: { m3: 5000, cost: null },
    }),
  }
  const html = (estimate = {}) =>
    packageSummaryHtml({
      ...input(withSummary(withSummary(undefined, { front: 'summary' }), { range: true })),
      estimate,
      roads: [{ name: 'Road A', analysis, review: null, range: range as never }],
    })
  it('prints each level beside the estimate as imported, and what each did', () => {
    const page = html({ crossDrainSpacingM: 100 })
    expect(page).toContain('<h2>Estimate range</h2>')
    expect(page).toContain('<td>Road A</td><td>$900,000</td><td>$1,000,000</td><td>$1,200,000</td><td>$1,400,000</td>')
    expect(page).toContain(
      'Road A: Low, 1:1 fill on 2 stretches. Medium, Full bench on 1 stretch. High, Full bench on 3 fill stretches.',
    )
    expect(joined(page)).toContain('$1.00M–$1.40M')
    expect(page).toContain(
      'Fixing the sections that do not close puts the estimate between $1,000,000 (low) and $1,400,000 (high), $1,200,000 with Review&#39;s leading fixes, against $900,000 as imported',
    )
  })
  it('names what is counted but not priced, never a made-up rate', () => {
    const page = html({ crossDrainSpacingM: 100 })
    expect(page).toContain(
      'Medium and high add 10 cross-drains, one every 100 m less the culverts already entered, counted but not priced',
    )
    expect(page).toContain('has no end-haul price: enter a rate to include it.')
    expect(page).toContain('A further 5,000 m³ of surplus cut at the high level has no end-haul price.')
    expect(html({})).toContain('No cross-drain spacing is entered')
  })
})

describe('the Preliminary estimate export', () => {
  const level = (estimate: number) => ({
    changes: ['1:1 fill on 2 stretches'],
    estimate,
    roadEstimate: estimate,
    cutM3: 1,
    fillM3: 1,
    balanceM3: 0,
    completePercent: 100,
    crossDrains: null,
    endHaul: null,
  })
  const range = {
    asIs: { estimate: 900_000, completePercent: 90 },
    low: level(1e6),
    medium: level(1.2e6),
    high: level(1.4e6),
  }
  it('prints the range as a document of its own, with only the findings that bear on it', () => {
    const page = estimateHtml({
      ...input({ parts: {}, range: true }),
      estimate: { crossDrainSpacingM: 120 },
      roads: [{ name: 'Road A', analysis, review: null, range: range as never }],
    })
    expect(page).toContain('<title>Demo · preliminary estimate</title>')
    expect(page).toContain('Preliminary estimate: Road A')
    expect(joined(page)).toContain('$1,400,000')
    expect(page).toContain('<h2>Estimate range</h2>')
    expect(page).toContain('Fixing the sections that do not close')
    expect(page).toContain('Quantities come from Regional DEM')
    expect(page).not.toContain('The largest costs are')
    expect(page).not.toContain('Readiness checks:')
    expect(page).toContain('one every 120 m')
  })
  it('says so before contingency when the export leaves it out', () => {
    const page = estimateHtml({
      ...input({ parts: {}, range: true, contingency: false }),
      roads: [{ name: 'Road A', analysis, review: null, range: range as never }],
    })
    expect(joined(page)).toContain('as imported, before contingency')
  })
})

describe('the grade finding with a loaded direction', () => {
  // The fixture's grades all climb up-station (10% and 15%).
  const page = (loadedDirection: 'start-to-end' | 'end-to-start') =>
    packageSummaryHtml({
      ...input(withSummary(undefined, { front: 'summary' })),
      rule: { favourablePercent: 16, adversePercent: 9, loadedDirection, shortPitch: null },
    })
  it('names both limits and the direction they are judged by', () => {
    // Loaded toward the start, the climbs are favourable descents for loaded trucks: within 16%.
    expect(page('end-to-start')).toContain(
      'The design grade stays within the sustained limits (16% favourable, 9% adverse, loaded toward the road start).',
    )
    // Loaded toward the end, the same climbs are adverse: past 9%.
    expect(page('start-to-end')).toContain(
      'The design grade is past the sustained limits (16% favourable, 9% adverse, loaded toward the road end) on Road A',
    )
  })
})
