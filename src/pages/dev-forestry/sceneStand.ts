/** Resolved distant stand palettes, sampled through the native inventory/thinning priorities. */
import {
  DEFAULT_SPECIES_MIX,
  REGIONAL_STAND,
  TALL_SHRUB_STAND,
  type InventoryStand,
  type Thinning,
  type TreeInstance,
  type TreeSpeciesId,
} from './forest'
import { boxedPolygonLookup, type CanopyGrid, type CanopyInputs } from './sceneCover'

export type SceneStandRecord = {
  heightMeters: number
  species: Array<{ species: string; share: number; heightMeters?: number }>
  source: 'regional' | 'inventory' | 'imported'
}
export type SceneStandGrid = { cells: number[]; records: SceneStandRecord[] }

/** The optional palette is external file data too: reject invalid references before an adapter samples it. */
export function validStandGrid(value: unknown, posts: number): value is SceneStandGrid {
  const grid = value as Partial<SceneStandGrid> | null
  if (!grid || !Array.isArray(grid.cells) || grid.cells.length !== posts || !Array.isArray(grid.records)) return false
  const records = grid.records
  if (grid.cells.some((slot) => !Number.isInteger(slot) || slot < -1 || slot >= records.length)) return false
  return records.every((record) => {
    if (
      !record ||
      !Number.isFinite(record.heightMeters) ||
      record.heightMeters <= 0 ||
      !['regional', 'inventory', 'imported'].includes(record.source) ||
      !Array.isArray(record.species)
    )
      return false
    return (
      record.species.length > 0 &&
      record.species.every(
        (entry) =>
          typeof entry.species === 'string' &&
          entry.species.length > 0 &&
          Number.isFinite(entry.share) &&
          entry.share >= 0 &&
          (entry.heightMeters === undefined || (Number.isFinite(entry.heightMeters) && entry.heightMeters > 0)),
      ) &&
      record.species.reduce((sum, entry) => sum + entry.share, 0) > 0
    )
  })
}

/** One resolved stand, before the native generator's per-stem height and crown variation. */
function resolvedStand(
  surveyed: InventoryStand | null,
  thinned: Thinning | null,
  height: number,
): SceneStandRecord | null {
  const replacement = thinned?.prescribed?.replace
  if (replacement) return importedStand(replacement)
  if (surveyed?.cover && surveyed.cover !== 'shrubTall') return null
  if (surveyed?.cover === 'shrubTall')
    return {
      heightMeters: TALL_SHRUB_STAND.heightMeters,
      species: [{ species: 'aspen', share: 1, heightMeters: TALL_SHRUB_STAND.heightMeters }],
      source: 'inventory',
    }
  const mix: ReadonlyArray<{ species: TreeSpeciesId; share: number; heightMeters?: number | null }> = surveyed
    ?.speciesMix?.length
    ? surveyed.speciesMix
    : surveyed?.species
      ? [{ species: surveyed.species, share: 1 }]
      : DEFAULT_SPECIES_MIX
  const residualHeight = thinned?.prescribed ? null : thinned?.heightMeters
  const regenerated = Math.max(0, Math.min(1, surveyed?.regenerationFraction ?? 1))
  const species = mix.flatMap((entry) => {
    const own = entry.heightMeters
    const h = residualHeight ?? regenerated * (own ?? surveyed?.heightMeters ?? height) + (1 - regenerated) * height
    return entry.share > 0 && h > 0 ? [{ species: entry.species, share: entry.share, heightMeters: h }] : []
  })
  const share = species.reduce((sum, entry) => sum + entry.share, 0)
  if (!(share > 0)) return null
  for (const entry of species) entry.share /= share
  return {
    heightMeters: species.reduce((sum, entry) => sum + entry.heightMeters * entry.share, 0),
    species,
    source: surveyed ? 'inventory' : 'regional',
  }
}

/** Imported crowns share one resolved palette record per prescribed block, not an invented stem map. */
function importedStand(trees: ReadonlyArray<TreeInstance>): SceneStandRecord | null {
  const kinds = new Map<string, { area: number; height: number }>()
  let total = 0
  for (const tree of trees) {
    if (!(tree.heightMeters > 0)) continue
    const weight = Math.max(0.001, (tree.heightMeters * tree.slenderness) ** 2)
    const held = kinds.get(tree.species) ?? { area: 0, height: 0 }
    held.area += weight
    held.height += weight * tree.heightMeters
    kinds.set(tree.species, held)
    total += weight
  }
  if (!total) return null
  const species = [...kinds].map(([species, held]) => ({
    species,
    share: held.area / total,
    heightMeters: held.height / held.area,
  }))
  return {
    heightMeters: species.reduce((sum, entry) => sum + entry.heightMeters * entry.share, 0),
    species,
    source: 'imported',
  }
}

/**
 * A compact palette beside each canopy grid. -1 means no known standing forest at this post.
 * Numeric fallback closure remains explicitly regional, while missing ground never becomes a stand.
 */
export function standOnGrid(
  grid: CanopyGrid & { canopy?: ReadonlyArray<number | null> },
  toLngLat: (x: number, y: number) => [number, number],
  inputs: CanopyInputs,
): SceneStandGrid {
  const { west, south, columns, rows, spacing } = grid
  const [w, s] = toLngLat(west, south)
  const [e, n] = toLngLat(west + (columns - 1) * spacing, south + (rows - 1) * spacing)
  const box: [number, number, number, number] = [Math.min(w, e), Math.min(s, n), Math.max(w, e), Math.max(s, n)]
  const buckets = Math.min(64, Math.max(1, Math.round(Math.max(columns, rows) / 8)))
  const inventory = inputs.inventory ?? [],
    thinnings = inputs.thinnings ?? []
  const surveyedAt = boxedPolygonLookup(
    inventory.map((stand) => stand.geometry),
    box,
    buckets,
  )
  const thinnedAt = boxedPolygonLookup(
    thinnings.map((thinning) => thinning.geometry),
    box,
    buckets,
  )
  const palette = new Map<number, number>()
  const records: SceneStandRecord[] = []
  const cells = new Array<number>(columns * rows).fill(-1)
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column
      if (grid.heights[index] == null || (grid.canopy && !(Number(grid.canopy[index]) > 0))) continue
      const [lng, lat] = toLngLat(west + column * spacing, south + row * spacing)
      const own = surveyedAt(lng, lat),
        thinning = thinnedAt(lng, lat)
      const key = (own + 1) * (thinnings.length + 1) + (thinning + 1)
      let slot = palette.get(key)
      if (slot === undefined) {
        const record = resolvedStand(
          inventory[own] ?? null,
          thinnings[thinning] ?? null,
          inputs.heightMeters ?? REGIONAL_STAND.heightMeters,
        )
        slot = record ? records.push(record) - 1 : -1
        palette.set(key, slot)
      }
      cells[index] = slot
    }
  return { cells, records }
}
