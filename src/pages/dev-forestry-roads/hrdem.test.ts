import { afterEach, describe, expect, it, vi } from 'vitest'
import { fromArrayBuffer } from 'geotiff'
import { detailWindow, makeDemBoxes, hrdemGeoTiff, loadHrdemArea, projectDetailAreas, demBoxesGeoJson } from './hrdem'
import { roadProjection, createDemoProject, terrainFromMetadata } from './terrain'
import { nearbyFsrBounds } from './detailFsr'

afterEach(() => vi.unstubAllGlobals())

describe('NRCan 1 m detail areas', () => {
  it('makes separate buffered native-grid boxes, without covering the space between distant features', () => {
    const project = createDemoProject()
    project.alignments = []
    project.context = [
      {
        id: 'a',
        name: 'Block A',
        kind: 'harvest',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-122.7, 53.9],
              [-122.699, 53.9],
              [-122.699, 53.901],
              [-122.7, 53.9],
            ],
          ],
        },
      },
      {
        id: 'b',
        name: 'Road B',
        kind: 'existing-road',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-121.7, 54.2],
            [-121.699, 54.201],
          ],
        },
      },
    ]
    const boxes = projectDetailAreas(project).map((a) => ({ ...a, window: detailWindow(a.coordinates, 100) }))
    expect(boxes).toHaveLength(2)
    expect(boxes.every((b) => b.window.problem === null && b.window.width < 400)).toBe(true)
    expect(nearbyFsrBounds(boxes)).toHaveLength(2)
    expect(demBoxesGeoJson(boxes).features.map((f) => f.properties.name)).toEqual(['Block A', 'Road B'])
  })

  it('tiles a larger block into native boxes within the read budget, with no lost cells', () => {
    const coordinates: [number, number][] = [
      [-122.72, 53.89],
      [-122.68, 53.89],
      [-122.68, 53.92],
      [-122.72, 53.92],
    ]
    const whole = detailWindow(coordinates, 100)
    const boxes = makeDemBoxes([{ id: 'block', name: 'Block', coordinates }], 100)
    expect(whole.problem).not.toBeNull()
    expect(boxes.length).toBeGreaterThan(1)
    expect(boxes.every((b) => b.window.problem === null && b.window.width * b.window.height <= 4_194_304)).toBe(true)
    expect(boxes.reduce((n, b) => n + b.window.width * b.window.height, 0)).toBe(whole.width * whole.height)
  })

  it('refuses a large box before contacting the catalogue', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const window = detailWindow(
      [
        [-122.7, 53.9],
        [-122.6, 54],
      ],
      100,
    )
    expect(window.problem).toContain('Pick one block or road')
    await expect(loadHrdemArea(window, new AbortController().signal)).rejects.toThrow('million')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('range-reads only native cells and keeps their heights, no-data, CRS and datum through save and GeoTIFF export', async () => {
    const window = detailWindow([[-122.72, 53.89]], 2)
    const values = Float32Array.from({ length: window.width * window.height }, (_, i) => (i ? 600.125 + i / 8 : -32767))
    const bytes = await hrdemGeoTiff({
      id: 'test',
      name: 'Native fixture',
      kind: 'terrain',
      epsg: 3979,
      width: window.width,
      height: window.height,
      origin: [window.bbox[0] + 0.5, window.bbox[3] - 0.5],
      pixelSize: [1, -1],
      values: Array.from(values, (v) => (v === -32767 ? null : v)),
      verticalReference: 'CGVD2013',
      acquired: '',
      sha256: 'a'.repeat(64),
    })
    const requests: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/stac/'))
          return Response.json({
            features: [
              {
                id: 'tile',
                properties: { 'proj:epsg': 3979 },
                assets: {
                  dtm: { href: 'https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-mosaic-1m/test-dtm.tif' },
                },
              },
            ],
          })
        const range = new Headers(init?.headers).get('Range')!
        requests.push(range)
        const match = /bytes=(\d+)-(\d+)/.exec(range)!
        const first = Number(match[1]),
          last = Math.min(bytes.byteLength - 1, Number(match[2]))
        return new Response(bytes.slice(first, last + 1), {
          status: 206,
          headers: {
            'content-length': String(last - first + 1),
            'content-range': `bytes ${first}-${last}/${bytes.byteLength}`,
          },
        })
      }),
    )
    const loaded = await loadHrdemArea(window, new AbortController().signal)
    expect(requests.length).toBeGreaterThan(0)
    expect(loaded.metadata.raster?.values).toEqual(Array.from(values, (v) => (v === -32767 ? null : v)))
    expect(loaded.metadata.resolutionM).toBe(1)
    expect(loaded.metadata.verticalReference).toContain('CGVD2013')
    const restored = JSON.parse(JSON.stringify(loaded.metadata))
    const sampler = terrainFromMetadata(restored)!
    const at = roadProjection(3979).inverse([window.bbox[0] + 2.5, window.bbox[3] - 2.5])
    expect(sampler.elevationAt(at[0], at[1])).toBeCloseTo(values[2 * window.width + 2], 5)
    const output = await (await fromArrayBuffer(await hrdemGeoTiff(loaded.metadata.raster!))).getImage()
    expect(output.getGeoKeys().ProjectedCSTypeGeoKey).toBe(3979)
    expect(output.getGeoKeys().VerticalCSTypeGeoKey).toBe(6647)
    expect(output.getGDALNoData()).toBe(-32767)
    expect(Array.from((await output.readRasters({ interleave: true })) as Float32Array)).toEqual(Array.from(values))
  })
})

it.skipIf(!process.env.PGMAPS_HRDEM_LIVE)(
  'reads a small real 1 m NRCan window near Prince George',
  async () => {
    const loaded = await loadHrdemArea(detailWindow([[-122.72, 53.89]], 20), new AbortController().signal)
    expect(loaded.coveragePercent).toBeGreaterThan(90)
    expect(loaded.source.elevationAt(-122.72, 53.89)).toBeGreaterThan(600)
  },
  90_000,
)
