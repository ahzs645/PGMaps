import { useState } from 'react'
import { Plus, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { httpUrl } from './missionCodec'
import { uid, type Mission, type Coordinate } from './model'
import type { LocalRaster } from '../dev-forestry/types'
import { importLocalRaster } from '../dev-forestry/toolImports'
import { sampleRaster } from './raster'

export function RasterPanel({
  mission,
  change,
  raster,
  onRaster,
  point,
  onError,
}: {
  mission: Mission
  change: (fn: (m: Mission) => Mission) => void
  raster: LocalRaster | null
  onRaster: (r: LocalRaster | null) => void
  point: Coordinate | null
  onError: (message: string) => void
}) {
  const [name, setName] = useState('Raster overlay'),
    [url, setUrl] = useState(''),
    [kind, setKind] = useState('xyz')
  const [service, setService] = useState('https://titiler.xyz'),
    [band, setBand] = useState(1),
    [busy, setBusy] = useState(false)
  const [datum, setDatum] = useState(''),
    [attribution, setAttribution] = useState('')
  const [rawResult, setRawResult] = useState('')
  const sample = raster && point ? sampleRaster(raster, point) : null
  const add = async () => {
    setBusy(true)
    try {
      httpUrl(url)
      let tiles = [url]
      const base = httpUrl(service).replace(/\/$/, '')
      if (kind === 'cog') {
        const response = await fetch(
          `${base}/cog/WebMercatorQuad/tilejson.json?url=${encodeURIComponent(url)}&bidx=${band}`,
          { signal: AbortSignal.timeout(20000) },
        )
        if (!response.ok)
          throw new Error(`Raster service returned ${response.status}. Check its address and COG access.`)
        const data = await response.json()
        if (!Array.isArray(data.tiles) || !data.tiles.length)
          throw new Error('The raster service did not return tile URLs.')
        tiles = data.tiles.map((v: string) => {
          httpUrl(v)
          return v
        })
      } else if (!['{z}', '{x}', '{y}'].every((part) => url.includes(part)))
        throw new Error('An XYZ template must contain {z}, {x} and {y}.')
      change((m) => ({
        ...m,
        tiles: [
          ...m.tiles,
          {
            id: uid(),
            name: name.trim() || 'Raster overlay',
            tiles,
            visible: true,
            opacity: 0.75,
            attribution,
            ...(kind === 'cog' ? { cog: { url, service: base, band } } : {}),
          },
        ],
      }))
      setUrl('')
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not connect to this raster.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <SidebarSection title="Raster sources">
        <p className="mm-help">Connect tiled imagery or a Cloud Optimized GeoTIFF through a TiTiler service.</p>
        <label className="mm-field">
          Source type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="xyz">XYZ raster tiles</option>
            <option value="cog">COG through TiTiler</option>
          </select>
        </label>
        <label className="mm-field">
          Layer name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="mm-field">
          {kind === 'xyz' ? 'Tile URL template' : 'COG URL'}
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={kind === 'xyz' ? 'https://…/{z}/{x}/{y}.png' : 'https://…/elevation.tif'}
          />
        </label>
        {kind === 'cog' && (
          <>
            <label className="mm-field">
              TiTiler service
              <input value={service} onChange={(e) => setService(e.target.value)} />
            </label>
            <label className="mm-field">
              Band
              <input
                type="number"
                min={1}
                max={1024}
                value={band}
                onChange={(e) => setBand(Math.max(1, Math.min(1024, Number(e.target.value) || 1)))}
              />
            </label>
          </>
        )}
        <label className="mm-field">
          Data attribution
          <input
            value={attribution}
            onChange={(e) => setAttribution(e.target.value)}
            placeholder="Data provider and license"
          />
        </label>
        <Button size="sm" disabled={busy || !url.trim() || mission.tiles.length >= 20} onClick={() => void add()}>
          <Plus className="size-4" />
          {busy ? 'Connecting…' : 'Add raster'}
        </Button>
        {mission.tiles.map((t) => (
          <div key={t.id} className="mm-source-row">
            <label>
              <input
                type="checkbox"
                checked={t.visible}
                onChange={(e) =>
                  change((m) => ({
                    ...m,
                    tiles: m.tiles.map((v) => (v.id === t.id ? { ...v, visible: e.target.checked } : v)),
                  }))
                }
              />
              {t.name}
            </label>
            <button
              aria-label={`Remove ${t.name}`}
              onClick={() => change((m) => ({ ...m, tiles: m.tiles.filter((v) => v.id !== t.id) }))}
            >
              <Trash2 size={14} />
            </button>
            <input
              aria-label={`${t.name} opacity`}
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={t.opacity}
              onChange={(e) =>
                change((m) => ({
                  ...m,
                  tiles: m.tiles.map((v) => (v.id === t.id ? { ...v, opacity: Number(e.target.value) } : v)),
                }))
              }
            />
          </div>
        ))}
        {mission.tiles.some((t) => t.visible && t.cog) && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={!point || busy}
              onClick={async () => {
                const source = [...mission.tiles].reverse().find((t) => t.visible && t.cog)
                if (!source?.cog || !point) return
                setBusy(true)
                setRawResult('')
                try {
                  const response = await fetch(
                    `${source.cog.service}/cog/point/${point[0]},${point[1]}?url=${encodeURIComponent(source.cog.url)}&bidx=${source.cog.band}`,
                    { signal: AbortSignal.timeout(20000) },
                  )
                  if (!response.ok) throw new Error(`Pixel query returned ${response.status}.`)
                  const data = await response.json()
                  if (!Array.isArray(data.values)) throw new Error('The service did not return pixel values.')
                  setRawResult(
                    `${source.name} · band ${source.cog.band} · ${point[1].toFixed(5)}, ${point[0].toFixed(5)}: ${data.values.map((v: unknown) => (v == null ? 'No data' : String(v))).join(', ')}`,
                  )
                } catch (e) {
                  onError(e instanceof Error ? e.message : 'Pixel query failed.')
                } finally {
                  setBusy(false)
                }
              }}
            >
              Query COG at last map position
            </Button>
            {rawResult && (
              <p className="mm-help" role="status">
                {rawResult}
              </p>
            )}
            <p className="mm-help">
              Queries the uppermost visible COG’s original band values through its service. Units remain those of the
              source band.
            </p>
          </>
        )}
      </SidebarSection>
      <SidebarSection title="Local elevation raster">
        <p className="mm-help">
          Import a cropped, single-band DEM to see its elevation colors and inspect original cell values. The DEM also
          supplies your elevation profile.
        </p>
        <label className="mm-field">
          Vertical reference / datum
          <input value={datum} onChange={(e) => setDatum(e.target.value)} placeholder="e.g. CGVD2013, metres" />
        </label>
        <label className="mm-upload">
          <Upload size={15} />
          {busy ? 'Reading…' : 'Import terrain GeoTIFF'}
          <input
            aria-label="Import terrain GeoTIFF"
            type="file"
            accept=".tif,.tiff"
            disabled={!datum.trim() || busy}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              setBusy(true)
              try {
                onRaster(await importLocalRaster(file, 'terrain', '', datum))
              } catch (e) {
                onError(e instanceof Error ? e.message : 'Could not read this raster.')
              } finally {
                setBusy(false)
              }
            }}
          />
        </label>
        <p className="mm-help">
          Up to 64 MB / 1,048,576 native cells. WGS84, Web Mercator, BC Albers and UTM zones 7–11. Local raster bytes
          remain in this tab and are excluded from mission files and links.
        </p>
        {raster && (
          <>
            <InlineAlert title={raster.name}>
              {raster.width} × {raster.height} · EPSG:{raster.epsg} · {raster.verticalReference}
            </InlineAlert>
            <div className="mm-readout">
              <span>Original cell</span>
              <strong>
                {sample
                  ? sample.value === null
                    ? 'No data'
                    : `${sample.value.toFixed(2)} m`
                  : 'Tap or move over raster'}
              </strong>
            </div>
            {sample && (
              <p className="mm-help">
                Row {sample.row} · column {sample.column}. No interpolation.
              </p>
            )}
            <Button size="sm" variant="outline" onClick={() => onRaster(null)}>
              Remove local raster
            </Button>
          </>
        )}
      </SidebarSection>
    </>
  )
}
