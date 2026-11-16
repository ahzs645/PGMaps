import { describe, expect, it } from 'vitest'
import { placeTrees, type InventoryStand } from '../forest'
import { metersPerDegree } from '../visibility'
import { DEFAULT_PRESCRIPTION, applyPrescription } from './prescription'
import { prescribedCells, treatedStems, treatmentTints } from './prescribedCells'
import { STAND_SEED, STAND_SPACING_METERS, buildStand, buildStandFromImport, type StandImportTree } from './standTrees'

const ANCHOR = 53.9
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

/** A measured stand: a 7 m lattice of trees, some outside the block, a few with diameters and species. */
function importedTrees(): StandImportTree[] {
  const scale = metersPerDegree(53.9)
  const trees: StandImportTree[] = []
  for (let y = -10; y < 210; y += 7)
    for (let x = -10; x < 210; x += 7)
      trees.push({
        id: `T${trees.length}`,
        lng: -122.8 + x / scale.lng,
        lat: 53.9 + y / scale.lat,
        heightMeters: 15 + ((x + y) % 20),
        crownWidthMeters: x % 3 === 0 ? null : 4,
        dbhCm: x % 5 === 0 ? 30 : null,
        species: y % 2 === 0 ? 'pine' : null,
      })
  return trees
}

const imported = () =>
  buildStandFromImport({ geometry: BLOCK, trees: importedTrees(), inventory: [], anchorLatitude: ANCHOR }).stand!

describe('a stand from an imported tree list', () => {
  it('keeps the trees inside the block as measured, each its own identity', () => {
    const stand = imported()
    expect(stand.source).toBe('imported')
    expect(stand.trees.length).toBeGreaterThan(500)
    expect(stand.trees.every((tree) => tree.key < 0 && tree.expansion === 1)).toBe(true)
    expect(new Set(stand.trees.map((tree) => tree.key)).size).toBe(stand.trees.length)
    expect(stand.trees.filter((tree) => tree.dbhCm === 30).length).toBeGreaterThan(0)
    expect(stand.trees.every((tree) => tree.dbhCm > 0 && tree.crownWidthMeters > 0)).toBe(true)
  })

  it('carries a crown base, where the list gives one, to the drawn stem as a share of height', () => {
    const trees = importedTrees().map((tree, i) => ({
      ...tree,
      crownBaseMeters: i % 2 ? tree.heightMeters * 0.7 : null,
    }))
    const stand = buildStandFromImport({ geometry: BLOCK, trees, inventory: [], anchorLatitude: ANCHOR }).stand!
    const withBase = stand.trees.filter((tree) => tree.crownBaseMeters !== undefined)
    expect(withBase.length).toBeGreaterThan(0)
    expect(withBase.length).toBeLessThan(stand.trees.length)
    const drawn = prescribedCells(
      stand,
      applyPrescription(stand, { ...DEFAULT_PRESCRIPTION, target: { kind: 'stemShare', value: 100 } }),
    ).replace!
    const bases = drawn.filter((tree) => tree.crownBase !== undefined).map((tree) => tree.crownBase!)
    expect(bases.length).toBe(withBase.length)
    for (const base of bases) expect(base).toBeCloseTo(0.7, 6)
    // A list without crown bases draws every stem as the species drawing has it.
    const plain = prescribedCells(imported(), applyPrescription(imported(), DEFAULT_PRESCRIPTION)).replace!
    expect(plain.some((tree) => tree.crownBase !== undefined)).toBe(false)
  })

  it('takes missing species from the recorded stand and sizes missing diameters to VRI', () => {
    const recorded: InventoryStand = {
      geometry: BLOCK,
      species: null,
      heightMeters: 22,
      speciesMix: [{ species: 'aspen', share: 1 }],
      quadMeanDiameterCm: 18,
    }
    const stand = buildStandFromImport({
      geometry: BLOCK,
      trees: importedTrees().map((tree) => ({ ...tree, dbhCm: null })),
      inventory: [recorded],
      anchorLatitude: ANCHOR,
    }).stand!
    expect(new Set(stand.trees.map((tree) => tree.species))).toEqual(new Set(['pine', 'aspen']))
    expect(stand.diameterSource).toBe('vri')
    const squares = stand.trees.reduce((sum, tree) => sum + tree.dbhCm * tree.dbhCm, 0)
    expect(Math.sqrt(squares / stand.trees.length)).toBeCloseTo(18, 1)
  })

  it('is drawn in place of the grid stems, kept trees only after harvest, all of them marked before', () => {
    const stand = imported()
    const result = applyPrescription(stand, { ...DEFAULT_PRESCRIPTION, target: { kind: 'stemShare', value: 40 } })
    const grow = (cells: ReturnType<typeof prescribedCells>) =>
      placeTrees({
        stands: [],
        clearings: [],
        centre: { lng: -122.7985, lat: 53.9009 },
        radiusMeters: 400,
        spacingMeters: STAND_SPACING_METERS,
        maxTrees: 1_000_000,
        seed: STAND_SEED,
        anchorLatitude: ANCHOR,
        thinnings: [{ geometry: BLOCK, keepFraction: 1, prescribed: cells }],
      })
    const drawn = buildStand({
      geometry: BLOCK,
      stands: [],
      clearings: [],
      inventory: [],
      anchorLatitude: ANCHOR,
    }).stand!
    const all = grow(prescribedCells(stand, result)).length
    const empty = placeTrees({
      stands: [],
      clearings: [],
      centre: { lng: -122.7985, lat: 53.9009 },
      radiusMeters: 400,
      spacingMeters: STAND_SPACING_METERS,
      maxTrees: 1_000_000,
      seed: STAND_SEED,
      anchorLatitude: ANCHOR,
    }).length
    const kept = stand.trees.length - result.removed.reduce((sum, flag) => sum + flag, 0)
    // Outside the block the grid stands; inside, exactly the kept imported trees.
    expect(all).toBe(empty - drawn.trees.length + kept)
    const marked = grow(
      prescribedCells(stand, result, { markOnly: true, tints: treatmentTints(stand, result, 'before') }),
    )
    expect(marked.length).toBe(empty - drawn.trees.length + stand.trees.length)
    expect(marked.filter((tree) => tree.tint).length).toBe(stand.trees.length - kept)
  })
})

describe('snags', () => {
  it('leaves the largest trees taken standing dead, topped, instead of felled', () => {
    const stand = buildStand({
      geometry: BLOCK,
      stands: [],
      clearings: [],
      inventory: [],
      anchorLatitude: ANCHOR,
    }).stand!
    const result = applyPrescription(stand, {
      ...DEFAULT_PRESCRIPTION,
      outcome: 'felled',
      target: { kind: 'stemShare', value: 50 },
      snags: { perHa: 5, heightMeters: 6, yearsAfterHarvest: 0 },
    })
    const snags = result.snags.reduce((sum, flag) => sum + flag, 0)
    expect(snags).toBe(Math.round(5 * stand.areaHa))
    expect(result.counts.snags).toBe(snags)
    result.snags.forEach((flag, i) => {
      if (flag) expect(result.removed[i]).toBe(1)
    })
    const largestTaken = Math.max(
      ...stand.trees.filter((_, i) => result.removed[i] && !result.snags[i]).map((t) => t.dbhCm),
    )
    stand.trees.forEach((tree, i) => {
      if (result.snags[i]) expect(tree.dbhCm).toBeGreaterThanOrEqual(largestTaken)
    })
    const stems = treatedStems(stand, result, 'felled', 6)
    expect(stems.snag.length).toBe(snags)
    expect(stems.snag.every((stem) => stem.heightMeters <= 6)).toBe(true)
    expect(stems.felled.length + snags).toBe(result.removed.reduce((sum, flag) => sum + flag, 0))
  })
})
