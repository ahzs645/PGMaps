import { useEffect, useState } from 'react'
import { MapPin, Mountain, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { downloadText, toCsv } from '@pgmaps/geo-toolkit/export'
import { loadElevationGrid } from '../dev-forestry/demLoader'
import { demTileRange, type ElevationSource } from '../dev-forestry/terrain'
import { rasterSampler } from '../dev-forestry/localRaster'
import { sampleAlongLine } from '../dev-forestry/visibility'
import type { LocalRaster } from '../dev-forestry/types'
import type { Coordinate, Mission, Tool } from './model'

export interface ProfilePoint {
  distance: number
  elevation: number | null
  lng: number
  lat: number
}
function Profile({
  points,
  raster,
  onProfilePoint,
}: {
  points: Coordinate[]
  raster: LocalRaster | null
  onProfilePoint: (p: Coordinate | null) => void
}) {
  const [request, setRequest] = useState(0),
    [result, setResult] = useState<{ key: string; data: ProfilePoint[]; status: string }>({
      key: '',
      data: [],
      status: '',
    })
  const key = JSON.stringify({ request, points, raster: raster?.sha256 })
  const data = result.key === key ? result.data : []
  const [cursor, setCursor] = useState<{ key: string; index: number } | null>(null)
  const sample = cursor?.key === key ? data[cursor.index] : undefined
  const pick = (index: number) => {
    const value = data[index]
    if (!value) return
    setCursor({ key, index })
    onProfilePoint([value.lng, value.lat])
  }
  useEffect(() => () => onProfilePoint(null), [key, onProfilePoint])
  const status = result.key === key ? result.status : request && points.length >= 2 ? 'Sampling terrain…' : ''
  useEffect(() => {
    if (!request || points.length < 2) return
    const abort = new AbortController()
    const run = async () => {
      let source: ElevationSource
      if (raster) source = rasterSampler(raster)
      else {
        const lngs = points.map((p) => p[0]),
          lats = points.map((p) => p[1])
        const range = demTileRange([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)], 13)
        if (range.tileCount > 64)
          throw new Error('This path spans more than 64 terrain tiles. Choose a shorter path or import a cropped DEM.')
        source = (await loadElevationGrid({ range, signal: abort.signal })).grid
      }
      const stations = sampleAlongLine(points, 20, 200)
      const rows = stations.map((p) => {
        const z = source.elevationAt(p.lng, p.lat)
        return { distance: p.distanceAlongMeters, elevation: Number.isFinite(z) ? z : null, lng: p.lng, lat: p.lat }
      })
      if (abort.signal.aborted) return
      setResult({
        key,
        data: rows,
        status: `${rows.length} samples · ${rows.filter((p) => p.elevation === null).length} unknown · ${raster ? raster.name : 'AWS Terrain Tiles overview'}`,
      })
    }
    run().catch((e: unknown) => {
      if (!abort.signal.aborted)
        setResult({ key, data: [], status: e instanceof Error ? e.message : 'Terrain could not be sampled.' })
    })
    return () => abort.abort()
  }, [request, points, raster, key])
  const finite = data.flatMap((p) => (p.elevation === null ? [] : [p.elevation])),
    min = Math.min(...finite),
    max = Math.max(...finite)
  const path = data
    .map((p, i) =>
      p.elevation === null
        ? ''
        : `${i === 0 || data[i - 1].elevation === null ? 'M' : 'L'} ${(p.distance / Math.max(1, data.at(-1)?.distance ?? 1)) * 280 + 10},${90 - ((p.elevation - min) / Math.max(1, max - min)) * 70}`,
    )
    .join(' ')
  return (
    <>
      <Button size="sm" variant="outline" disabled={points.length < 2} onClick={() => setRequest((v) => v + 1)}>
        <Mountain size={14} />
        Generate elevation profile
      </Button>
      {status && (
        <p className="mm-help" role="status">
          {status}
        </p>
      )}
      {finite.length > 0 && (
        <>
          <svg
            viewBox="0 0 300 110"
            className="mm-profile"
            role="img"
            aria-label={`Elevation profile: ${min.toFixed(1)} to ${max.toFixed(1)} metres`}
            onPointerMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect()
              const fraction = Math.max(0, Math.min(1, (((e.clientX - box.left) / box.width) * 300 - 10) / 280))
              pick(Math.round(fraction * (data.length - 1)))
            }}
            onPointerLeave={() => {
              setCursor(null)
              onProfilePoint(null)
            }}
          >
            <path d="M10 10V90H290" fill="none" stroke="currentColor" opacity=".25" />
            <path d={path} fill="none" stroke="#1d948b" strokeWidth="2" />
            {sample && (
              <line
                x1={(sample.distance / Math.max(1, data.at(-1)?.distance ?? 1)) * 280 + 10}
                x2={(sample.distance / Math.max(1, data.at(-1)?.distance ?? 1)) * 280 + 10}
                y1={10}
                y2={90}
                stroke="#d49138"
                strokeWidth={1}
              />
            )}
          </svg>
          <input
            type="range"
            className="w-full"
            aria-label="Profile sample"
            min={0}
            max={data.length - 1}
            value={cursor?.key === key ? cursor.index : 0}
            onFocus={() => pick(cursor?.key === key ? cursor.index : 0)}
            onChange={(e) => pick(Number(e.target.value))}
            onBlur={() => {
              setCursor(null)
              onProfilePoint(null)
            }}
          />
          {sample && (
            <p className="mm-help" role="status">
              Profile cursor · {(sample.distance / 1000).toFixed(3)} km ·{' '}
              {sample.elevation === null ? 'No data' : `${sample.elevation.toFixed(2)} m`}
            </p>
          )}
          <div className="mm-readout">
            <span>
              {min.toFixed(1)}–{max.toFixed(1)} m
            </span>
            <span>{((data.at(-1)?.distance ?? 0) / 1000).toFixed(2)} km</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadText(toCsv(['distance', 'elevation', 'lng', 'lat'], data), 'elevation-profile.csv', 'text/csv')
            }
          >
            Export profile CSV
          </Button>
        </>
      )}
    </>
  )
}
export function TerrainPanel({
  mission,
  change,
  setTool,
  tool,
  points,
  raster,
  observer,
  radius,
  height,
  onRadius,
  onHeight,
  onRetry,
  viewshedStatus,
  viewshedCurrent,
  onViewshedChange,
  viewshedOn,
  onProfilePoint,
}: {
  mission: Mission
  change: (fn: (m: Mission) => Mission) => void
  setTool: (tool: Tool) => void
  tool: Tool
  points: Coordinate[]
  raster: LocalRaster | null
  observer: Coordinate
  radius: number
  height: number
  onRadius: (v: number) => void
  onHeight: (v: number) => void
  onRetry: () => void
  viewshedStatus: string
  viewshedCurrent: boolean
  viewshedOn: boolean
  onViewshedChange: (v: boolean) => void
  onProfilePoint: (p: Coordinate | null) => void
}) {
  return (
    <>
      <SidebarSection title="Terrain & elevation">
        <label className="mm-check">
          <input
            type="checkbox"
            checked={mission.terrain}
            onChange={(e) => change((m) => ({ ...m, terrain: e.target.checked }))}
          />
          Show 3D terrain · 1× elevation
        </label>
        <p className="mm-help">
          Relief uses the AWS Terrain Tiles overview. A local DEM supplies profiles and pixel inspection; the scene
          relief and viewshed continue to use overview tiles.
        </p>
        <Button variant="outline" size="sm" onClick={() => setTool('measure')}>
          Draw a profile path
        </Button>
        <p className="mm-help">
          Click points on the plan, then generate a profile. At most 200 samples; missing terrain stays unknown.
        </p>
        <Profile points={points} raster={raster} onProfilePoint={onProfilePoint} />
      </SidebarSection>
      <SidebarSection title="Terrain viewshed">
        <Button
          size="sm"
          variant={tool === 'viewshed' ? 'default' : 'outline'}
          onClick={() => {
            setTool('viewshed')
            onViewshedChange(true)
          }}
        >
          <MapPin size={14} />
          Place observer on map
        </Button>
        <p className="mm-help">
          Observer {observer[1].toFixed(5)}, {observer[0].toFixed(5)}
        </p>
        <label className="mm-field">
          Radius (m)
          <input
            type="number"
            min={100}
            max={5000}
            step={100}
            value={radius}
            onChange={(e) => onRadius(Math.max(100, Math.min(5000, Number(e.target.value) || 100)))}
          />
        </label>
        <label className="mm-field">
          Eye height above terrain (m)
          <input
            type="number"
            min={0.5}
            max={100}
            step={0.1}
            value={height}
            onChange={(e) => onHeight(Math.max(0.5, Math.min(100, Number(e.target.value) || 1.6)))}
          />
        </label>
        <label className="mm-check">
          <input type="checkbox" checked={viewshedOn} onChange={(e) => onViewshedChange(e.target.checked)} />
          Show visibility analysis
        </label>
        {viewshedOn && (
          <>
            <InlineAlert title={viewshedCurrent ? 'Current analysis' : 'Analysis status'}>{viewshedStatus}</InlineAlert>
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw size={14} />
              Retry terrain
            </Button>
            <div className="mm-legend">
              <i style={{ background: '#e11d48' }} />
              Visible
              <i style={{ background: '#64748b' }} />
              Hidden
              <i style={{ background: '#a855f7' }} />
              Unknown
            </div>
          </>
        )}
        <p className="mm-help">
          Terrain-only sampled visibility, including Earth curvature and fixed 0.13 refraction. Trees and buildings are
          excluded. Radius capped at 5 km; 128 × 128 display grid. The footprint may retain the previous result while
          updating; only “Current analysis” describes the current observer.
        </p>
      </SidebarSection>
    </>
  )
}
