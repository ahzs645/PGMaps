import { NativeSelect } from '@/components/ui/form-field'
import { useEffect, useState } from 'react'
import type { ElevationProfile, LidarControl } from 'maplibre-gl-lidar'
import { Button } from '@/components/ui/button'
import { downloadText } from '@/lib/download'
import { readSourceGrid, sourceCell, sourceValue, toMetric } from './sourceGrids'
import type { TreeIsolation } from './treeIsolation'
import type { SourceGrid } from './sourceGrids'
export function startNativeTransect(
  control: Pick<LidarControl, 'clearCrossSection' | 'enableCrossSection' | 'setCrossSectionBufferDistance'>,
  totalWidth: number,
) {
  if (!Number.isFinite(totalWidth) || totalWidth <= 0) throw Error('Invalid transect width')
  control.clearCrossSection()
  control.enableCrossSection()
  control.setCrossSectionBufferDistance(totalWidth / 2)
}
export function refreshNativeTransect(
  control: Pick<LidarControl, 'setCrossSectionBufferDistance'>,
  totalWidth: number,
) {
  if (!Number.isFinite(totalWidth) || totalWidth <= 0) throw Error('Invalid transect width')
  control.setCrossSectionBufferDistance(totalWidth / 2)
}
export function normalizeNativeProfile(profile: ElevationProfile, grid: SourceGrid) {
  return profile.points.flatMap((p) => {
    if (
      [7, 12, 18].includes(p.classification ?? -1) ||
      ![p.longitude, p.latitude, p.elevation, p.distance].every(Number.isFinite)
    )
      return []
    const [x, y] = toMetric(p.longitude, p.latitude),
      ground = sourceValue(grid, sourceCell(grid, x, y)),
      height = ground === null ? null : p.elevation - ground
    if (height !== null && (height < -0.5 || height > 80)) return []
    return [
      {
        distance: p.distance,
        height,
        lon: p.longitude,
        lat: p.latitude,
        z: p.elevation,
        classification: p.classification ?? -1,
      },
    ]
  })
}
export interface TransectControl {
  active: boolean
  width: number
  revision: number
  refresh?: number
}
export function NativeTransect({
  profile,
  data,
  base,
  control,
  onControl,
}: {
  profile: ElevationProfile | null
  data: TreeIsolation | null
  base: string
  control: TransectControl
  onControl: (c: TransectControl) => void
}) {
  const [normalized, setNormalized] = useState<ReturnType<typeof normalizeNativeProfile>>([]),
    [error, setError] = useState('')
  useEffect(() => {
    setNormalized([])
    setError('')
    if (!profile || !data) return
    let active = true
    readSourceGrid(base, 'dtm-1m.tif', data.input_sha256['dtm-1m.tif'])
      .then((grid) => {
        if (!active) return
        setNormalized(normalizeNativeProfile(profile, grid))
      })
      .catch((e) => {
        if (active) setError(String(e))
      })
    return () => {
      active = false
    }
  }, [profile, data, base])
  const maximum = Math.max(
      5,
      normalized.reduce((m, p) => Math.max(m, p.height ?? 0), 0),
    ),
    length = profile?.stats.totalDistance ?? 1
  const supported = normalized.filter((p) => p.height !== null && Number.isFinite(p.height))
  const stride = Math.max(1, Math.ceil(supported.length / 50000)),
    shown = supported.filter((_, i) => i % stride === 0)
  return (
    <div className="space-y-3 p-3 text-xs">
      <p>
        Draw two endpoints on the map using GeoLibre’s native cross-section tool. The full cloud streams while this tab
        is open; crown selection pauses.
      </p>
      <label className="block">
        Total transect width
        <NativeSelect
          className="ml-2 rounded border bg-background p-1"
          aria-label="Native transect total width"
          value={control.width}
          onChange={(e) => onControl({ ...control, width: +e.target.value })}
        >
          {[1, 2, 5, 10, 20, 40].map((n) => (
            <option key={n} value={n}>
              {n} m
            </option>
          ))}
        </NativeSelect>
      </label>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onControl({ ...control, active: true, revision: control.revision + 1 })}
        >
          Draw / replace line
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onControl({ ...control, refresh: (control.refresh ?? 0) + 1 })}
        >
          Refresh loaded points
        </Button>
      </div>
      <p className="text-muted-foreground">
        Loaded-point preview · 750,000 input-return streaming budget. This is not a complete extraction of every source
        return along the line. Refresh after loading settles.
      </p>
      {!profile && <p role="status">Pick the first endpoint, then the second on the map. Escape cancels drawing.</p>}
      {error && <p role="alert">Terrain normalization unavailable: {error}</p>}
      {profile && (
        <>
          <p>
            {profile.points.length.toLocaleString()} displayed returns · {supported.length.toLocaleString()} have source
            terrain support · {length.toFixed(1)} m line.
          </p>
          <p className="text-muted-foreground">
            Classes 7/12/18 and supported heights outside −0.5–80 m are screened. Individual withheld flags are
            unavailable in this native preview. The chart draws {shown.length.toLocaleString()} returns; CSV retains all{' '}
            {normalized.length.toLocaleString()} screened loaded returns, with missing terrain left blank.
          </p>
          <svg
            viewBox="0 0 420 300"
            className="w-full rounded border bg-white"
            role="img"
            aria-label="Terrain-normalized native transect preview"
          >
            <text x="40" y="18" fontSize="11" fill="#334155">
              Height above terrain (m) · loaded points
            </text>
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <g key={t}>
                <path d={`M40 ${260 - t * 220}H410`} stroke="#e2e8f0" />
                <text x="35" y={264 - t * 220} textAnchor="end" fontSize="10" fill="#334155">
                  {(t * maximum).toFixed(0)}
                </text>
              </g>
            ))}
            <path
              d={shown
                .map(
                  (p) =>
                    `M${(40 + (p.distance / Math.max(length, 1)) * 365).toFixed(2)} ${(260 - (p.height! / maximum) * 220).toFixed(2)}h.01`,
                )
                .join('')}
              stroke="#047857"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <text x="40" y="280" fontSize="11" fill="#334155">
              0
            </text>
            <text x="410" y="280" fontSize="11" textAnchor="end" fill="#334155">
              {length.toFixed(1)} m along line
            </text>
          </svg>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                downloadText(
                  'distance_m,longitude,latitude,elevation_cgvd2013_m,height_above_source_dtm_m,classification\n' +
                    normalized
                      .map((p) => [p.distance, p.lon, p.lat, p.z, p.height ?? '', p.classification].join(','))
                      .join('\n'),
                  'loaded-transect-preview.csv',
                  'text/csv',
                )
              }
            >
              Export transect CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                downloadText(
                  JSON.stringify({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: [profile.line.start, profile.line.end] },
                    properties: {
                      source_sha256: data?.source_sha256,
                      total_width_m: control.width,
                      loaded_point_count: profile.points.length,
                      preview_only: true,
                    },
                  }),
                  'transect-line.geojson',
                  'application/geo+json',
                )
              }
            >
              Export cut line
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
