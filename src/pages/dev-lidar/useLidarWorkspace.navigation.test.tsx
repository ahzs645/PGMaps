import { useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useLidarWorkspace } from './useLidarWorkspace'
import { emptyInspection } from './treeInspection'
import type { AnalysisSummary, RasterKey } from './types'
import type { TreeIsolation } from './treeIsolation'

const source = vi.hoisted(() => ({
  summary: null as AnalysisSummary | null,
  tree: null as TreeIsolation | null,
  mobile: false,
}))
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => source.mobile }))
vi.mock('./useLidarSummary', () => ({
  useLidarSummary: () => ({ summary: source.summary, error: '', retrySummary: vi.fn() }),
}))
vi.mock('./useWorkflowData', () => ({
  useWorkflowData: () => ({ data: null, error: '', retry: vi.fn() }),
}))
vi.mock('./useTreeIsolation', () => ({
  useTreeIsolation: () => ({ data: source.tree, error: '', retry: vi.fn() }),
  useTreeCrop: () => ({ crop: null, error: '', status: '', retry: vi.fn() }),
}))
vi.mock('./useTreeInspection', () => ({
  useTreeInspection: () => ({ state: emptyInspection(), pinned: [] }),
}))

const summary: AnalysisSummary = {
  source_points: 100,
  source_sha256: 'test-source',
  observed_area_ha: 1,
  supported_area_ha: 1,
  ground_supported_percent: 100,
  tree_candidate_count: 1,
  building_candidate_count: 0,
  elevated_area_percent: 20,
  elevated_first_return_cover_percent: 20,
  height_stats_m: { median: 10, p95: 20, max: 25 },
  elevated_surface_height_stats_m: { median: 10, p95: 20 },
  tree_detection_sensitivity: [],
  return_height_profile: { bins_m: [], counts: [] },
  limitations: [],
  bounds_wgs84: [-123, 53, -122, 54],
  image_coordinates: [
    [-123, 54],
    [-122, 54],
    [-122, 53],
    [-123, 53],
  ],
  rasters: Object.fromEntries(
    ['height', 'terrain', 'slope', 'cover', 'crowns', 'support'].map((key) => [
      key,
      {
        file: `${key}.png`,
        title: key,
        min: 0,
        max: 100,
        unit: 'm',
        colors: ['#ffffff', '#000000'],
      },
    ]),
  ) as AnalysisSummary['rasters'],
  sample_grid: { file: 'samples.bin', width: 1, height: 1, bounds_mercator: [0, 0, 1, 1] },
  highlights: [],
  downloads: [],
}
const tree: TreeIsolation = {
  schema_version: 1,
  source_sha256: 'test-source',
  input_sha256: {},
  label_grid_sha256: 'test-labels',
  grid: { width: 1, height: 1, bounds: [0, 0, 1, 1], resolution: 1, crs: 'EPSG:3157' },
  crowns: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-122.8, 53.9],
              [-122.79, 53.9],
              [-122.8, 53.91],
              [-122.8, 53.9],
            ],
          ],
        },
        properties: {
          id: 'tree-1',
          height_m: 20,
          crown_area_m2: 10,
          ground_support_m: 1,
          edge: false,
          centre: [-122.8, 53.9],
          centre_utm: [0, 0],
          ground_m: 700,
          runs: [[0, 0, 1]],
        },
      },
    ],
  },
}
let renderer: ReactTestRenderer | undefined
let current: ReturnType<typeof useLidarWorkspace>
let navigate: ReturnType<typeof useNavigate>
let path: string
function Harness() {
  const controller = useLidarWorkspace({
    analysisBase: 'https://example.test/analysis/',
    cloudBase: 'https://example.test/cloud/',
  })
  const routerNavigate = useNavigate(),
    location = useLocation()
  useEffect(() => {
    current = controller
    navigate = routerNavigate
    path = location.pathname + location.search
  })
  return null
}
function content(initial: string) {
  return (
    <MemoryRouter initialEntries={[initial]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Harness />
    </MemoryRouter>
  )
}
beforeEach(() => {
  source.summary = summary
  source.tree = tree
  source.mobile = false
  vi.stubGlobal('document', { title: '' })
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
  vi.unstubAllGlobals()
})

it('focuses an initial tree only after source readiness and retains the chosen camera afterward', async () => {
  source.summary = null
  source.tree = null
  await act(async () => {
    renderer = create(content('/dev/lidar/trees/'))
  })
  expect(current.focus.revision).toBe(0)
  source.summary = summary
  source.tree = tree
  await act(async () => {
    renderer!.update(content('/dev/lidar/trees/'))
  })
  expect(current.analysisOptions.mode).toBe('trees')
  expect(current.focus).toMatchObject({ center: [-122.8, 53.9], zoom: 20, revision: 1 })
  expect(current.sceneGround).toBe(700)
  const camera = { index: -1, revision: 9, center: [-122.7, 53.8] as [number, number], zoom: 18 }
  await act(async () => {
    current.setFocus(camera)
    current.setTreeView('3d')
    current.setAnalysisOptions((previous) => ({ ...previous, treeMinimum: 6 }))
  })
  expect(current.focus).toBe(camera)
  await act(async () => {
    navigate('/dev/lidar/canopy/')
  })
  await act(async () => {
    navigate('/dev/lidar/trees/')
  })
  expect(current.focus).toBe(camera)
})

it('remembers each analysis and the last mode of each tool without resetting the camera on route changes', async () => {
  await act(async () => {
    renderer = create(content('/dev/lidar/canopy/'))
  })
  expect(current.analysisOptions.mode).toBe('canopy-height')
  await act(async () => {
    current.setAnalysisOptions((previous) => ({ ...previous, heatOpacity: 0.31, heightDetail: false }))
  })
  await act(async () => {
    current.startAnalysis('canopy-density')
  })
  expect(current.analysisOptions.mode).toBe('canopy-density')
  await act(async () => {
    current.setAnalysisOptions((previous) => ({ ...previous, threshold: 5 }))
  })
  const camera = { index: -1, revision: 11, center: [-122.6, 53.7] as [number, number], zoom: 17 }
  await act(async () => {
    current.setFocus(camera)
    current.openTool('forestry')
  })
  expect(current.tool?.id).toBe('forestry')
  await act(async () => {
    current.openTool('canopy')
  })
  expect(path).toBe('/dev/lidar/canopy/?view=canopy-density')
  expect(current.analysisOptions).toMatchObject({ mode: 'canopy-density', threshold: 5, heatOpacity: 0.31 })
  expect(current.focus).toBe(camera)
  await act(async () => {
    current.startAnalysis('canopy-height')
  })
  expect(current.analysisOptions).toMatchObject({
    mode: 'canopy-height',
    threshold: 2,
    heatOpacity: 0.31,
    heightDetail: false,
  })
  expect(current.focus).toBe(camera)
})

it('keeps browser-history navigation, transect width, raster actions and mobile panel behavior available', async () => {
  source.mobile = true
  await act(async () => {
    renderer = create(content('/dev/lidar/transects/'))
  })
  expect(current.transectControl.active).toBe(true)
  expect(current.cloud).toBe(true)
  await act(async () => {
    current.setTransectControl((previous) => ({ ...previous, width: 6 }))
  })
  await act(async () => {
    current.openTool('canopy')
  })
  expect(current.transectControl).toMatchObject({ active: false, width: 6 })
  await act(async () => {
    navigate(-1)
  })
  expect(current.tool?.id).toBe('transects')
  expect(current.transectControl).toMatchObject({ active: true, width: 6 })
  await act(async () => {
    current.setPanelOpen(true)
    current.selectRaster('terrain' as RasterKey)
  })
  expect(current.raster).toBe('terrain')
  expect(current.surfaceVisible).toBe(true)
  expect(current.cloud).toBe(false)
  expect(current.panelOpen).toBe(false)
})
