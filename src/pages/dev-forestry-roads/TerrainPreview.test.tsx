import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { localRasterResolution } from '../dev-forestry/localRaster'
import type { LocalRaster } from '../dev-forestry/types'
import { TerrainPreview } from './TerrainPreview'
import { analyzeRoad, positionAt } from './engine'
import { parseProject } from './project'
import { createDemoProject, terrainFromMetadata } from './terrain'
import type { TerrainFace } from './TerrainGround'
import type { TerrainVertex } from './terrainMesh'

vi.mock('@pgmaps/geo-toolkit/visualizations/react', () => ({
  ChartViewport: ({ children }: { children: (height: number) => ReactNode }) => children(240),
  SizedChart: ({ children }: { children: (width: number) => ReactNode }) => children(600),
}))
vi.mock('@/components/ui/select', () => ({
  AppSelect: () => createElement('select'),
}))
vi.mock('./TerrainGround', () => ({
  TerrainGround: (props: {
    faces: TerrainFace[]
    overlays: TerrainFace[]
    project: (vertex: TerrainVertex) => { x: number; y: number; depth: number }
    projectionKey: string
    width: number
    height: number
  }) =>
    createElement('g', {
      'data-ground-capture': true,
      projectionKey: props.projectionKey,
      width: props.width,
      height: props.height,
      projectedFaces: props.faces.map((face) => ({ ...face, projected: face.vertices.map(props.project) })),
      projectedOverlays: props.overlays.map((face) => ({ ...face, projected: face.vertices.map(props.project) })),
    }),
}))

let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})

describe('terrain preview infill restoration', () => {
  it('restores identical camera, source geometry and projected faces after follow → infill off → on', async () => {
    const project = createDemoProject()
    const raster: LocalRaster = {
      id: 'terrain-gap-fixture',
      name: 'Synthetic terrain with a known gap',
      kind: 'terrain',
      epsg: 4326,
      origin: [-122.731, 53.907],
      pixelSize: [0.0002, -0.0002],
      width: 211,
      height: 116,
      values: Array.from({ length: 211 * 116 }, (_, i) => 700 + (i % 211) * 0.01),
      acquired: '',
      verticalReference: 'Synthetic metres',
      sha256: 'a'.repeat(64),
    }
    const coordinate = positionAt(project.alignments[0], 200).coordinate
    const col = Math.floor((coordinate[0] - raster.origin[0]) / raster.pixelSize[0]),
      row = Math.floor((coordinate[1] - raster.origin[1]) / raster.pixelSize[1])
    for (let r = row - 1; r <= row + 1; r++)
      for (let c = col - 1; c <= col + 1; c++) raster.values[r * raster.width + c] = null
    const smallGap = positionAt(project.alignments[0], 600).coordinate
    raster.values[
      Math.floor((smallGap[1] - raster.origin[1]) / raster.pixelSize[1]) * raster.width +
        Math.floor((smallGap[0] - raster.origin[0]) / raster.pixelSize[0])
    ] = null
    project.terrain = {
      kind: 'geotiff',
      name: raster.name,
      epsg: raster.epsg,
      resolutionM: localRasterResolution(raster, raster.origin[1]),
      verticalReference: raster.verticalReference,
      sha256: raster.sha256,
      raster,
    }
    const parsed = parseProject(project)
    const terrain = terrainFromMetadata(parsed.terrain)!
    const analysis = analyzeRoad(parsed.alignments[0], terrain, parsed.settings, parsed.context)
    const view = (station: number) => createElement(TerrainPreview, { terrain, analysis, station, onStation: vi.fn() })
    await act(async () => {
      renderer = create(view(200))
    })
    await act(async () => renderer!.update(view(600)))
    await act(async () =>
      renderer!.root
        .findAllByType('button')
        .find((button) => button.children.includes('Follow station'))!
        .props.onClick(),
    )
    const capture = () => renderer!.root.findByProps({ 'data-ground-capture': true }).props
    const preview = () => renderer!.root.findByProps({ 'data-testid': 'road-terrain-preview' }).props
    const filled = capture()
    const filledCount = preview()['data-infilled-cells']
    expect(filledCount).toBeGreaterThan(0)
    expect(filled.projectedFaces.some((face: TerrainFace) => face.estimated)).toBe(true)
    const toggle = () => renderer!.root.findByProps({ 'aria-label': 'Fill small gaps in 3D display' }).props.onClick()
    await act(async () => toggle())
    expect(preview()['data-infilled-cells']).toBe(0)
    expect(capture().projectedFaces.every((face: TerrainFace) => !face.estimated)).toBe(true)
    expect(capture().projectedFaces.length).toBeLessThan(filled.projectedFaces.length)
    await act(async () => toggle())
    const restored = capture()
    expect(preview()['data-infilled-cells']).toBe(filledCount)
    expect(restored.width).toBe(filled.width)
    expect(restored.height).toBe(filled.height)
    expect(restored.projectionKey).toBe(filled.projectionKey)
    expect(restored.projectedFaces).toEqual(filled.projectedFaces)
    expect(restored.projectedOverlays).toEqual(filled.projectedOverlays)
  })
})
