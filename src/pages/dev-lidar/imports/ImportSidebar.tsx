import { useDeferredValue, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { MapSidebarShell, SidebarSection, KeyValueRows } from '@/components/ui/map-panels'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { featureName } from './vector'
import { getImportSession, setImportSession } from './session'
import type { ImportSession } from './types'
export function ImportSidebar({
  session,
  selected,
  feature,
  onSelect,
  onFeature,
  onDownload,
  onFit,
}: {
  session: ImportSession
  selected: string
  feature: number | null
  onSelect: (id: string) => void
  onFeature: (index: number) => void
  onDownload: () => void
  onFit: () => void
}) {
  const [query, setQuery] = useState(''),
    deferred = useDeferredValue(query)
  const layer = session.layers.find((l) => l.id === selected)
  const rows = useMemo(
    () =>
      layer?.kind === 'vector'
        ? layer.data.features
            .map((f, i) => ({ f, i, name: featureName(f, i).slice(0, 200) }))
            .filter((r) => r.name.toLowerCase().includes(deferred.toLowerCase()))
        : [],
    [layer, deferred],
  )
  const item = layer?.kind === 'vector' && feature !== null ? layer.data.features[feature] : null
  const update = (id: string, patch: { visible?: boolean; opacity?: number }) => {
    const old = getImportSession()
    setImportSession({ ...old, layers: old.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) })
  }
  return (
    <aside
      className="absolute inset-y-0 left-0 z-20 w-[min(310px,80%)] min-h-0 overflow-hidden border-r bg-background md:relative md:inset-auto md:h-full md:w-[310px] md:shrink-0"
      aria-label="Imported layers and attributes"
    >
      <MapSidebarShell title="Your imported data" subtitle="Local to this tab · save a project before closing">
        <SidebarSection title="Layers">
          {!session.layers.length && (
            <p className="text-xs">
              Import a canopy GeoTIFF or candidate GeoJSON. Compressed .geojson.gz files from the archive work directly.
            </p>
          )}
          {session.layers.map((l) => (
            <div className="mb-2 rounded border p-2 text-xs" key={l.id}>
              <div className="flex items-center gap-2">
                <input
                  aria-label={'Show ' + l.name}
                  type="checkbox"
                  checked={l.visible}
                  onChange={(e) => update(l.id, { visible: e.target.checked })}
                />
                <button
                  className={'min-w-0 flex-1 truncate text-left ' + (selected === l.id ? 'font-bold underline' : '')}
                  onClick={() => {
                    onSelect(l.id)
                    setQuery('')
                  }}
                >
                  {l.name}
                </button>
                <button
                  aria-label={'Remove ' + l.name}
                  className="underline"
                  onClick={() => {
                    const old = getImportSession()
                    setImportSession({ ...old, layers: old.layers.filter((v) => v.id !== l.id) })
                    if (selected === l.id) onSelect(old.layers.find((v) => v.id !== l.id)?.id ?? '')
                  }}
                >
                  Remove
                </button>
              </div>
              <label className="mt-1 block">
                Opacity {Math.round(l.opacity * 100)}%
                <input
                  aria-label={'Opacity ' + l.name}
                  className="block w-full"
                  type="range"
                  min="0"
                  max="1"
                  step=".05"
                  value={l.opacity}
                  onChange={(e) => update(l.id, { opacity: Number(e.target.value) })}
                />
              </label>
            </div>
          ))}
        </SidebarSection>
        {layer && (
          <SidebarSection title="Selected layer">
            <KeyValueRows
              size="sm"
              rows={[
                { label: 'Name', value: layer.name },
                { label: 'Source CRS', value: layer.source.crs },
                {
                  label: 'Type',
                  value:
                    layer.kind === 'vector'
                      ? layer.data.features.length.toLocaleString() + ' features'
                      : layer.width + ' × ' + layer.height + ' cells',
                },
                { label: 'Source bytes', value: layer.source.bytes.toLocaleString() },
              ]}
            />
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={onFit}>
                Fit layers
              </Button>
              <Button size="sm" variant="outline" onClick={onDownload}>
                Download source
              </Button>
            </div>
            {layer.kind === 'raster' && (
              <div className="mt-2 text-xs">
                <p>
                  Native range {layer.minimum.toPrecision(6)} – {layer.maximum.toPrecision(6)} ·{' '}
                  {layer.valid.toLocaleString()} valid cells.
                </p>
                <div
                  className="my-1 h-2"
                  style={{ background: 'linear-gradient(to right,#440154,#3b528b,#21918c,#5ec962,#fde725)' }}
                />
                <p>
                  Display preview ≤1024 px. Map clicks read native cells. NoData is transparent. Values retain the
                  file’s units.
                </p>
              </div>
            )}
            <details className="mt-2 text-[10px]">
              <summary>Source fingerprint</summary>
              <p className="break-all">SHA-256 {layer.source.sha256}</p>
            </details>
          </SidebarSection>
        )}
        {layer?.kind === 'vector' && (
          <SidebarSection title={'Features · ' + rows.length.toLocaleString()}>
            <input
              aria-label="Search imported feature IDs"
              className="mb-2 w-full rounded border bg-background p-2 text-sm"
              placeholder="Search IDs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <p className="mb-2 text-[10px]">
              IDs and colours belong to each loaded layer. Candidate centroids represent model assignments; they are not
              measured stem locations.
            </p>
            <VirtualResultList items={rows} getKey={(r) => String(r.i)} estimateSize={42} label="Imported features">
              {(r) => (
                <button
                  className={
                    'w-full truncate p-2 text-left text-xs ' +
                    (feature === r.i ? 'bg-emerald-100 dark:bg-emerald-950' : '')
                  }
                  onClick={() => onFeature(r.i)}
                >
                  {r.name} · {r.f.geometry.type}
                </button>
              )}
            </VirtualResultList>
          </SidebarSection>
        )}
        {item && (
          <SidebarSection title="Feature attributes">
            <KeyValueRows
              size="sm"
              rows={Object.entries(item.properties ?? {}).map(([key, value]) => ({
                label: key,
                value: (typeof value === 'object' ? JSON.stringify(value) : String(value)).slice(0, 1000),
              }))}
            />
            <p className="mt-1 text-[10px]">Long values truncate here. Download source retains complete attributes.</p>
          </SidebarSection>
        )}
        <SidebarSection title="Processing and restore">
          <p className="text-xs leading-5">
            This workspace displays original returns and saved analysis products. The canopy, inventory, species, volume
            and comparison workspaces use the bundled BC examples. R and neural model execution remains in the
            documented processing pipeline.
          </p>
          <p className="mt-2 text-xs leading-5">
            Save project embeds processed layer files and their checksums. Reattach point-cloud files or reconnect
            streaming URLs after restoring a project. Files stay in browser memory; switching tools retains this
            session.
          </p>
          <p className="mt-2 text-xs leading-5">
            Restore archive .part files with the archive’s restore guide first. Then import GeoTIFF/GeoJSON or COPC.
            NPY/NPZ arrays require the archived scripts and source-row mapping.
          </p>
        </SidebarSection>
      </MapSidebarShell>
    </aside>
  )
}
