/** Additive v1 stand fields and capability-based compatibility. No DOM or network access. */
import type { TreeInstance } from './forest'
import type { ScenePackage } from './scenePackage'

export const ACCEPTS_STAND_COMPONENTS = 'stand-components-v1'
export const ACCEPTS_STAND_FIELDS = 'stand-fields-v1'
export const LEGACY_TREE_FIELDS = ['x', 'y', 'z', 'species', 'height', 'crownWidth', 'tone'] as const
export const SCENE_TREE_FIELDS = [...LEGACY_TREE_FIELDS, 'crownBase', 'dbhCm', 'expansion', 'form', 'source'] as const
export const LEGACY_PACKAGE_SPECIES = ['pine', 'spruce', 'fir', 'douglasFir', 'aspen', 'birch'] as const

/** Values appended after the unchanged first seven fields. Crown-base zero is a valid measurement. */
export function treeComponents(tree: TreeInstance): [number, number, number, number, number] {
  return [
    tree.crownBase != null && Number.isFinite(tree.crownBase) ? Math.max(0, Math.min(1, tree.crownBase)) : -1,
    tree.dbhCm != null && Number.isFinite(tree.dbhCm) && tree.dbhCm > 0 ? tree.dbhCm : 0,
    tree.expansion != null && Number.isFinite(tree.expansion) ? Math.max(1, tree.expansion) : 1,
    tree.form === 'young' ? 1 : tree.form === 'shrub' ? 2 : 0,
    tree.source === 'imported' ? 2 : tree.source === 'inventory' ? 1 : 0,
  ]
}

const accepts = (capabilities: unknown, name: string) => Array.isArray(capabilities) && capabilities.includes(name)
const oldSpecies = (name: string): string =>
  name === 'hemlock' ? 'fir' : name === 'blackSpruce' ? 'spruce' : name === 'cottonwood' ? 'aspen' : name

type TreeTable = {
  fields: readonly string[]
  species: readonly string[]
  count: number
  data: ArrayLike<number>
  ids?: string[]
}

function tableForEngine<T extends TreeTable>(table: T, capabilities: unknown): T {
  const components = accepts(capabilities, ACCEPTS_STAND_COMPONENTS)
  const fields = accepts(capabilities, ACCEPTS_STAND_FIELDS)
  if (components && fields) return table
  const names: readonly string[] = components ? table.species : LEGACY_PACKAGE_SPECIES
  const into: readonly string[] = fields ? table.fields : LEGACY_TREE_FIELDS
  const from = into.map((name) => table.fields.indexOf(name))
  const speciesAt = into.indexOf('species')
  const slots = table.species.map((name) => {
    const slot = names.indexOf(oldSpecies(name))
    return slot >= 0 ? slot : 1
  })
  const plain = new Array<number>(table.count * into.length)
  for (let i = 0; i < table.count; i++)
    for (let j = 0; j < into.length; j++) {
      const value = table.data[i * table.fields.length + from[j]]
      plain[i * into.length + j] = j === speciesAt && !components ? (slots[value] ?? 1) : value
    }
  const result = {
    ...table,
    fields: into,
    species: names,
    data: table.data instanceof Float32Array ? Float32Array.from(plain) : plain,
  }
  if (!fields) delete result.ids
  return result as T
}

/** Send modern components only to a consumer that advertises them. The input is never mutated. */
export function sceneForEngine(scene: ScenePackage, capabilities: unknown): ScenePackage {
  if (accepts(capabilities, ACCEPTS_STAND_COMPONENTS) && accepts(capabilities, ACCEPTS_STAND_FIELDS)) return scene
  const components = accepts(capabilities, ACCEPTS_STAND_COMPONENTS)
  const grid = (posts: ScenePackage['terrain']) => {
    if (components || !posts.stand) return posts
    const old = { ...posts }
    delete old.stand
    return old
  }
  const species = components
    ? scene.species
    : Object.fromEntries(LEGACY_PACKAGE_SPECIES.map((name) => [name, scene.species[name]]))
  const models =
    !scene.models || components
      ? scene.models
      : Object.fromEntries(LEGACY_PACKAGE_SPECIES.map((name) => [name, scene.models![name]]))
  return {
    ...scene,
    trees: tableForEngine(scene.trees, capabilities),
    species,
    ...(models ? { models } : {}),
    terrain: grid(scene.terrain),
    ...(scene.farTerrain ? { farTerrain: grid(scene.farTerrain) } : {}),
    ...(scene.skylineTerrain
      ? { skylineTerrain: { ...grid(scene.skylineTerrain), earthCurvature: scene.skylineTerrain.earthCurvature } }
      : {}),
  }
}

/** Final captures use the same negotiated table as their scene, retaining Float32 transfer buffers. */
export function finalStandForEngine<T extends TreeTable>(stand: T, capabilities: unknown): T {
  return tableForEngine(stand, capabilities)
}
