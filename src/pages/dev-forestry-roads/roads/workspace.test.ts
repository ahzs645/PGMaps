import { describe, expect, it } from 'vitest'
import { createDemoProject, demoTerrain, localMetricGrid } from '../terrain'
import { parseProject, serializeProject } from '../project'
import type { ContextFeature } from '../types'
import { normalizeRoadsOptions } from './graph'
import { prepExData } from './examples'
import { projectRoads } from './projectRoads'
import { runNetworkStages } from './stages'
import { createNetworkPlanning, networkSeedReason, parseNetworkPlanning, parseNetworkScenario } from './planning'
import {
  networkOverlay,
  networkPathAlignment,
  networkGridCsv,
  prepareNetworkScenario,
  serializeNetworkScenario,
  generateNetworkTargets,
} from './workspace'

function projectFixture() {
  const project = createDemoProject()
  const points = project.alignments[0].points
  const road: ContextFeature = {
    id: 'reviewed-seed',
    name: 'Synthetic reviewed access',
    kind: 'existing-road',
    geometry: { type: 'LineString', coordinates: points.slice(0, 2).map((p) => p.coordinate) },
    roadEvidence: { source: 'scenario', condition: 'serviceable', conditionBasis: 'assumed', reuseAllowed: true },
  }
  project.context = [road]
  const planning = createNetworkPlanning(project)
  planning.cellM = 30
  planning.marginM = 60
  planning.targets = [{ id: 'target-1', name: 'Upland landing', coordinate: points.at(-1)!.coordinate, stage: 1 }]
  project.networkPlanning = planning
  return { project, planning, road }
}

describe('network workspace contracts', () => {
  it('retains bounded inputs through the existing project parser and excludes graph caches', () => {
    const { project, planning } = projectFixture()
    const restored = parseProject(JSON.parse(serializeProject(project)))
    expect(restored.networkPlanning).toEqual(planning)
    expect(JSON.stringify(restored.networkPlanning)).not.toContain('neighbours')
    expect(() => parseNetworkPlanning({ ...planning, targets: [...planning.targets, ...planning.targets] })).toThrow(
      /unique/,
    )
    expect(() => parseNetworkPlanning({ ...planning, cellM: NaN })).toThrow(/Cell size/)
  })

  it('uses an actual local metre grid, routes on the selected terrain and creates an editable unsmoothed alignment', async () => {
    const { project, planning } = projectFixture()
    const prepared = await prepareNetworkScenario(project, demoTerrain, planning)
    const result = runNetworkStages(prepared.input, prepared.stages)
    expect(prepared.epsg).toBe(32610)
    expect(result.targets[0].status).toBe('connected')
    expect(networkOverlay(prepared, result).features.some((f) => f.geometry.type === 'LineString')).toBe(true)
    const adopted = networkPathAlignment(prepared, result.paths[0], project.alignments[0].template)
    expect(adopted.points.length).toBeGreaterThanOrEqual(2)
    expect(adopted.points.every((point) => point.radiusM === 0)).toBe(true)
    expect(adopted.vertical).toEqual([])
    const validate = parseProject({
      ...project,
      alignments: [...project.alignments, adopted],
      activeAlignmentId: adopted.id,
    })
    expect(validate.activeAlignmentId).toBe(adopted.id)
    expect(networkGridCsv(prepared, result)).toContain('seed_road,projected_road')
  })

  it('retains custom raster weights, no-data holes, targets, stages and routing options in scenario round trips', async () => {
    const { project, planning } = projectFixture()
    const example = prepExData('staged-harvest')
    const configured = {
      ...planning,
      mode: 'example' as const,
      exampleId: example.id,
      options: normalizeRoadsOptions(example.input.options),
    }
    const prepared = await prepareNetworkScenario(project, demoTerrain, configured)
    prepared.input.grid.values[8] = NaN
    prepared.input.grid.values[12] = 98.5
    const result = runNetworkStages(prepared.input, prepared.stages)
    const parsed = parseNetworkScenario(JSON.parse(serializeNetworkScenario(prepared, [result])))
    const reopened = await prepareNetworkScenario(project, demoTerrain, parsed)
    expect(Array.from(reopened.input.grid.values)).toEqual(Array.from(prepared.input.grid.values))
    expect(reopened.input.options).toEqual(prepared.input.options)
    expect(reopened.stages).toEqual(prepared.stages)
    expect(runNetworkStages(reopened.input, reopened.stages).targets).toEqual(result.targets)
    expect(reopened.canAdopt).toBe(false)
  })

  it('cannot place a local-coordinate example into an unrelated map or design', async () => {
    const { project, planning } = projectFixture()
    const example = prepExData('clus-reference')
    const prepared = await prepareNetworkScenario(project, demoTerrain, {
      ...planning,
      mode: 'example',
      exampleId: example.id,
      options: normalizeRoadsOptions(example.input.options),
    })
    const result = projectRoads(prepared.input)
    expect(networkOverlay(prepared, result).features).toEqual([])
    expect(() => networkPathAlignment(prepared, result.paths[0], project.alignments[0].template)).toThrow(
      /Local-coordinate/,
    )
  })

  it('uses recorded computation options rather than conflicting editor settings on import', async () => {
    const { project, planning } = projectFixture(),
      example = prepExData('clus-reference')
    const prepared = await prepareNetworkScenario(project, demoTerrain, {
      ...planning,
      mode: 'example',
      exampleId: example.id,
      options: normalizeRoadsOptions(example.input.options),
    })
    const raw = JSON.parse(serializeNetworkScenario(prepared, []))
    raw.planning.options.roadsInWeight = false
    raw.planning.options.neighbourhood = 'rook'
    const restored = parseNetworkScenario(raw)
    expect(restored.options.roadsInWeight).toBe(true)
    expect(restored.options.neighbourhood).toBe('queen')
  })

  it('enforces project terrain and corner rules even after importing upstream experiment settings', async () => {
    const { project, planning } = projectFixture()
    planning.options.gradeMode = 'upstream'
    planning.options.preventCornerCutting = false
    const prepared = await prepareNetworkScenario(project, demoTerrain, planning)
    expect(prepared.input.options).toMatchObject({ gradeMode: 'terrain', preventCornerCutting: true })
    expect(prepared.planning.options).toEqual(prepared.input.options)
  })

  it('does not permit a reviewed road to reopen a hard exclusion cell', async () => {
    const { project, planning } = projectFixture()
    const p = project.alignments[0].points[0].coordinate
    const projection = localMetricGrid(p),
      xy = projection.toGrid(p)
    const ring = [
      [-80, -80],
      [80, -80],
      [80, 80],
      [-80, 80],
      [-80, -80],
    ].map(([x, y]) => projection.toLonLat([xy[0] + x, xy[1] + y]))
    project.context.push({
      id: 'hard',
      name: 'Hard no-build mask',
      kind: 'avoid',
      geometry: { type: 'Polygon', coordinates: [ring] },
    })
    const prepared = await prepareNetworkScenario(project, demoTerrain, planning)
    for (const cell of prepared.input.roadCells) expect(Number.isFinite(prepared.input.grid.values[cell])).toBe(true)
    expect(prepared.input.grid.values.some((v) => Number.isNaN(v))).toBe(true)
  })

  it('rejects oversize grids explicitly instead of silently changing the requested resolution', async () => {
    const { project, planning } = projectFixture()
    await expect(
      prepareNetworkScenario(project, demoTerrain, { ...planning, cellM: 0.1, marginM: 20000 }),
    ).rejects.toThrow(/limit.*cells|cells.*limit/)
  })

  it('rejects invalid and oversized imported arrays before allocation', () => {
    const planning = createNetworkPlanning()
    expect(() =>
      parseNetworkPlanning({
        ...planning,
        importedScenario: { grid: { origin: [0, 0], cellM: 1, width: 1000, height: 1000, values: [] } },
      }),
    ).toThrow(/250,000/)
    expect(() =>
      parseNetworkPlanning({
        ...planning,
        importedScenario: {
          grid: { origin: [0, 0], cellM: 1, width: 2, height: 2, values: [1] },
          roadCells: [0],
          landings: [],
        },
      }),
    ).toThrow(/length/)
  })

  it('blocks unreviewed, closed and unresolved historical closure evidence from seed selection', async () => {
    const { project, planning, road } = projectFixture()
    road.roadEvidence!.reuseAllowed = false
    expect(networkSeedReason(road)).toMatch(/reviewing/)
    road.roadEvidence!.reuseAllowed = true
    road.roadEvidence!.observations = [
      {
        id: 'closure',
        source: 'inspection',
        component: 'bridge',
        observedAt: '2020-01-01',
        sourceUrl: 'https://example.org/inspection',
        notes: 'Synthetic test',
        finding: 'closed',
        review: { reviewer: 'Test', reviewedAt: '2020-01-02' },
      },
    ]
    expect(networkSeedReason(road)).toMatch(/closure evidence/)
    await expect(prepareNetworkScenario(project, demoTerrain, planning)).rejects.toThrow(/closure evidence/)
  })

  it('honours cancellation before terrain sampling or worker dispatch', async () => {
    const { project, planning } = projectFixture(),
      controller = new AbortController()
    controller.abort()
    await expect(
      prepareNetworkScenario(project, demoTerrain, planning, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('generates reproducible covered landings inside harvest areas', async () => {
    const { project, planning } = projectFixture()
    const point = project.alignments[0].points[3].coordinate,
      projection = localMetricGrid(point),
      [x, y] = projection.toGrid(point)
    const ring = [
      [-40, -40],
      [40, -40],
      [40, 40],
      [-40, 40],
      [-40, -40],
    ].map(([dx, dy]) => projection.toLonLat([x + dx, y + dy]))
    project.context.push({
      id: 'block',
      name: 'Test harvest',
      kind: 'harvest',
      geometry: { type: 'Polygon', coordinates: [ring] },
    })
    const first = await generateNetworkTargets(project, demoTerrain, planning)
    expect(first.length).toBeGreaterThan(0)
    expect(await generateNetworkTargets(project, demoTerrain, planning)).toEqual(first)
    expect(first.every((t) => Number.isFinite(demoTerrain.elevationAt(...t.coordinate)))).toBe(true)
  })
})
