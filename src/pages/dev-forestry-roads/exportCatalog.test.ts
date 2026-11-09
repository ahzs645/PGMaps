import { describe, expect, it } from 'vitest'
import {
  csvPreview,
  EXPORT_ITEMS,
  exportUnavailable,
  fitGeometry,
  geoJsonPreview,
  parseCsv,
  textPreview,
  type ExportContext,
} from './exportCatalog'

const ready: ExportContext = {
  designPreview: false,
  hasResults: true,
  terrainProfile: false,
  hasTerrainGrid: true,
  hasProvincialEvidence: true,
  hasNotes: true,
}

describe('export catalog', () => {
  it('lists every output once', () => {
    const kinds = EXPORT_ITEMS.map((item) => item.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
  })

  it('always offers the project file, and says why anything else is unavailable', () => {
    const blocked = { ...ready, designPreview: true, hasResults: false }
    expect(exportUnavailable('project', blocked)).toBeNull()
    expect(exportUnavailable('csv', blocked)).toMatch(/design preview/)
    expect(exportUnavailable('csv', { ...ready, hasResults: false })).toMatch(/No calculated results/)
    expect(exportUnavailable('plotbook', { ...ready, terrainProfile: true })).toMatch(/Return to the road/)
    expect(exportUnavailable('report', { ...ready, terrainProfile: true })).toBeNull()
    expect(exportUnavailable('terrain-ascii', { ...ready, hasTerrainGrid: false })).toMatch(/terrain grid/)
    expect(exportUnavailable('provincial-evidence', { ...ready, hasProvincialEvidence: false })).toMatch(/provincial/)
    expect(exportUnavailable('notes', { ...ready, designPreview: true, hasResults: false })).toBeNull()
    expect(exportUnavailable('notes', { ...ready, hasNotes: false })).toMatch(/Draw a note/)
    for (const item of EXPORT_ITEMS) expect(exportUnavailable(item.kind, ready)).toBeNull()
  })
})

describe('previews', () => {
  it('reads quoted CSV fields, doubled quotes and CRLF line ends', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\r\n').rows).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ])
  })

  it('keeps the header and counts every data row, though it shows only the first ones', () => {
    const csv = ['station,ground', ...Array.from({ length: 100 }, (_, i) => `${i},${800 + i}`)].join('\n')
    const preview = csvPreview(csv)
    expect(preview).toMatchObject({ type: 'table', header: ['station', 'ground'], total: 100 })
    if (preview.type === 'table') expect(preview.rows.length).toBe(40)
  })

  it('shows the start of a long text file and reports its full size', () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')
    const preview = textPreview(text)
    expect(preview).toMatchObject({ type: 'text', lines: 200, bytes: text.length })
    if (preview.type === 'text') expect(preview.text.split('\n').length).toBe(80)
  })

  it('groups GeoJSON geometry by feature kind', () => {
    const preview = geoJsonPreview({
      features: [
        {
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
          properties: { kind: 'road' },
        },
        { geometry: { type: 'Point', coordinates: [0, 0] }, properties: { kind: 'station' } },
        {
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [0, 1],
                [0, 0],
              ],
            ],
          },
          properties: null,
        },
      ],
    })
    expect(preview.type === 'geometry' && preview.layers.map((l) => [l.name, l.points.length, l.lines.length])).toEqual(
      [
        ['road', 0, 1],
        ['station', 1, 0],
        ['Polygon', 0, 1],
      ],
    )
  })

  it('fits geometry inside the box with north up', () => {
    const project = fitGeometry(
      [
        {
          name: 'road',
          points: [],
          lines: [
            [
              [-122, 54],
              [-121.99, 54.01],
            ],
          ],
        },
      ],
      200,
      100,
    )!
    const [a, b] = [project([-122, 54]), project([-121.99, 54.01])]
    for (const [x, y] of [a, b]) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(200)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(100)
    }
    expect(b[1]).toBeLessThan(a[1])
  })
})
