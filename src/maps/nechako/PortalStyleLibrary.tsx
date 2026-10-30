import { NativeSelect } from '@/components/ui/form-field'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert, SearchInput } from '@/components/ui/map-panels'
import { downloadBlob, downloadText } from '@/lib/download'
import { formatBytes } from '@/lib/format'
import { errorText } from '@/lib/nechakoPortal'
import type { VectorData } from './data/workspace'
import { useLocalWorkbenchRecords } from './data/useLocalWorkbench'
import { saveLocalWorkbench, type LocalWorkbenchRecord } from './data/localWorkbench'
import {
  applyStyleRecord,
  checkedLocalStyleData,
  checkedStyleDefaults,
  deleteLocalStyle,
  setLocalStyleDefault,
  STYLE_DEFAULTS_ID,
  type LocalStyleData,
} from './data/styleLibrary'
import { importStyleSld, MAX_SLD_BYTES, exportStyleSld } from './data/sldStyle'
import { PortalVectorStyleLegend } from './PortalVectorStyleEditor'

export function PortalStyleLibrary({
  vectors,
  onApply,
}: {
  vectors: VectorData[]
  onApply: (vector: VectorData) => void
}) {
  const library = useLocalWorkbenchRecords('style')
  const defaults = useLocalWorkbenchRecords('style-defaults')
  const [targetId, setTargetId] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [imported, setImported] = useState<{ name: string; data: LocalStyleData; file: File; targetName?: string }>()
  const [schemaId, setSchemaId] = useState('')
  const [exportGeometry, setExportGeometry] = useState<'point' | 'line' | 'polygon'>('point')
  const target = vectors.find((vector) => vector.id === targetId) ?? vectors[0]
  const filtered = useMemo(
    () => library.records.filter((record) => record.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
    [library.records, query],
  )
  const count = Math.max(1, Math.ceil(filtered.length / 10)),
    current = Math.min(page, count - 1)
  const assignments = useMemo(() => {
    try {
      const record = defaults.records.find((item) => item.id === STYLE_DEFAULTS_ID)
      return record ? checkedStyleDefaults(record.data).assignments : {}
    } catch {
      return {}
    }
  }, [defaults.records])
  const run = (action: () => Promise<void> | void) => {
    setError('')
    setNotice('')
    setBusy(true)
    void Promise.resolve()
      .then(action)
      .catch((reason: unknown) => setError(errorText(reason)))
      .finally(() => setBusy(false))
  }
  const recordData = (record: LocalWorkbenchRecord) => {
    try {
      return { data: checkedLocalStyleData(record.data), error: '' }
    } catch (reason) {
      return { data: undefined, error: errorText(reason) }
    }
  }
  return (
    <details className="mt-3 space-y-3 rounded border p-3" data-nechako-style-library>
      <summary className="cursor-pointer font-semibold">Local style library ({library.records.length})</summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Styles and defaults are saved in this browser. Share a downloaded SLD or style JSON with another person; no
        portal server style or permission is changed. Unsupported SLDs remain available as original files.
      </p>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block text-sm">
          Target map layer
          <NativeSelect
            aria-label="Style library target layer"
            className="mt-1 w-full rounded border bg-background p-2 text-base"
            value={target?.id ?? ''}
            onChange={(event) => setTargetId(event.target.value)}
          >
            <option value="">Choose layer</option>
            {vectors.map((vector) => (
              <option key={vector.id} value={vector.id}>
                {vector.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="block text-sm">
          Import SLD or style JSON
          <input
            aria-label="Import local style"
            type="file"
            accept=".sld,.xml,.json,application/json,application/xml"
            className="mt-1 block w-full text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              setImported(undefined)
              run(async () => {
                if (file.size > MAX_SLD_BYTES) throw new Error('Style imports are limited to 2 MiB.')
                const content = await file.text()
                if (content.trimStart().startsWith('<')) {
                  const result = importStyleSld(content, target?.data)
                  setImported({
                    name: result.name,
                    data: {
                      schema: 'nechako-local-style-v1',
                      ...(result.style && { style: result.style }),
                      originalSld: result.originalSld,
                      diagnostics: result.diagnostics,
                    },
                    file,
                    targetName: target?.name,
                  })
                } else
                  setImported({
                    name: file.name.replace(/\.json$/i, ''),
                    data: checkedLocalStyleData(JSON.parse(content)),
                    file,
                  })
              })
            }}
          />
        </label>
        {imported && (
          <section className="space-y-2 rounded border p-3">
            <h4 className="font-medium">Review imported style</h4>
            {imported.targetName && <p className="text-xs">Target layer for import review: {imported.targetName}.</p>}
            <label className="block text-xs">
              Library name
              <input
                aria-label="Imported style name"
                className="mt-1 w-full rounded border bg-background p-2 text-base"
                maxLength={200}
                value={imported.name}
                onChange={(event) => setImported({ ...imported, name: event.target.value })}
              />
            </label>
            {imported.data.diagnostics.map((item, index) => (
              <InlineAlert key={index} tone={item.severity === 'error' ? 'error' : 'warning'}>
                {item.message}
              </InlineAlert>
            ))}
            {imported.data.style ? (
              <PortalVectorStyleLegend style={imported.data.style} />
            ) : (
              <p className="text-sm">
                This original can be saved and downloaded, but its unsupported styling cannot be applied.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() =>
                  run(async () => {
                    await saveLocalWorkbench({
                      kind: 'style',
                      name: imported.name,
                      data: checkedLocalStyleData(imported.data),
                      blob: imported.file,
                      filename: imported.file.name,
                      mime: imported.file.type || 'application/octet-stream',
                      source: {
                        importedAt: new Date().toISOString(),
                        access: 'unknown',
                        notes:
                          'Imported local style file; original bytes retained.' +
                          (imported.targetName ? ' Target layer for import review: ' + imported.targetName + '.' : ''),
                      },
                    })
                    setImported(undefined)
                    setNotice('Style saved in this browser.')
                  })
                }
              >
                Save imported style
              </Button>
              <Button size="sm" variant="outline" onClick={() => setImported(undefined)}>
                Cancel style import
              </Button>
            </div>
          </section>
        )}
        <SearchInput
          aria-label="Search local styles"
          data-map-search-input="false"
          placeholder="Search saved styles"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setPage(0)
          }}
          onClear={() => {
            setQuery('')
            setPage(0)
          }}
        />
        <label className="block text-xs">
          SLD geometry for styles covering all geometries
          <NativeSelect
            aria-label="Library SLD export geometry"
            className="mt-1 w-full rounded border bg-background p-2 text-base"
            value={exportGeometry}
            onChange={(event) => setExportGeometry(event.target.value as typeof exportGeometry)}
          >
            <option value="point">Points</option>
            <option value="line">Lines</option>
            <option value="polygon">Polygons</option>
          </NativeSelect>
        </label>
        {library.loading && <p className="text-xs">Loading local styles…</p>}
        {(library.error || defaults.error) && <InlineAlert tone="error">{library.error || defaults.error}</InlineAlert>}
        <p className="text-xs">
          {filtered.length} matching saved styles · page {current + 1} of {count}
        </p>
        {filtered.slice(current * 10, current * 10 + 10).map((record) => {
          const parsed = recordData(record)
          const applied = Object.entries(assignments)
            .filter(([, id]) => id === record.id)
            .map(([key]) => key)
          return (
            <article key={record.id} className="space-y-2 rounded border p-3">
              <h4 className="break-words font-medium">{record.name}</h4>
              <p className="text-xs text-muted-foreground">
                Updated {record.updatedAt.slice(0, 10)} · {formatBytes(record.bytes)}
                {applied.length ? ' · Default: ' + applied.join(', ') : ''}
              </p>
              {parsed.error && <InlineAlert tone="error">{parsed.error}</InlineAlert>}
              {parsed.data?.diagnostics.map((item, index) => (
                <InlineAlert key={index} tone={item.severity === 'error' ? 'error' : 'warning'}>
                  {item.message}
                </InlineAlert>
              ))}
              {parsed.data?.style && (
                <details>
                  <summary className="cursor-pointer text-xs">Style legend</summary>
                  <PortalVectorStyleLegend style={parsed.data.style} />
                </details>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!target || !parsed.data?.style}
                  onClick={() =>
                    run(() => {
                      if (target) {
                        onApply(applyStyleRecord(target, record))
                        setNotice('Saved style applied to ' + target.name + '.')
                      }
                    })
                  }
                >
                  Apply saved style
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!parsed.data}
                  onClick={() =>
                    run(() =>
                      downloadText(
                        JSON.stringify(parsed.data, null, 2),
                        'nechako-saved-style.json',
                        'application/json',
                      ),
                    )
                  }
                >
                  Download style JSON
                </Button>
                {parsed.data?.style && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      run(() => {
                        const style = parsed.data!.style!
                        downloadText(
                          exportStyleSld(
                            style,
                            record.name,
                            style.geometry === 'any' ? exportGeometry : style.geometry,
                          ),
                          'nechako-saved-style.sld',
                          'application/vnd.ogc.sld+xml',
                        )
                      })
                    }
                  >
                    Download SLD
                  </Button>
                )}
                {(record.blob || parsed.data?.originalSld) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      run(() => {
                        if (record.blob) downloadBlob(record.blob, record.filename ?? 'original-style.sld')
                        else
                          downloadText(parsed.data!.originalSld!, 'original-style.sld', 'application/vnd.ogc.sld+xml')
                      })
                    }
                  >
                    Download original style
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    run(async () => {
                      await deleteLocalStyle(record.id)
                      setNotice(
                        'Removed saved style and its default assignments. Styles already applied to map layers are unchanged.',
                      )
                    })
                  }
                >
                  Delete saved style
                </Button>
              </div>
              {parsed.data?.style && (
                <div className="flex flex-wrap gap-2">
                  {(['point', 'line', 'polygon'] as const)
                    .filter(
                      (geometry) => parsed.data!.style!.geometry === 'any' || parsed.data!.style!.geometry === geometry,
                    )
                    .map((geometry) => (
                      <Button
                        key={geometry}
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          run(async () => {
                            await setLocalStyleDefault(geometry, record.id)
                            setNotice(
                              record.name + ' is now the local ' + geometry + ' default for newly added layers.',
                            )
                          })
                        }
                      >
                        Default for {geometry}
                      </Button>
                    ))}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!schemaId.trim()}
                    onClick={() =>
                      run(async () => {
                        await setLocalStyleDefault('schema:' + schemaId.trim(), record.id)
                        setNotice('Local default assigned to schema ' + schemaId.trim() + '.')
                      })
                    }
                  >
                    Default for schema
                  </Button>
                </div>
              )}
            </article>
          )
        })}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous styles
          </Button>
          <Button size="sm" variant="outline" disabled={current >= count - 1} onClick={() => setPage(current + 1)}>
            Next styles
          </Button>
        </div>
        <label className="block text-xs">
          Schema ID for default assignment
          <input
            aria-label="Style default schema ID"
            className="mt-1 w-full rounded border bg-background p-2 text-base"
            value={schemaId}
            maxLength={100}
            onChange={(event) => setSchemaId(event.target.value)}
          />
        </label>
        {Object.entries(assignments).map(([key, id]) => (
          <div key={key} className="flex items-center justify-between gap-2 text-xs">
            <span className="break-all">
              {key}: {library.records.find((record) => record.id === id)?.name ?? 'Missing saved style'}
            </span>
            <Button size="sm" variant="outline" onClick={() => run(() => setLocalStyleDefault(key))}>
              Clear default
            </Button>
          </div>
        ))}
      </fieldset>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {notice && <InlineAlert tone="info">{notice}</InlineAlert>}
    </details>
  )
}
