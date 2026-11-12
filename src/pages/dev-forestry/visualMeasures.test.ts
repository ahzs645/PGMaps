import { describe, expect, it } from 'vitest'

import { MASK_LABELS, nextWildlifeTreePatchName, parseMasks, withDrawnMask } from './assessmentMasks'
import type { AssessmentMask, TargetPolygon } from './types'
import { assessVia, parseViaReview } from './via'
import {
  draftVisualMeasures,
  measureItems,
  measuresInputFromScene,
  patchLocation,
  type MeasuresInput,
} from './visualMeasures'

/** A square of `size` degrees with its south-west corner at (lng, lat). */
const square = (lng: number, lat: number, size: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [lng, lat],
      [lng + size, lat],
      [lng + size, lat + size],
      [lng, lat + size],
      [lng, lat],
    ],
  ],
})

const BLOCK = square(-122.5, 54, 0.01)

const input = (extra: Partial<MeasuresInput> = {}): MeasuresInput => ({
  block: {
    name: 'PL-1',
    areaHa: 72.6,
    harvestSystem: 'clearcut',
    retentionPercent: null,
    volumeRemovedPercent: null,
    residualHeightMeters: null,
  },
  objective: { id: 'partial-retention', vac: 'low', landformName: 'North face' },
  viewpointName: 'Hwy 16',
  figures: { run: 'current', initialPercent: 4.21, adjustedPercent: 3.84 },
  patches: [],
  design: {},
  roads: null,
  skyline: null,
  ...extra,
})

const ids = (draft: ReturnType<typeof draftVisualMeasures>) => draft.measures.map((m) => m.id)

describe('visual measures draft', () => {
  it('states the objective and the figure, and always ends with the stop-work condition', () => {
    const draft = draftVisualMeasures(input())
    expect(ids(draft)).toEqual(['objective', 'scale', 'stop-work'])
    expect(draft.measures[0].text).toBe(
      "Visual quality objective: Partial Retention 'PR', 1.6–7% alteration in perspective view from Hwy 16; visual absorption capability low. The design is assessed at 4.2% (3.8% after the design adjustments). This is within the range.",
    )
    expect(draft.measures[1].text).toBe(
      'Keep the opening to the 73 ha flagged; any boundary change needs the visuals reassessed.',
    )
    expect(draft.measures.at(-1)!.text).toBe(
      'Stop operations in the affected area and contact the visual specialist or planning forester if the boundary has to move or the opening would grow past the 73 ha flagged, which could exceed the Partial Retention objective.',
    )
    expect(draft.text.split('\n')).toHaveLength(3)
  })

  it('says when the design is over the range, and when it has not been measured', () => {
    const over = draftVisualMeasures(input({ figures: { run: 'current', initialPercent: 9, adjustedPercent: 8.2 } }))
    expect(over.measures[0].text).toContain('This is over the range: do not start harvesting until')
    const near = draftVisualMeasures(input({ figures: { run: 'current', initialPercent: 6.5, adjustedPercent: null } }))
    expect(near.measures[0].text).toContain('measured at 6.5% before the design adjustments')
    expect(near.measures[0].text).toContain('near the top of the range')
    const none = draftVisualMeasures(input({ figures: { run: 'none', initialPercent: null, adjustedPercent: null } }))
    expect(none.measures[0].text).toContain('has not been measured yet')
    const stale = draftVisualMeasures(input({ figures: { run: 'stale', initialPercent: null, adjustedPercent: null } }))
    expect(stale.measures[0].text).toContain('run it again')
    const withheld = draftVisualMeasures(
      input({ figures: { run: 'current', initialPercent: null, adjustedPercent: null } }),
    )
    expect(withheld.measures[0].text).toContain('The run has not given a percent alteration yet: see step 4.')
    // No landform: no objective measure, and the stop condition names no objective.
    const bare = draftVisualMeasures(input({ objective: null }))
    expect(ids(bare)[0]).toBe('scale')
    expect(bare.measures.at(-1)!.text).not.toContain('objective')
  })

  it('names each wildlife tree patch with its area and place, and adds them to the stop condition', () => {
    const draft = draftVisualMeasures(
      input({
        patches: [
          { name: 'WTP 1', areaHa: 1.24, location: 'inside' },
          { name: 'Wildlife tree patch 2', areaHa: 0.5, location: 'boundary' },
          { name: 'Screen', areaHa: 3.5, location: 'beside' },
        ],
      }),
    )
    expect(ids(draft)).toEqual(['objective', 'patch-0', 'patch-1', 'patch-2', 'scale', 'stop-work'])
    expect(draft.measures[1].text).toBe(
      "Keep wildlife tree patch 'WTP 1' (1.2 ha, inside the block) standing as mapped: no falling, yarding or road building inside it.",
    )
    // A drawn patch's own name already says what it is.
    expect(draft.measures[2].text).toMatch(/^Keep Wildlife tree patch 2 \(0\.5 ha, on the block boundary\)/)
    expect(draft.measures[3].text).toContain('(3.5 ha, beside the block)')
    // The share of the block is in the basis, counting only patches in or on it.
    expect(draft.measures[1].basis).toContain('Patches in or on the block: 1.7 ha, about 2% of its 73 ha')
    expect(draft.measures.at(-1)!.text).toContain(
      'if the wildlife tree patches cannot be placed or kept as mapped, or if',
    )
  })

  it('sums patches past the named limit', () => {
    const patches = Array.from({ length: 8 }, (_, i) => ({
      name: `WTP ${i + 1}`,
      areaHa: 1,
      location: 'inside' as const,
    }))
    const draft = draftVisualMeasures(input({ patches }))
    expect(ids(draft).filter((id) => id.startsWith('patch'))).toHaveLength(7)
    expect(draft.measures.find((m) => m.id === 'patch-rest')!.text).toBe(
      'Keep the other 2 wildlife tree patches (2.0 ha in all) standing as mapped.',
    )
  })

  it('writes the harvest system’s prescription', () => {
    const retention = draftVisualMeasures(
      input({ block: { ...input().block, harvestSystem: 'retention', retentionPercent: 18 } }),
    )
    expect(retention.measures.find((m) => m.id === 'harvest')!.text).toBe(
      'Leave 18% of the stand standing as dispersed retention, spread across the visible face of the block.',
    )
    const partial = draftVisualMeasures(
      input({
        block: { ...input().block, harvestSystem: 'partial', volumeRemovedPercent: 35, residualHeightMeters: 22 },
      }),
    )
    expect(partial.measures.find((m) => m.id === 'harvest')!.text).toBe(
      'Partial cut: remove no more than 35% of the volume and leave a residual stand with a mean height of at least 22 m.',
    )
    expect(partial.measures.at(-1)!.text).toContain('the retention or partial-cut prescription cannot be met')
    const unrecorded = draftVisualMeasures(input({ block: { ...input().block, harvestSystem: 'partial' } }))
    expect(unrecorded.measures.find((m) => m.id === 'harvest')!.basis).toContain('volume removed not recorded')
  })

  it('turns the step-4 design ratings the design relies on into instructions, and only those', () => {
    const good = draftVisualMeasures(
      input({
        design: { 'edge-treatment': 1, 'force-lines': 1, 'natural-character': 1, position: 1, distance: 1 },
        roads: 2,
        skyline: { stations: 3, stationCount: 40 },
      }),
    )
    expect(ids(good)).toEqual([
      'objective',
      'edges',
      'force-lines',
      'natural-character',
      'position',
      'scale',
      'skyline',
      'roads',
      'stop-work',
    ])
    expect(good.measures.find((m) => m.id === 'edges')!.text).toContain('Feather the block edges')
    expect(good.measures.find((m) => m.id === 'skyline')!.basis).toContain('3 of 40 stations')
    expect(good.measures.find((m) => m.id === 'roads')!.text).toContain('where they face Hwy 16')
    expect(good.measures.at(-1)!.text).toContain('the feathered or irregular edges cannot be laid out as planned')
    expect(good.measures.at(-1)!.text).toContain('the timber below the skyline cannot be kept')
    // A poor rating is not something the crew can hold to.
    const poor = draftVisualMeasures(input({ design: { 'edge-treatment': -1, 'force-lines': 0 }, roads: 0 }))
    expect(ids(poor)).toEqual(['objective', 'scale', 'stop-work'])
    expect(draftVisualMeasures(input({ design: { 'edge-treatment': 0 } })).measures[1].text).toContain(
      'Keep the edge treatment as laid out',
    )
  })
})

describe('the reviewer’s list', () => {
  it('reads one measure per line, dropping typed bullets and numbers', () => {
    expect(measureItems('1. Keep WTP 1.\n\n- Feather edges.\n  2) Stop if …\r\n• Last')).toEqual([
      'Keep WTP 1.',
      'Feather edges.',
      'Stop if …',
      'Last',
    ])
    expect(measureItems('   \n')).toEqual([])
  })

  it('is kept on the review as written, and absent when never written', () => {
    expect(parseViaReview({ visualMeasures: 'Keep WTP 1.\nStop if …' })!.visualMeasures).toBe('Keep WTP 1.\nStop if …')
    expect(parseViaReview({})).not.toHaveProperty('visualMeasures')
    expect(parseViaReview({ visualMeasures: 'x'.repeat(5000) })!.visualMeasures).toHaveLength(4000)
  })
})

describe('from the scene', () => {
  const mask = (id: string, geometry: GeoJSON.Polygon, kind: AssessmentMask['kind'] = 'retained'): AssessmentMask => ({
    id,
    name: id,
    kind,
    geometry,
    source: 'Drawn on the plan map',
  })
  const block: TargetPolygon = {
    id: 'b1',
    name: 'PL-1',
    role: 'block',
    objectiveId: 'retention',
    vac: null,
    harvestYear: null,
    clearcutPercent: null,
    geometry: BLOCK,
    source: 'test',
  }
  const landform: TargetPolygon = { ...block, id: 'lf', name: 'North face', role: 'landscape', vac: 'medium' }

  it('places a patch inside, on the boundary or beside the block', () => {
    expect(patchLocation(BLOCK, square(-122.498, 54.002, 0.002))).toBe('inside')
    expect(patchLocation(BLOCK, square(-122.492, 54.002, 0.004))).toBe('boundary')
    expect(patchLocation(BLOCK, square(-122.488, 54.002, 0.002))).toBe('beside')
    // A patch wrapped round the whole block still touches it.
    expect(patchLocation(BLOCK, square(-122.51, 53.99, 0.03))).toBe('boundary')
  })

  it('lists only retention masks in or near the block, and leaves stale figures out', () => {
    const masks = [
      mask('WTP 1', square(-122.498, 54.002, 0.002)),
      mask('Near', square(-122.488, 54.002, 0.002)),
      mask('Far', square(-122.3, 54.002, 0.002)),
      mask('Private', square(-122.498, 54.005, 0.002), 'private'),
    ]
    const assessment = assessVia({ objectiveId: 'retention', result: null, review: { roads: 1 }, blocks: [block] })
    const scene = measuresInputFromScene({
      block,
      masks,
      landform,
      assessment,
      run: 'stale',
      landformDesign: null,
      viewpointName: 'Hwy 16',
    })
    expect(scene.patches.map((p) => [p.name, p.location])).toEqual([
      ['WTP 1', 'inside'],
      ['Near', 'beside'],
    ])
    expect(scene.patches[0].areaHa).toBeCloseTo(2.91, 1)
    expect(scene.objective).toEqual({ id: 'retention', vac: 'medium', landformName: 'North face' })
    expect(scene.figures).toEqual({ run: 'stale', initialPercent: null, adjustedPercent: null })
    expect(scene.roads).toBe(1)
    expect(scene.block.harvestSystem).toBe('clearcut')
  })
})

describe('drawing a wildlife tree patch', () => {
  it('is labelled as one but stored as the retained kind saved scenes already use', () => {
    expect(MASK_LABELS.retained).toBe('Wildlife tree patch / retention')
    const saved = parseMasks([
      { id: 'm1', name: 'Old patch', kind: 'retained', geometry: square(-122.5, 54, 0.001), source: '' },
    ])
    expect(saved[0].kind).toBe('retained')
  })

  it('names, adds and checks a drawn patch through the mask parser', () => {
    const drawn = withDrawnMask([], { id: 'm1', kind: 'retained', geometry: square(-122.5, 54, 0.001) })
    expect(drawn).toEqual([
      {
        id: 'm1',
        name: 'Wildlife tree patch 1',
        kind: 'retained',
        geometry: square(-122.5, 54, 0.001),
        source: 'Drawn on the plan map',
      },
    ])
    expect(nextWildlifeTreePatchName(drawn)).toBe('Wildlife tree patch 2')
    // A renamed earlier patch does not make the next name collide.
    expect(nextWildlifeTreePatchName([{ ...drawn[0], name: 'Wildlife tree patch 2' }])).toBe('Wildlife tree patch 3')
    const full = Array.from({ length: 100 }, (_, i) => ({ ...drawn[0], id: `m${i}` }))
    expect(() => withDrawnMask(full, { id: 'new', kind: 'retained', geometry: square(-122.5, 54, 0.001) })).toThrow(
      'Use at most 100 assessment masks.',
    )
    const flat: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [-122.5, 54],
          [-122.4, 54],
          [-122.5, 54],
          [-122.5, 54],
        ],
      ],
    }
    expect(() => withDrawnMask([], { id: 'm1', kind: 'retained', geometry: flat })).toThrow('invalid geometry')
  })
})
