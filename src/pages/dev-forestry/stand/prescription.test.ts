import { describe, expect, it } from 'vitest'
import { placeTrees, stemCell, stemCellKey, stemGridSteps, type InventoryStand } from '../forest'
import {
  DEFAULT_PRESCRIPTION,
  KEPT,
  applyPrescription,
  parsePrescription,
  type StandPrescription,
} from './prescription'
import { prescribedCells, treatedStems, treatmentTints } from './prescribedCells'
import { ICO_CLASSES, readClumps, summarizeStand } from './standMetrics'
import { STAND_SEED, STAND_SPACING_METERS, buildStand, polygonAreaHa, type Stand } from './standTrees'

const ANCHOR = 53.9
// About 200 m × 200 m at 53.9° N.
const BLOCK: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-122.8, 53.9],
      [-122.797, 53.9],
      [-122.797, 53.9018],
      [-122.8, 53.9018],
      [-122.8, 53.9],
    ],
  ],
}

function stand(inventory: InventoryStand[] = []): Stand {
  const built = buildStand({ geometry: BLOCK, stands: [], clearings: [], inventory, anchorLatitude: ANCHOR })
  if (!built.stand) throw new Error(built.error)
  return built.stand
}

const prescription = (patch: Partial<StandPrescription>): StandPrescription => ({ ...DEFAULT_PRESCRIPTION, ...patch })

describe('buildStand', () => {
  it('reads the near band’s stems in the block, one identity each, the same every time', () => {
    const a = stand()
    const b = stand()
    expect(a.trees.length).toBeGreaterThan(1000)
    expect(new Set(a.trees.map((tree) => tree.key)).size).toBe(a.trees.length)
    expect(b.trees.map((tree) => tree.key)).toEqual(a.trees.map((tree) => tree.key))
    expect(b.trees.map((tree) => tree.dbhCm)).toEqual(a.trees.map((tree) => tree.dbhCm))
    // Regional stand: 550 stems/ha.
    const summary = summarizeStand(a.trees, a.areaHa)
    expect(summary.stemsPerHa).toBeGreaterThan(450)
    expect(summary.stemsPerHa).toBeLessThan(650)
    expect(a.areaHa).toBeCloseTo(polygonAreaHa(BLOCK), 6)
    expect(a.areaHa).toBeGreaterThan(3.5)
    expect(a.areaHa).toBeLessThan(4.5)
    expect(a.diameterSource).toBe('curve')
  })

  it('sizes diameters to VRI’s quadratic mean diameter and counts dense stands by expansion', () => {
    const recorded: InventoryStand = {
      geometry: BLOCK,
      species: 'spruce',
      heightMeters: 22,
      stemsPerHa: 1400,
      crownClosurePercent: 50,
      quadMeanDiameterCm: 21,
    }
    const s = stand([recorded])
    const summary = summarizeStand(s.trees, s.areaHa)
    expect(summary.quadMeanDiameterCm).toBeCloseTo(21, 1)
    expect(summary.stemsPerHa).toBeGreaterThan(1250)
    expect(summary.stemsPerHa).toBeLessThan(1550)
    expect(s.diameterSource).toBe('vri')
    expect(s.maxExpansion).toBeGreaterThan(2)
  })

  it('refuses a block too large to read tree by tree', () => {
    const huge: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [-123, 53],
          [-122.9, 53],
          [-122.9, 53.1],
          [-123, 53.1],
          [-123, 53],
        ],
      ],
    }
    const built = buildStand({ geometry: huge, stands: [], clearings: [], inventory: [], anchorLatitude: 53 })
    expect(built.stand).toBeNull()
    expect(built.error).toMatch(/too large/)
  })
})

describe('applyPrescription: dispersed', () => {
  it('thins from below to a basal-area share, taking the smallest stems first', () => {
    const s = stand()
    const result = applyPrescription(s, prescription({ target: { kind: 'basalAreaShare', value: 60 } }))
    expect(result.reached).toBe(true)
    expect(result.target.reached).toBeCloseTo(60, 0)
    expect(result.removedBasalAreaPercent).toBeCloseTo(40, 0)
    const removed = s.trees.filter((_, i) => result.removed[i]).map((tree) => tree.dbhCm)
    const kept = s.trees.filter((_, i) => !result.removed[i]).map((tree) => tree.dbhCm)
    expect(Math.max(...removed)).toBeLessThanOrEqual(Math.min(...kept))
    // Taking small stems takes more stems than basal area.
    expect(result.removedStemsPercent).toBeGreaterThan(result.removedBasalAreaPercent)
  })

  it('thins from above, and proportionally keeps the diameters’ shape', () => {
    const s = stand()
    const above = applyPrescription(s, prescription({ order: 'fromAbove', target: { kind: 'stemShare', value: 70 } }))
    expect(above.target.reached).toBeCloseTo(70, 0)
    expect(above.summaries.retained.quadMeanDiameterCm).toBeLessThan(above.summaries.before.quadMeanDiameterCm)
    const even = applyPrescription(s, prescription({ order: 'proportional', target: { kind: 'stemShare', value: 50 } }))
    expect(even.summaries.retained.quadMeanDiameterCm).toBeCloseTo(even.summaries.before.quadMeanDiameterCm, -1)
  })

  it('follows the block’s recorded share, and says when it had to assume one', () => {
    const s = stand()
    const recorded = applyPrescription(s, DEFAULT_PRESCRIPTION, { harvestSystem: 'partial', volumeRemovedPercent: 30 })
    expect(recorded.target.asked).toBe(70)
    expect(recorded.assumedBlockShare).toBe(false)
    const assumed = applyPrescription(s, DEFAULT_PRESCRIPTION, { harvestSystem: 'partial' })
    expect(assumed.assumedBlockShare).toBe(true)
    const retention = applyPrescription(s, DEFAULT_PRESCRIPTION, { harvestSystem: 'retention', retentionPercent: 15 })
    expect(retention.target.reached).toBeCloseTo(15, 0)
  })

  it('reaches stems and SDI targets', () => {
    const s = stand()
    const stems = applyPrescription(s, prescription({ target: { kind: 'stems', value: 300 } }))
    expect(stems.summaries.retained.stemsPerHa).toBeCloseTo(300, -1)
    const sdi = applyPrescription(s, prescription({ target: { kind: 'sdi', value: 200 } }))
    expect(sdi.summaries.retained.standDensityIndex).toBeLessThanOrEqual(205)
    expect(sdi.summaries.retained.standDensityIndex).toBeGreaterThan(190)
  })

  it('cuts nothing when the stand is already below the target', () => {
    const s = stand()
    const result = applyPrescription(s, prescription({ target: { kind: 'stems', value: 5000 } }))
    expect(result.removed.every((flag) => flag === 0)).toBe(true)
    expect(result.message).toMatch(/already/)
  })

  it('never cuts protected trees or trees over the diameter limit, and says when they hold the stand above target', () => {
    const s = stand()
    const protectedKeys = s.trees.slice(0, 20).map((tree) => tree.key)
    const result = applyPrescription(
      s,
      prescription({ target: { kind: 'basalAreaShare', value: 10 }, diameterLimitCm: 25, protectedKeys }),
    )
    s.trees.forEach((tree, i) => {
      if (protectedKeys.includes(tree.key) || tree.dbhCm >= 25) expect(result.removed[i]).toBe(0)
    })
    expect(result.counts.protected).toBe(20)
    expect(result.reached).toBe(false)
    expect(result.message).toMatch(/still above the target/)
  })

  it('cuts only the species it may', () => {
    const recorded: InventoryStand = {
      geometry: BLOCK,
      species: null,
      heightMeters: 24,
      speciesMix: [
        { species: 'pine', share: 0.5 },
        { species: 'spruce', share: 0.5 },
      ],
    }
    const s = stand([recorded])
    const result = applyPrescription(
      s,
      prescription({ target: { kind: 'stemShare', value: 60 }, species: { mode: 'only', ids: ['pine'] } }),
    )
    s.trees.forEach((tree, i) => {
      if (result.removed[i]) expect(tree.species).toBe('pine')
    })
    expect(result.counts.notRemovable).toBeGreaterThan(0)
  })

  it('leaves some marked trees standing below full marking efficiency, the same ones for the same seed', () => {
    const s = stand()
    const p = prescription({ target: { kind: 'stemShare', value: 50 }, markingEfficiency: 0.8 })
    const a = applyPrescription(s, p)
    const b = applyPrescription(s, p)
    expect(a.counts.missed).toBeGreaterThan(0)
    expect(Array.from(a.removed)).toEqual(Array.from(b.removed))
    expect(a.keptBecause.filter((reason) => reason === KEPT.missed).length).toBe(a.counts.missed)
    const c = applyPrescription(s, { ...p, seed: 2 })
    expect(Array.from(c.removed)).not.toEqual(Array.from(a.removed))
  })
})

describe('applyPrescription: grouped', () => {
  it('keeps clumps to a basal-area target, favouring large stems', () => {
    const s = stand()
    const result = applyPrescription(
      s,
      prescription({ pattern: 'grouped', target: { kind: 'basalAreaShare', value: 30 } }),
    )
    expect(result.target.reached).toBeGreaterThanOrEqual(29.5)
    expect(result.target.reached).toBeLessThan(33)
    // Groups, not an even thinning: the retained stems sit in clumps of more than one.
    expect(result.clumps.retained.meanClumpSize).toBeGreaterThan(2)
    expect(result.clumps.retained.shares.slice(1).reduce((a, b) => a + b, 0)).toBeGreaterThan(0.5)
    // Larger stems are favoured: the stand left is bigger on average than the stand.
    expect(result.summaries.retained.quadMeanDiameterCm).toBeGreaterThan(result.summaries.before.quadMeanDiameterCm)
  })

  it('moves the retained clump sizes toward the target distribution', () => {
    const s = stand()
    const small = applyPrescription(
      s,
      prescription({
        pattern: 'grouped',
        target: { kind: 'basalAreaShare', value: 25 },
        clumpTargets: [0.6, 0.4, 0, 0, 0],
      }),
    )
    const large = applyPrescription(
      s,
      prescription({
        pattern: 'grouped',
        target: { kind: 'basalAreaShare', value: 25 },
        clumpTargets: [0, 0, 0, 0.3, 0.7],
      }),
    )
    expect(small.clumps.retained.meanClumpSize).toBeLessThan(large.clumps.retained.meanClumpSize)
  })

  it('says when the trees it must keep already pass the target', () => {
    const s = stand()
    const result = applyPrescription(
      s,
      prescription({ pattern: 'grouped', target: { kind: 'basalAreaShare', value: 10 }, diameterLimitCm: 20 }),
    )
    expect(result.message).toMatch(/must keep already/)
    expect(result.target.reached).toBeGreaterThan(10)
  })
})

describe('the drawing', () => {
  it('draws after harvest exactly the stand’s kept stems on its own grid', () => {
    const s = stand()
    const result = applyPrescription(s, prescription({ target: { kind: 'stemShare', value: 40 } }))
    const cells = prescribedCells(s, result)
    const steps = stemGridSteps(STAND_SPACING_METERS, ANCHOR)
    const grown = placeTrees({
      stands: [],
      clearings: [],
      centre: { lng: -122.7985, lat: 53.9009 },
      radiusMeters: 400,
      spacingMeters: STAND_SPACING_METERS,
      maxTrees: 1_000_000,
      seed: STAND_SEED,
      anchorLatitude: ANCHOR,
      thinnings: [{ geometry: BLOCK, keepFraction: 0.4, prescribed: cells }],
    })
    const keys = new Set(grown.map((tree) => stemCellKey(...stemCell(tree.lng, tree.lat, steps))))
    s.trees.forEach((tree, i) => expect(keys.has(tree.key)).toBe(!result.removed[i]))
    // Kept trees stand at their own height, not a residual height.
    const byKey = new Map(grown.map((tree) => [stemCellKey(...stemCell(tree.lng, tree.lat, steps)), tree]))
    const kept = s.trees.find((_, i) => !result.removed[i])!
    expect(byKey.get(kept.key)?.heightMeters).toBeCloseTo(kept.heightMeters, 9)
  })

  it('thins coarser bands by the share kept around each stem, and marks without cutting before harvest', () => {
    const s = stand()
    const result = applyPrescription(s, prescription({ target: { kind: 'stemShare', value: 30 } }))
    const cells = prescribedCells(s, result)
    const share = cells.shareAt(-122.7985, 53.9009, 2000)
    expect(share).toBeCloseTo(1 - result.removed.reduce((sum, flag) => sum + flag, 0) / s.trees.length, 6)
    const coarse = (prescribed: typeof cells) =>
      placeTrees({
        stands: [],
        clearings: [],
        centre: { lng: -122.7985, lat: 53.9009 },
        radiusMeters: 400,
        spacingMeters: 9,
        maxTrees: 1_000_000,
        seed: 2,
        anchorLatitude: ANCHOR,
        thinnings: [{ geometry: BLOCK, keepFraction: 1, prescribed }],
      }).length
    const all = placeTrees({
      stands: [],
      clearings: [],
      centre: { lng: -122.7985, lat: 53.9009 },
      radiusMeters: 400,
      spacingMeters: 9,
      maxTrees: 1_000_000,
      seed: 2,
      anchorLatitude: ANCHOR,
    }).length
    const thinned = coarse(cells)
    expect(thinned).toBeLessThan(all)
    const marked = prescribedCells(s, result, { markOnly: true, tints: treatmentTints(s, result, 'before') })
    expect(coarse(marked)).toBe(all)
  })

  it('draws the treatment colours on the stems they name, and only a colour', () => {
    const s = stand()
    const result = applyPrescription(s, prescription({ target: { kind: 'stemShare', value: 50 } }))
    const grow = (tints?: ReturnType<typeof treatmentTints>) =>
      placeTrees({
        stands: [],
        clearings: [],
        centre: { lng: -122.7985, lat: 53.9009 },
        radiusMeters: 400,
        spacingMeters: STAND_SPACING_METERS,
        maxTrees: 1_000_000,
        seed: STAND_SEED,
        anchorLatitude: ANCHOR,
        thinnings: [{ geometry: BLOCK, keepFraction: 1, prescribed: prescribedCells(s, result, { tints }) }],
      })
    const plain = grow()
    const coloured = grow(treatmentTints(s, result, 'after'))
    expect(coloured.length).toBe(plain.length)
    expect(coloured.map(({ tint: _tint, ...tree }) => tree)).toEqual(plain)
    expect(coloured.filter((tree) => tree.tint).length).toBe(s.trees.length - result.removed.reduce((a, b) => a + b, 0))
  })

  it('colours marked trees before harvest and kept ones after', () => {
    const s = stand()
    const result = applyPrescription(s, prescription({ target: { kind: 'stemShare', value: 50 } }))
    const before = treatmentTints(s, result, 'before')
    const after = treatmentTints(s, result, 'after')
    const removed = result.removed.reduce((sum, flag) => sum + flag, 0)
    expect(before.size).toBe(removed)
    expect(after.size).toBe(s.trees.length - removed)
  })

  it('leaves a stump for every tree taken, and a felled stem or log by the outcome', () => {
    const s = stand()
    const result = applyPrescription(
      s,
      prescription({ target: { kind: 'stemShare', value: 50 }, fellingBearingDegrees: 90, fellingSpreadDegrees: 0 }),
    )
    const removed = result.removed.reduce((sum, flag) => sum + flag, 0)
    const hauled = treatedStems(s, result, 'hauled')
    expect(hauled.stump.length).toBe(removed)
    expect(hauled.felled.length + hauled.log.length).toBe(0)
    const felled = treatedStems(s, result, 'felled')
    expect(felled.felled.length).toBe(removed)
    expect(felled.felled.every((stem) => stem.headingDegrees === 90)).toBe(true)
    expect(treatedStems(s, result, 'limbed').log.length).toBe(removed)
  })
})

describe('clumps and saved prescriptions', () => {
  it('joins trees nearer than the clump distance, through each other', () => {
    const trees = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 30, y: 0 },
    ]
    const reading = readClumps(trees, 6)
    expect(Array.from(reading.sizes)).toEqual([3, 3, 3, 1])
    expect(reading.clumpCount).toBe(2)
    expect(reading.shares[0]).toBeCloseTo(0.25)
    expect(reading.shares[1]).toBeCloseTo(0.75)
    expect(reading.meanClumpSize).toBeCloseTo(2.5)
    expect(reading.shares.length).toBe(ICO_CLASSES.length)
  })

  it('reads a saved prescription back, and falls back field by field', () => {
    const saved = prescription({
      pattern: 'grouped',
      target: { kind: 'sdi', value: 250 },
      protectedKeys: [stemCellKey(1, 2)],
      species: { mode: 'except', ids: ['aspen'] },
    })
    expect(parsePrescription(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
    expect(parsePrescription({ pattern: 'nonsense', markingEfficiency: 3 })).toMatchObject({
      pattern: 'dispersed',
      markingEfficiency: 1,
    })
    expect(parsePrescription(null)).toBeNull()
  })
})
