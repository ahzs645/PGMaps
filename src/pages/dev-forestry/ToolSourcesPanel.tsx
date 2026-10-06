import { useRef, useState } from 'react'
import { Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CollapsibleSection, InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { createId, type ForestryScene } from './scene'
import { MASK_LABELS } from './assessmentMasks'
import { readShapeFile } from './shapeImport'
import { importLocalRaster } from './toolImports'
import { TOOL_INPUT, ToolField } from './ToolFieldPanel'
import type { AssessmentMaskKind, LocalRaster } from './types'

export function ToolSourcesPanel({
  scene,
  onChange,
  selectedTargetId,
}: {
  scene: ForestryScene
  onChange: (scene: ForestryScene) => void
  selectedTargetId: string | null
}) {
  const [kind, setKind] = useState<AssessmentMaskKind>('natural'),
    [rasterKind, setRasterKind] = useState<LocalRaster['kind']>('terrain'),
    [date, setDate] = useState(''),
    [reference, setReference] = useState(''),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false)
  const masksInput = useRef<HTMLInputElement>(null),
    rasterInput = useRef<HTMLInputElement>(null),
    selected = scene.targets.find((t) => t.id === selectedTargetId)
  const sceneRef = useRef(scene)
  sceneRef.current = scene
  const importMasks = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const parsed = await readShapeFile(file)
      const scene = sceneRef.current
      if (!parsed.polygons.length) throw new Error('The file contains no polygons.')
      if ((scene.masks?.length ?? 0) + parsed.polygons.length > 100) throw new Error('Use at most 100 masks.')
      onChange({
        ...scene,
        masks: [
          ...(scene.masks ?? []),
          ...parsed.polygons.map((p) => ({
            id: createId('mask'),
            name: p.name,
            kind,
            geometry: p.geometry,
            source: file.name,
          })),
        ],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const importRaster = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const raster = await importLocalRaster(file, rasterKind, date, reference)
      const scene = sceneRef.current
      onChange({
        ...scene,
        localRasters: [...(scene.localRasters ?? []).filter((r) => r.kind !== raster.kind), raster],
        settings: { ...scene.settings, ...(raster.kind === 'canopy' ? { screeningEnabled: true } : {}) },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <SidebarSection title="Assessment masks and local surfaces" icon={Layers} headingLevel={3}>
      <CollapsibleSection toggleProps={{ 'data-forestry-disclosure': '' }} label="Classify assessment areas">
        <div className="space-y-2 py-3 text-xs">
          <p>
            Natural non-green ground leaves the denominator. Private land and permanent non-forestry disturbance remain
            in the assessable land base but contribute no forestry alteration. Retained patches remain green and are
            removed from the proposal geometrically.
          </p>
          <ToolField label="Assessment mask classification">
            <select className={TOOL_INPUT} value={kind} onChange={(e) => setKind(e.target.value as AssessmentMaskKind)}>
              {Object.entries(MASK_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </ToolField>
          <input
            className="hidden"
            ref={masksInput}
            type="file"
            accept=".json,.geojson,.zip"
            aria-label="Import assessment masks"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void importMasks(file)
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => masksInput.current?.click()}>
              Import mask polygons
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!selected || busy || (scene.masks?.length ?? 0) >= 100}
              onClick={() => {
                if (selected)
                  onChange({
                    ...scene,
                    masks: [
                      ...(scene.masks ?? []),
                      {
                        id: createId('mask'),
                        name: selected.name,
                        kind,
                        geometry: selected.geometry,
                        source: `Copied from ${selected.source}`,
                      },
                    ],
                  })
              }}
            >
              Use selected polygon as mask
            </Button>
          </div>
          <p className="text-muted-foreground">
            Draw a polygon using the existing map controls, select it, then copy its outline here. Review every
            classification; a boundary lookup does not establish land ownership or field condition. Natural-ground
            exclusion takes precedence where masks overlap.
          </p>
          {(scene.masks ?? []).map((m) => (
            <div key={m.id} className="space-y-1 border-b py-2">
              <p className="font-medium">{m.name}</p>
              <select
                aria-label={`Classification of ${m.name}`}
                className={TOOL_INPUT}
                value={m.kind}
                onChange={(e) =>
                  onChange({
                    ...scene,
                    masks: scene.masks?.map((x) =>
                      x.id === m.id ? { ...x, kind: e.target.value as AssessmentMaskKind } : x,
                    ),
                  })
                }
              >
                {Object.entries(MASK_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Source for ${m.name}`}
                className={TOOL_INPUT}
                value={m.source}
                onChange={(e) =>
                  onChange({
                    ...scene,
                    masks: scene.masks?.map((x) => (x.id === m.id ? { ...x, source: e.target.value } : x)),
                  })
                }
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onChange({ ...scene, masks: scene.masks?.filter((x) => x.id !== m.id) })}
              >
                Remove mask {m.name}
              </Button>
            </div>
          ))}
        </div>
      </CollapsibleSection>
      <CollapsibleSection toggleProps={{ 'data-forestry-disclosure': '' }} label="Import terrain or canopy GeoTIFF">
        <div className="space-y-2 py-3 text-xs">
          <p>
            Use a cropped, single-band, metre-valued GeoTIFF. Native cells and no-data are preserved. Supported
            coordinates: WGS84, Web Mercator, BC Albers and NAD83/WGS84 UTM zones 7–11.
          </p>
          <ToolField label="Local surface type">
            <select
              className={TOOL_INPUT}
              value={rasterKind}
              onChange={(e) => setRasterKind(e.target.value as LocalRaster['kind'])}
            >
              <option value="terrain">Bare-earth terrain elevation</option>
              <option value="canopy">Canopy height above ground</option>
            </select>
          </ToolField>
          <ToolField label="Surface acquisition date">
            <input type="date" className={TOOL_INPUT} value={date} onChange={(e) => setDate(e.target.value)} />
          </ToolField>
          <ToolField label="Vertical reference and units">
            <input
              className={TOOL_INPUT}
              placeholder={rasterKind === 'terrain' ? 'e.g. CGVD2013, metres' : 'Metres above local ground'}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </ToolField>
          <input
            className="hidden"
            ref={rasterInput}
            type="file"
            accept=".tif,.tiff"
            aria-label="Import local raster"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void importRaster(file)
            }}
          />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => rasterInput.current?.click()}>
            {busy ? 'Reading source…' : 'Import local surface'}
          </Button>
          {(scene.localRasters ?? []).map((r) => (
            <div key={r.id} className="space-y-1 border-b py-2">
              <p className="font-medium">
                {r.name} · {r.kind}
              </p>
              <p>
                EPSG:{r.epsg} · {r.width} × {r.height} cells · {r.acquired || 'date not recorded'} ·{' '}
                {r.verticalReference}
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onChange({ ...scene, localRasters: scene.localRasters?.filter((x) => x.id !== r.id) })}
              >
                Remove surface {r.name}
              </Button>
            </div>
          ))}
          {!!scene.localRasters?.length && (
            <InlineAlert tone="warning">
              Imported surfaces change numerical analysis. The basemap and road preview use AWS terrain and illustrative
              trees. A canopy-height surface is an opaque screening assumption, not a model of light passing through
              foliage.
            </InlineAlert>
          )}
        </div>
      </CollapsibleSection>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
    </SidebarSection>
  )
}
