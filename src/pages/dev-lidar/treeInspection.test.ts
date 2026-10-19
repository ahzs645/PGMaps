import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import proj4 from 'proj4'
import { describe, expect, it, vi } from 'vitest'
import { METRIC_CRS, toMetric } from './sourceGrids'
import type { TreeCrop, TreeIsolation, IsolatedPoint } from './treeIsolation'
import {
  assignPoints,
  DEFAULT_PROFILE,
  emptyInspection,
  inPolygon,
  inProfile,
  pointKey,
  profileCoordinates,
  readInspection,
  sliceOverlay,
  splitBySeeds,
  validSettings,
} from './treeInspection'
import { applyTreeInspectionMap, inspectionPitch } from './treeInspectionMap'
import { TreeInspector } from './TreeInspector'
import { treePointVertices } from './treePointLayer'
import type { TreeInspectionController } from './useTreeInspection'
import { INITIAL_ANALYSIS } from './analysisWorkflows'
import { revealCrown } from './treeInspection'
vi.mock('@/components/ui/virtual-result-list', () => ({ VirtualResultList: () => null }))
const centre = proj4(METRIC_CRS, 'EPSG:4326', [512000, 5971500]) as [number, number]
const point = (east: number, north: number, height = 10, index = 0): IsolatedPoint => {
  const [lon, lat] = proj4(METRIC_CRS, 'EPSG:4326', [512000 + east, 5971500 + north])
  return { lon, lat, height, z: 700 + height, node: '0-0-0-0', index, classification: 1 }
}
const points = [point(-2, 0, 10, 0), point(2, 0.4, 20, 1), point(1, 1.4, 15, 2)]
const crop: TreeCrop = {
  id: 'crown-1',
  source_sha256: 'source',
  centre,
  ground_m: 700,
  points,
  loaded_points: 100,
  loaded_nodes: 2,
  available_nodes: 3,
  budget_limited: true,
  withheld_filtered: false,
}
const data: TreeIsolation = {
  schema_version: 1,
  source_sha256: 'source',
  label_grid_sha256: 'labels',
  input_sha256: { 'dtm-1m.tif': 'terrain' },
  grid: { width: 2, height: 2, bounds: [512000, 5971500, 512002, 5971502], resolution: 1, crs: 'EPSG:3157' },
  crowns: {
    type: 'FeatureCollection',
    features: [1, 2].map((n) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[centre, centre, centre, centre]] },
      properties: {
        id: `crown-${n}`,
        centre,
        centre_utm: [512000, 5971500],
        height_m: 20,
        crown_area_m2: 10,
        ground_support_m: 1,
        edge: false,
        ground_m: 700,
        runs: [[0, 0, 1]],
      },
    })),
  },
}
describe('linked tree inspection and reversible review', () => {
  it('restores pinned candidates outside current height/area/edge filters', () => {
    const options = {
      ...INITIAL_ANALYSIS,
      mode: 'trees' as const,
      treeMinimum: 40,
      treeAreaMinimum: 50,
      treeHideEdge: true,
    }
    const crown = structuredClone(data.crowns.features[0])
    crown.properties.edge = true
    const next = revealCrown(options, crown)
    expect(next.selectedId).toBe('crown-1')
    expect(next.treeMinimum).toBe(20)
    expect(next.treeAreaMinimum).toBe(10)
    expect(next.treeHideEdge).toBe(false)
    expect(next.treeShowPoints).toBe(true)
    expect(options.treeMinimum).toBe(40)
  })
  it('filters metric slices by full width, rotation, offset and height with original point IDs', () => {
    expect(profileCoordinates(points[2], centre, 0).depth).toBeCloseTo(1.4, 4)
    const settings = { ...DEFAULT_PROFILE, mode: 'slice' as const, width: 1 }
    expect(points.filter((p) => inProfile(p, crop, settings)).map(pointKey)).toEqual(['0-0-0-0:0', '0-0-0-0:1'])
    expect(points.filter((p) => inProfile(p, crop, { ...settings, offset: 1.4 }))).toEqual([points[2]])
    expect(points.filter((p) => inProfile(p, crop, { ...settings, angle: 90, width: 2.1 }))).toEqual([points[2]])
    expect(points.filter((p) => inProfile(p, crop, { ...DEFAULT_PROFILE, minHeight: 16 }))).toEqual([points[1]])
    expect(inProfile(points[1], crop, DEFAULT_PROFILE, { [pointKey(points[1])]: '0' })).toBe(false)
    expect(inProfile(points[1], crop, { ...DEFAULT_PROFILE, showRejected: true }, { [pointKey(points[1])]: '0' })).toBe(
      true,
    )
  })
  it('draws the same total-width slice band on the metric map, and clears whole-crown overlays', () => {
    for (const angle of [0, 45, 90, 180]) {
      const ring = sliceOverlay(crop, { ...DEFAULT_PROFILE, mode: 'slice', width: 2, offset: 1, angle }).features[0]
        .geometry.coordinates[0]
      const [a, b] = [ring[0], ring[3]].map((p) => toMetric(p[0], p[1]))
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeCloseTo(2, 3)
      expect(ring[0]).toEqual(ring[4])
    }
    expect(sliceOverlay(crop, DEFAULT_PROFILE).features).toEqual([])
  })
  it('keeps original returns immutable while assigning, rejecting and seed-splitting points', () => {
    const state = emptyInspection(data),
      before = JSON.stringify(crop)
    const edited = assignPoints(state, [pointKey(points[0])], 'edit-crown-1-group')
    expect(state.assignments).toEqual({})
    expect(edited.assignments[pointKey(points[0])]).toBe('edit-crown-1-group')
    const split = splitBySeeds(crop, [points[0], points[1]], points)
    expect(split[0].label).toBe('edit-crown-1-seed-1')
    expect(split[1].label).toBe('edit-crown-1-seed-2')
    expect(split).toHaveLength(points.length)
    expect(JSON.stringify(crop)).toBe(before)
    expect(() => splitBySeeds(crop, [points[0]], points)).toThrow('two seed')
    expect(
      inPolygon(
        [1, 1],
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
        ],
      ),
    ).toBe(true)
    expect(
      inPolygon(
        [3, 1],
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
        ],
      ),
    ).toBe(false)
  })
  it('round-trips bounded reviews, assignments, pins and view settings tied to source and segmentation', () => {
    const state = emptyInspection(data)
    state.pins = ['crown-2']
    state.reviews['crown-1'] = { decision: 'possible structure', note: 'Needs site review' }
    state.assignments[pointKey(points[0])] = 'edit-crown-1-seed-1'
    state.settings = { ...DEFAULT_PROFILE, mode: 'slice', angle: 45, width: 0.5 }
    expect(readInspection(JSON.stringify(state), data)).toEqual(state)
    for (const bad of [
      { ...state, source_sha256: 'other' },
      { ...state, segmentation_sha256: 'other' },
      { ...state, pins: ['crown-99'] },
      { ...state, pins: ['crown-1', 'crown-1'] },
      { ...state, reviews: { 'crown-1': { decision: 'verified', note: '' } } },
      { ...state, assignments: { fake: '0' } },
    ])
      expect(() => readInspection(JSON.stringify(bad), data)).toThrow()
    expect(() => validSettings({ ...DEFAULT_PROFILE, width: 0 })).toThrow()
    expect(() => validSettings({ ...DEFAULT_PROFILE, minHeight: 40, maxHeight: 20 })).toThrow()
    expect(() => validSettings({ ...DEFAULT_PROFILE, angle: NaN })).toThrow()
  })
  it('installs cut and picked-point layers once, updates exact coordinates and clears stale features', () => {
    const sources = new Map<string, { data: unknown; setData: (d: unknown) => void }>(),
      layers = new Map<string, unknown>()
    const map = {
      getSource: (id: string) => sources.get(id),
      getLayer: (id: string) => layers.get(id),
      addSource: (id: string, s: { data: unknown }) => {
        expect(sources.has(id)).toBe(false)
        sources.set(id, {
          data: s.data,
          setData(d) {
            this.data = d
          },
        })
      },
      addLayer: (layer: { id: string }) => {
        expect(layers.has(layer.id)).toBe(false)
        layers.set(layer.id, layer)
      },
    }
    const cut = sliceOverlay(crop, { ...DEFAULT_PROFILE, mode: 'slice' })
    applyTreeInspectionMap(map as never, cut, points[1])
    applyTreeInspectionMap(map as never, cut, points[2])
    expect(layers.size).toBe(4)
    expect(sources.get('tree-inspection-cut')?.data).toBe(cut)
    expect(
      (sources.get('tree-inspection-picked')?.data as { geometry: { coordinates: number[] } }).geometry.coordinates,
    ).toEqual([points[2].lon, points[2].lat])
    applyTreeInspectionMap(map as never, null, null)
    expect((sources.get('tree-inspection-picked')?.data as { features: unknown[] }).features).toEqual([])
    expect(inspectionPitch('top', true)).toBe(0)
    expect(inspectionPitch('3d', true)).toBe(50)
    expect(inspectionPitch(undefined, false)).toBe(0)
  })
  it('highlights the same original point in 3D without moving its geometry', () => {
    const base = treePointVertices(crop),
      picked = treePointVertices(crop, { picked: pointKey(points[1]), colour: 'segment' })
    for (let i = 0; i < crop.points.length; i++)
      expect([...picked.vertices.slice(i * 6, i * 6 + 3)]).toEqual([...base.vertices.slice(i * 6, i * 6 + 3)])
    expect(picked.vertices[9]).toBe(1)
    expect(picked.vertices[10]).toBeCloseTo(0.05)
  })
  it('renders a linked interactive inspector with slices, navigation, provenance, picking and exports', () => {
    const noop = vi.fn(),
      controller = {
        state: emptyInspection(data),
        setState: noop,
        commit: noop,
        undo: noop,
        redo: noop,
        canUndo: false,
        canRedo: false,
        pinned: [],
        message: 'Saved in browser',
        setMessage: noop,
        importReview: noop,
        ready: true,
      } as TreeInspectionController
    const html = renderToStaticMarkup(
      createElement(TreeInspector, {
        controller,
        crop,
        crown: data.crowns.features[0],
        ids: ['crown-1', 'crown-2'],
        error: '',
        status: '',
        onSelect: noop,
        onRetry: noop,
        picked: points[1],
        onPick: noop,
        onTransect: noop,
        transect: null,
      }),
    )
    for (const text of [
      'Linked tree inspector',
      'Find crown by ID',
      'Thin slice',
      'Pick return',
      'Pin for comparison',
      'Download profiles SVG',
      'Export visible CSV',
      'keyboard point inspection',
      'Ground support at top',
      'DBH',
      'Comparison gallery',
      '0-0-0-0:1',
    ])
      expect(html).toContain(text)
    expect(html).not.toMatch(/NaN|Infinity/)
  })
})
