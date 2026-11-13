import { FORM_INPUT_CLASS, FormField, StyledSelect } from '@/components/ui/form-field'
import { useRef, useState } from 'react'
import { ToolDisclosure, ToolSection } from '@/components/ui/tool-section'
import { Button } from '@/components/ui/button'
import { FileButton } from '@/components/ui/file-button'
import { InlineAlert } from '@/components/ui/map-panels'
import { createId, type ForestryScene } from './scene'
import { MASK_LABELS } from './assessmentMasks'
import { readShapeFile } from './shapeImport'
import { importLocalRaster } from './toolImports'
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
  const selected = scene.targets.find((t) => t.id === selectedTargetId)
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
    <ToolSection
      title="Masks and local surfaces"
      summary={
        (scene.masks?.length ?? 0) + (scene.localRasters?.length ?? 0)
          ? `${scene.masks?.length ?? 0} masks · ${scene.localRasters?.length ?? 0} surfaces`
          : 'None · AWS terrain'
      }
      toggleProps={{ 'data-forestry-disclosure': 'masks-surfaces' }}
      help="Classify parts of the landform (natural non-green ground, private land, retained patches) and bring in a local terrain or canopy-height GeoTIFF in place of the AWS terrain."
    >
      <ToolDisclosure
        toggleProps={{ 'data-forestry-disclosure': '' }}
        label="Classify assessment areas"
        help={
          <>
            <span className="block">
              Natural non-green ground leaves the denominator. Private land and permanent non-forestry disturbance
              remain in the assessable land base but contribute no forestry alteration. Retained patches remain green
              and are removed from the proposal geometrically.
            </span>
            <span className="mt-1.5 block">
              Draw a polygon using the existing map controls, select it, then copy its outline here. Review every
              classification; a boundary lookup does not establish land ownership or field condition. Natural-ground
              exclusion takes precedence where masks overlap.
            </span>
          </>
        }
      >
        <div className="space-y-2 text-xs">
          <FormField label="Assessment mask classification">
            <StyledSelect value={kind} onChange={(e) => setKind(e.target.value as AssessmentMaskKind)}>
              {Object.entries(MASK_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </StyledSelect>
          </FormField>
          <div className="flex flex-wrap gap-2">
            <FileButton
              label="Import assessment masks"
              accept=".json,.geojson,.zip"
              disabled={busy}
              onFiles={([file]) => void importMasks(file)}
            >
              Import mask polygons
            </FileButton>
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
          {(scene.masks ?? []).map((m) => (
            <div key={m.id} className="space-y-1 border-b py-2">
              <p className="font-medium">{m.name}</p>
              <StyledSelect
                aria-label={`Classification of ${m.name}`}
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
              </StyledSelect>
              <FormField label={`Source for ${m.name}`} hideLabel>
                <input
                  className={FORM_INPUT_CLASS}
                  value={m.source}
                  onChange={(e) =>
                    onChange({
                      ...scene,
                      masks: scene.masks?.map((x) => (x.id === m.id ? { ...x, source: e.target.value } : x)),
                    })
                  }
                />
              </FormField>
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
      </ToolDisclosure>
      <ToolDisclosure
        toggleProps={{ 'data-forestry-disclosure': '' }}
        label="Import terrain or canopy GeoTIFF"
        help="Use a cropped, single-band, metre-valued GeoTIFF. Native cells and no-data are preserved. Supported coordinates: WGS84, Web Mercator, BC Albers and NAD83/WGS84 UTM zones 7–11."
      >
        <div className="space-y-2 text-xs">
          <FormField label="Local surface type">
            <StyledSelect value={rasterKind} onChange={(e) => setRasterKind(e.target.value as LocalRaster['kind'])}>
              <option value="terrain">Bare-earth terrain elevation</option>
              <option value="canopy">Canopy height above ground</option>
            </StyledSelect>
          </FormField>
          <FormField label="Surface acquisition date">
            <input type="date" className={FORM_INPUT_CLASS} value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          <FormField label="Vertical reference and units">
            <input
              className={FORM_INPUT_CLASS}
              placeholder={rasterKind === 'terrain' ? 'e.g. CGVD2013, metres' : 'Metres above local ground'}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </FormField>
          <FileButton
            label="Import local raster"
            accept=".tif,.tiff"
            disabled={busy}
            onFiles={([file]) => void importRaster(file)}
          >
            {busy ? 'Reading source…' : 'Import local surface'}
          </FileButton>
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
      </ToolDisclosure>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
    </ToolSection>
  )
}
