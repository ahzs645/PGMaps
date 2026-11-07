import { describe, expect, it } from 'vitest'
import {
  FIT_CRS,
  GEOREFERENCE_SCHEMA,
  PIXEL_CONVENTION,
  parseProject,
  serializeProject,
  type GeoreferenceProject,
} from './model'

function project(): GeoreferenceProject {
  return {
    schema: GEOREFERENCE_SCHEMA,
    pixelConvention: PIXEL_CONVENTION,
    fitCrs: FIT_CRS,
    source: {
      id: 'test-sheet',
      url: 'https://example.test/original.png',
      sha256: 'a'.repeat(64),
      width: 2400,
      height: 1600,
      frame: { kind: 'original-image', description: 'Uncropped original pixel grid.' },
    },
    transform: 'similarity',
    points: [{ id: 'A', pixel: [0, 0], coordinate: [-125, 54], role: 'control', enabled: true }],
  }
}

describe('portable georeferencing projects', () => {
  it('round-trips stable explicit frame identity without preserving untrusted fit caches', () => {
    const input = { ...project(), cachedTransform: { approved: true } }
    const serialized = serializeProject(input)
    expect(serializeProject(parseProject(serialized))).toBe(serialized)
    expect(serialized).not.toContain('cachedTransform')
    const parsed = parseProject(serialized)
    expect(parsed.pixelConvention).toBe('pixel-centres-x-right-y-down')
    expect(parsed.points[0].pixel).toEqual([0, 0])
    parsed.points[0].pixel[0] = 100
    expect(input.points[0].pixel[0]).toBe(0)
  })

  it('retains native GeoTIFF identity, dimensions and the original CRS', () => {
    const input = project()
    input.source.frame = {
      kind: 'geotiff-pixel-grid',
      description: 'Native TIFF grid, not preview pixels.',
      crs: 'EPSG:3005',
    }
    input.source.geotiff = { url: 'https://example.test/native.tif', sha256: 'B'.repeat(64) }
    expect(parseProject(input).source.geotiff?.sha256).toBe('b'.repeat(64))
    expect(parseProject(input).source.frame.crs).toBe('EPSG:3005')
  })

  it('allows explicitly unverified local file identity and pixel outer edges', () => {
    const input = project()
    input.source.url = null
    input.source.sha256 = null
    input.points[0].pixel = [-0.5, input.source.height - 0.5]
    expect(parseProject(input).source.url).toBeNull()
    expect(parseProject(input).points[0].pixel).toEqual([-0.5, 1599.5])
  })

  it.each(['schema', 'pixelConvention', 'fitCrs'] as const)('rejects a changed %s convention', (key) => {
    expect(() => parseProject({ ...project(), [key]: 'unknown' })).toThrow()
  })

  it('rejects malformed identity, nonportable URLs and invalid source dimensions', () => {
    for (const update of [
      { sha256: 'missing' },
      { url: 'blob:https://example.test/temporary' },
      { url: 'https://user:password@example.test/file.png' },
      { width: 0 },
      { width: Infinity },
      { height: 20.1 },
      { width: 1_000_001 },
      { frame: { kind: 'unknown', description: 'No frame.' } },
    ]) {
      expect(() => parseProject({ ...project(), source: { ...project().source, ...update } })).toThrow()
    }
  })

  it('rejects nonfinite, out-of-frame and unsupported geographic coordinates', () => {
    for (const update of [
      { pixel: [NaN, 20] },
      { pixel: [-0.51, 20] },
      { pixel: [2400, 20] },
      { coordinate: [-125, 90] },
      { coordinate: [-181, 54] },
      { coordinate: [-125, Infinity] },
      { role: 'verified' },
      { enabled: undefined },
    ]) {
      expect(() => parseProject({ ...project(), points: [{ ...project().points[0], ...update }] })).toThrow()
    }
  })

  it('caps pair counts and requires unique ids, while allowing an unfinished empty project', () => {
    const input = project()
    expect(parseProject({ ...input, points: [] }).points).toEqual([])
    expect(() => parseProject({ ...input, points: [input.points[0], input.points[0]] })).toThrow(/unique/)
    expect(() =>
      parseProject({ ...input, points: Array.from({ length: 101 }, (_, i) => ({ ...input.points[0], id: `${i}` })) }),
    ).toThrow(/100/)
    expect(() => parseProject('{broken')).toThrow(/JSON/)
  })
})
