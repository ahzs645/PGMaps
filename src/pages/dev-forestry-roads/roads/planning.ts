/** Portable, bounded network-planning inputs. Results and graph buffers are recomputed after restore. */
import type { Coordinate, RoadProject, ContextFeature } from '../types'
import type { RoadsOptions, RoadsLanding } from './types'
import { assessRoadCondition } from '../roadCondition'
import { MAX_ROADS_CELLS, MAX_ROADS_TARGETS, normalizeRoadsOptions } from './graph'
import { DEFAULT_LOCALE } from '@/lib/format'

export const MAX_NETWORK_CELLS = MAX_ROADS_CELLS
export const MAX_NETWORK_TARGETS = MAX_ROADS_TARGETS
export const MAX_NETWORK_STAGES = 12

export interface NetworkTarget {
  id: string
  name: string
  coordinate: Coordinate
  stage: number
}
export interface ImportedNetworkScenario {
  grid: { origin: [number, number]; cellM: number; width: number; height: number; values: (number | null)[] }
  elevations?: (number | null)[]
  roadCells: number[]
  landings: RoadsLanding[]
  stages?: RoadsLanding[][]
  provenance: string
}
export interface NetworkPlanning {
  mode: 'project' | 'example'
  exampleId: string
  roadIds: string[]
  targets: NetworkTarget[]
  options: RoadsOptions
  cellM: number
  marginM: number
  baseWeight: number
  landingMethod: 'centroid' | 'systematic' | 'random'
  /** Targets per hectare; one interior point per selected block is always attempted. */
  landingDensity: number
  randomSeed: number
  importedScenario?: ImportedNetworkScenario
}

/** Eligibility is a planning assumption, not a claim that a raster establishes legal/haul access. */
export function networkSeedReason(road: ContextFeature): string | null {
  if (road.kind !== 'existing-road' || road.geometry.type !== 'LineString') return 'Select an existing road line.'
  const evidence = road.roadEvidence
  if (!evidence?.reuseAllowed) return 'Enable road reuse after reviewing the existing road.'
  if (evidence.geometryReviewRequired) return 'Review the changed road geometry first.'
  if (
    evidence.condition === 'closed' ||
    evidence.network?.access === 'closed' ||
    evidence.network?.bridgeStatus === 'closed'
  )
    return 'Closed roads or structures cannot seed a proposed network.'
  if (evidence.network?.access === 'permission-required') return 'Resolve the recorded access permission first.'
  const assessment = assessRoadCondition(evidence.observations ?? [], {
    asOf: new Date().toISOString().slice(0, 10),
    policy: evidence.conditionPolicy ?? { maxInspectionAgeDays: null, maxImageryAgeDays: null },
  })
  if (assessment.hasOpenClosureEvidence)
    return 'Resolve recorded road or structure closure evidence before using this source.'
  if (evidence.network?.seasons?.length === 0 || evidence.network?.vehicleClasses?.length === 0)
    return 'The recorded restrictions do not permit use of this source road.'
  return null
}

export function createNetworkPlanning(project?: RoadProject): NetworkPlanning {
  const roadIds = (project?.context ?? []).filter((road) => networkSeedReason(road) === null).map((road) => road.id)
  return {
    mode: 'project',
    exampleId: 'clus-reference',
    roadIds,
    targets: [],
    cellM: Math.max(10, project?.terrain.resolutionM ?? 10),
    marginM: 200,
    baseWeight: 1,
    landingMethod: 'centroid',
    landingDensity: 0.05,
    randomSeed: 42,
    options: {
      method: 'ilcp',
      neighbourhood: 'octagon',
      weightFunction: 'simple',
      roadsInWeight: false,
      roadsConnected: false,
      ordering: 'closest',
      randomSeed: 42,
      grade: { baseCost: 16178, limit: project?.settings.maxGradePercent ?? 20, penalty: 504 },
      preventCornerCutting: true,
      gradeMode: 'terrain',
    },
  }
}

function object(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error(`${label} must be an object.`)
  return raw as Record<string, unknown>
}
function number(raw: unknown, label: string, min: number, max: number, integer = false): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max || (integer && !Number.isInteger(raw)))
    throw Error(`${label} must be ${integer ? 'an integer ' : ''}from ${min} to ${max}.`)
  return raw
}
function text(raw: unknown, label: string, max = 200): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > max) throw Error(`${label} needs 1–${max} characters.`)
  return raw.trim()
}
function choice<T extends string>(raw: unknown, options: readonly T[], label: string): T {
  if (!options.includes(raw as T)) throw Error(`Invalid ${label}.`)
  return raw as T
}
function boolean(raw: unknown, label: string): boolean {
  if (typeof raw !== 'boolean') throw Error(`${label} must be true or false.`)
  return raw
}
function list(raw: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(raw) || raw.length > max) throw Error(`${label} supports at most ${max} entries.`)
  return raw
}
function unique(ids: string[], label: string) {
  if (new Set(ids).size !== ids.length) throw Error(`${label} must have unique IDs.`)
}

function parseImported(raw: unknown): ImportedNetworkScenario {
  const r = object(raw, 'Imported network'),
    g = object(r.grid, 'Network grid')
  const width = number(g.width, 'Grid width', 1, MAX_NETWORK_CELLS, true)
  const height = number(g.height, 'Grid height', 1, MAX_NETWORK_CELLS, true)
  const count = width * height
  if (count > MAX_NETWORK_CELLS)
    throw Error(`Network grids support at most ${MAX_NETWORK_CELLS.toLocaleString(DEFAULT_LOCALE)} cells.`)
  const cells = (raw: unknown, label: string) => {
    const a = list(raw, label, count)
    if (a.length !== count) throw Error(`${label} length must match the grid.`)
    return a.map((v) => (v === null ? null : number(v, label, -1e12, 1e12)))
  }
  const point = list(g.origin, 'Grid origin', 2)
  if (point.length !== 2) throw Error('Grid origin needs two coordinates.')
  const grid = {
    origin: point.map((v) => number(v, 'Grid origin', -1e9, 1e9)) as [number, number],
    cellM: number(g.cellM, 'Grid spacing', 0.1, 10000),
    width,
    height,
    values: cells(g.values, 'Raster values'),
  }
  const landings = (raw: unknown) =>
    list(raw, 'Network targets', MAX_NETWORK_TARGETS).map((entry): RoadsLanding => {
      const t = object(entry, 'Network target')
      return {
        id: text(t.id, 'Target ID', 100),
        ...(t.name === undefined ? {} : { name: text(t.name, 'Target name') }),
        cell: number(t.cell, 'Target cell', -1, count - 1, true),
      }
    })
  const targets = landings(r.landings)
  unique(
    targets.map((t) => t.id),
    'Network targets',
  )
  const stages = r.stages === undefined ? undefined : list(r.stages, 'Network stages', MAX_NETWORK_STAGES).map(landings)
  if (stages) {
    const flat = stages.flat()
    if (flat.length > MAX_NETWORK_TARGETS) throw Error(`A staged run supports at most ${MAX_NETWORK_TARGETS} targets.`)
    unique(
      flat.map((t) => t.id),
      'Staged targets',
    )
    if (
      flat.length !== targets.length ||
      flat.some((t) => !targets.some((other) => t.id === other.id && t.cell === other.cell))
    )
      throw Error('Staged targets must match the scenario target list.')
  }
  return {
    grid,
    roadCells: list(r.roadCells, 'Seed road cells', count).map((c) => number(c, 'Seed road cell', 0, count - 1, true)),
    landings: targets,
    ...(stages ? { stages } : {}),
    ...(r.elevations === undefined ? {} : { elevations: cells(r.elevations, 'Elevations') }),
    provenance: text(r.provenance ?? 'Imported relative-cost raster scenario', 'Scenario provenance', 2000),
  }
}

export function parseNetworkPlanning(raw: unknown): NetworkPlanning {
  const r = object(raw, 'Network planning'),
    defaults = createNetworkPlanning()
  const o = object(r.options, 'Network options'),
    grade = object(o.grade, 'Grade weights')
  const roadIds = list(r.roadIds, 'Seed roads', 500).map((id) => text(id, 'Road ID', 100))
  unique(roadIds, 'Seed roads')
  const targets = list(r.targets, 'Network targets', MAX_NETWORK_TARGETS).map((entry): NetworkTarget => {
    const t = object(entry, 'Network target'),
      c = list(t.coordinate, 'Target coordinate', 2)
    if (c.length !== 2) throw Error('A target needs longitude and latitude.')
    return {
      id: text(t.id, 'Target ID', 100),
      name: text(t.name, 'Target name'),
      coordinate: [number(c[0], 'Target longitude', -180, 180), number(c[1], 'Target latitude', -80, 84)],
      stage: number(t.stage, 'Target stage', 1, MAX_NETWORK_STAGES, true),
    }
  })
  unique(
    targets.map((t) => t.id),
    'Network targets',
  )
  return {
    mode: choice(r.mode, ['project', 'example'], 'network input mode'),
    exampleId: text(r.exampleId, 'Example ID', 100),
    roadIds,
    targets,
    cellM: number(r.cellM, 'Cell size', 0.1, 10000),
    marginM: number(r.marginM, 'Search margin', 0, 20000),
    baseWeight: number(r.baseWeight, 'Base weight', 0.000001, 1e9),
    landingMethod: choice(
      r.landingMethod ?? defaults.landingMethod,
      ['centroid', 'systematic', 'random'],
      'landing method',
    ),
    landingDensity: number(r.landingDensity ?? defaults.landingDensity, 'Landings per hectare', 0.000001, 100),
    randomSeed: number(r.randomSeed ?? defaults.randomSeed, 'Landing seed', 0, 4294967295, true),
    options: {
      method: choice(o.method, ['lcp', 'ilcp', 'mst', 'snap'], 'road method'),
      neighbourhood: choice(o.neighbourhood, ['rook', 'queen', 'octagon'], 'neighbourhood'),
      weightFunction: choice(o.weightFunction, ['simple', 'grade'], 'weight function'),
      roadsInWeight: boolean(o.roadsInWeight, 'Roads in raster'),
      roadsConnected: boolean(o.roadsConnected, 'Connected roads assertion'),
      ordering: choice(o.ordering, ['closest', 'farthest', 'input', 'random'], 'landing order'),
      randomSeed: number(o.randomSeed, 'Routing seed', 0, 4294967295, true),
      grade: {
        baseCost: number(grade.baseCost, 'Grade base weight', 0, 1e12),
        limit: number(grade.limit, 'Grade limit', 0, 1000),
        penalty: number(grade.penalty, 'Grade penalty', 0, 1e12),
        ...(grade.limitWeight === undefined
          ? {}
          : { limitWeight: number(grade.limitWeight, 'Over-limit penalty', 0, 1e12) }),
      },
      preventCornerCutting: boolean(o.preventCornerCutting, 'Prevent corner crossing'),
      gradeMode: choice(o.gradeMode, ['upstream', 'terrain'], 'grade interpretation'),
    },
    ...(r.importedScenario === undefined ? {} : { importedScenario: parseImported(r.importedScenario) }),
  }
}

/** A bundle retains the raster values, not only the controls used to create them. */
export function parseNetworkScenario(raw: unknown): NetworkPlanning {
  const r = object(raw, 'Network scenario')
  if (r.schema !== 'pgmaps-road-network-planning-v1') return parseNetworkPlanning(raw)
  const config = parseNetworkPlanning(r.planning)
  if (!r.input) return config
  const input = object(r.input, 'Scenario input')
  return parseNetworkPlanning({
    ...config,
    options:
      input.options === undefined
        ? config.options
        : normalizeRoadsOptions(object(input.options, 'Imported routing options')),
    mode: 'example',
    exampleId: 'imported',
    importedScenario: {
      ...input,
      stages: r.stages,
      provenance:
        r.provenance ?? 'Imported network scenario (project coordinates retained in file; review independently)',
    },
  })
}
