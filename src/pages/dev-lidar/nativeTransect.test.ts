import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import proj4 from 'proj4'
import { describe, expect, it, vi } from 'vitest'
import type { ElevationProfile } from 'maplibre-gl-lidar'
import { NativeTransect, normalizeNativeProfile, startNativeTransect, refreshNativeTransect } from './NativeTransect'
import { METRIC_CRS, type SourceGrid, readSourceGrid } from './sourceGrids'
import type { TreeIsolation } from './treeIsolation'
import { downloadText } from '@/lib/download'
vi.mock('./sourceGrids', async () => ({ ...(await vi.importActual('./sourceGrids')), readSourceGrid: vi.fn() }))
vi.mock('@/lib/download', () => ({ downloadText: vi.fn() }))
const grid: SourceGrid = {
  width: 2,
  height: 1,
  bounds: [512000, 5971500, 512002, 5971501],
  resolution: 1,
  values: new Float32Array([700, -9999]),
  noData: -9999,
}
const coords = proj4(METRIC_CRS, 'EPSG:4326', [512000.5, 5971500.5]) as [number, number]
const missing = proj4(METRIC_CRS, 'EPSG:4326', [512001.5, 5971500.5]) as [number, number]
const profile: ElevationProfile = {
  line: { start: coords, end: missing, bufferDistance: 1 },
  stats: { minElevation: 700, maxElevation: 1000, meanElevation: 710, totalDistance: 1, pointCount: 5 },
  points: [
    { distance: 0, elevation: 710, longitude: coords[0], latitude: coords[1], classification: 1, offsetFromLine: 0 },
    { distance: 1, elevation: 720, longitude: missing[0], latitude: missing[1], classification: 1, offsetFromLine: 0 },
    { distance: 0, elevation: 1000, longitude: coords[0], latitude: coords[1], classification: 1, offsetFromLine: 0 },
    { distance: 0, elevation: 710, longitude: coords[0], latitude: coords[1], classification: 7, offsetFromLine: 0 },
    { distance: 0, elevation: 700, longitude: coords[0], latitude: coords[1], classification: 2, offsetFromLine: 0 },
  ],
}
describe('native GeoLibre transect adapter', () => {
  it('uses half the displayed total width and clears old cuts only for a new drawing', () => {
    const clearCrossSection = vi.fn(),
      enableCrossSection = vi.fn(),
      setCrossSectionBufferDistance = vi.fn(),
      control = { clearCrossSection, enableCrossSection, setCrossSectionBufferDistance }
    startNativeTransect(control, 2)
    expect(clearCrossSection).toHaveBeenCalledOnce()
    expect(enableCrossSection).toHaveBeenCalledOnce()
    expect(setCrossSectionBufferDistance).toHaveBeenLastCalledWith(1)
    refreshNativeTransect(control, 5)
    expect(setCrossSectionBufferDistance).toHaveBeenLastCalledWith(2.5)
    expect(clearCrossSection).toHaveBeenCalledOnce()
    expect(() => startNativeTransect(control, NaN)).toThrow('width')
  })
  it('normalizes source elevations with exact terrain, retains unknown support as null and screens noise', () => {
    const result = normalizeNativeProfile(profile, grid)
    expect(result.map((p) => p.height)).toEqual([10, null, 0])
    expect(result.map((p) => p.z)).toEqual([710, 720, 700])
    expect(profile.points).toHaveLength(5)
  })
  it('exports all screened preview returns with blank missing heights through the interface', async () => {
    vi.mocked(readSourceGrid).mockResolvedValue(grid)
    const onControl = vi.fn()
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        createElement(NativeTransect, {
          profile,
          data: { input_sha256: { 'dtm-1m.tif': 'hash' }, source_sha256: 'source' } as unknown as TreeIsolation,
          base: 'https://example.test/',
          control: { active: true, width: 2, revision: 0 },
          onControl,
        }),
      )
    })
    const button = renderer!.root.findAllByType('button').find((b) => b.children.includes('Export transect CSV'))!
    act(() => button.props.onClick())
    const csv = String(vi.mocked(downloadText).mock.calls.at(-1)![0])
    expect(csv).toContain(',720,,1')
    expect(csv.split('\n')).toHaveLength(4)
    act(() =>
      renderer!.root
        .findByProps({ 'aria-label': 'Native transect total width' })
        .props.onChange({ target: { value: '5' } }),
    )
    expect(onControl).toHaveBeenLastCalledWith({ active: true, width: 5, revision: 0 })
    await act(async () => renderer!.unmount())
  })
})
