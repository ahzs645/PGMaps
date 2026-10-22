import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadBlob, downloadText } from '@/lib/download'
import { errorText } from '@/lib/nechakoPortal'
import { convertFiles } from './data/conversion'
import { cacheGisImport } from './data/localIngestion'
import { PortalGpapImport } from './PortalGpapImport'
import { PortalLocalAttachments } from './PortalLocalAttachments'
import { PortalMonitoringImport } from './PortalMonitoringImport'
import { PortalLocalDrafts } from './PortalLocalDrafts'
import { checkedCsv, csvExport } from './data/monitoring'
import type { VectorData } from './data/workspace'
import { PortalDraftReview } from './PortalDraftReview'
import type { DraftWrite } from './data/nativeDraftUpload'

export function PortalFiles({
  onVectors,
  write,
  canWrite = false,
}: {
  onVectors: (layers: VectorData[]) => void
  write?: DraftWrite
  canWrite?: boolean
}) {
  const [files, setFiles] = useState<File[]>([])
  const [result, setResult] = useState<Awaited<ReturnType<typeof convertFiles>>>()
  const [sourceCrs, setSourceCrs] = useState('')
  const [loading, setLoading] = useState(false),
    [error, setError] = useState('')
  const generation = useRef(0)
  const [bibliography, setBibliography] = useState<ReturnType<typeof checkedCsv>>()
  const [titleColumn, setTitleColumn] = useState(''),
    [doiColumn, setDoiColumn] = useState('')
  const [page, setPage] = useState(0)
  const [cacheNotice, setCacheNotice] = useState('')
  const [cacheBusy, setCacheBusy] = useState(false)
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )
  const importFiles = async () => {
    const request = ++generation.current
    setLoading(true)
    setError('')
    setResult(undefined)
    setCacheNotice('')
    try {
      const value = await convertFiles(files, sourceCrs || undefined)
      if (request === generation.current) setResult(value)
    } catch (reason) {
      if (request === generation.current) setError(errorText(reason))
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }
  const bibliographyRows = bibliography?.records || []
  const pages = Math.max(1, Math.ceil(bibliographyRows.length / 50)),
    current = Math.min(page, pages - 1)
  const duplicateCounts = new Map<string, number>()
  bibliographyRows.forEach((row) => {
    const identifier = doiColumn
      ? row[doiColumn]
          ?.trim()
          .toLowerCase()
          .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
      : ''
    if (identifier) duplicateCounts.set(identifier, (duplicateCounts.get(identifier) || 0) + 1)
  })
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Files, GIS and bibliographic imports</h2>
      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="font-semibold">Spatial data</h3>
        <p className="text-sm text-muted-foreground">
          Import GeoJSON, Shapefile sidecars/ZIP, GML, GPX, KML/KMZ, SQLite, SpatiaLite, FlatGeobuf or GeoPackage in
          this browser. GDAL WebAssembly converts each vector layer separately to WGS84. Cache the imported layers and
          original files for later work; no application backend is required. Use the dedicated GPAP importer below for
          field projects.
        </p>
        <label className="block text-sm">
          GIS files (50 MiB combined)
          <input
            aria-label="GIS files"
            type="file"
            multiple
            accept=".geojson,.json,.shp,.shx,.dbf,.prj,.cpg,.zip,.gml,.gpx,.kml,.kmz,.db,.sqlite,.gpkg,.fgb"
            className="mt-1 block w-full text-sm"
            onChange={(event) => {
              generation.current++
              setLoading(false)
              setResult(undefined)
              setCacheNotice('')
              setError('')
              setFiles(Array.from(event.target.files || []))
            }}
          />
        </label>
        <label className="block text-sm">
          Source CRS override
          <select
            aria-label="GIS source CRS"
            className="ml-2 rounded-md border bg-background p-2 text-base"
            value={sourceCrs}
            onChange={(event) => {
              generation.current++
              setLoading(false)
              setResult(undefined)
              setSourceCrs(event.target.value)
            }}
          >
            <option value="">Use file metadata (GeoJSON defaults to WGS84)</option>
            <option value="EPSG:4326">EPSG:4326 — WGS84</option>
            <option value="EPSG:3857">EPSG:3857 — Web Mercator</option>
            <option value="EPSG:3005">EPSG:3005 — BC Albers</option>
          </select>
        </label>
        <Button disabled={!files.length || loading} onClick={() => void importFiles()}>
          {loading ? 'Converting GIS files…' : 'Review GIS import'}
        </Button>
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
        {cacheNotice && <InlineAlert tone="success">{cacheNotice}</InlineAlert>}
        <div className="flex flex-wrap gap-2">
          {files.map((file) => (
            <Button key={file.name} size="sm" variant="outline" onClick={() => downloadBlob(file, file.name)}>
              Original: {file.name}
            </Button>
          ))}
        </div>
        {result && (
          <>
            <p className="text-sm">{result.layers.length} converted layers</p>
            <Button
              disabled={cacheBusy}
              onClick={async () => {
                setCacheBusy(true)
                setError('')
                setCacheNotice('')
                try {
                  const count = await cacheGisImport(files, result)
                  setCacheNotice(`Saved ${count} local layer/source-file items in this browser.`)
                } catch (reason) {
                  setError(errorText(reason))
                } finally {
                  setCacheBusy(false)
                }
              }}
            >
              {cacheBusy ? 'Saving local GIS files…' : 'Cache GIS layers and originals'}
            </Button>
            {result.warnings?.map((warning: string, i: number) => (
              <InlineAlert key={i} tone="warning">
                {warning}
              </InlineAlert>
            ))}
            {result.layers.map((layer: { name: string; data: GeoJSON.FeatureCollection }, index: number) => (
              <div key={index} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <p className="text-sm">
                  {layer.name} · {layer.data.features.length} features ·{' '}
                  {[...new Set(layer.data.features.map((feature) => feature.geometry?.type || 'No geometry'))].join(
                    ', ',
                  )}
                </p>
                <Button
                  size="sm"
                  onClick={() =>
                    onVectors([
                      {
                        id: crypto.randomUUID(),
                        name: layer.name,
                        data: layer.data,
                        color: '#0f766e',
                        visible: true,
                        original: result.original,
                      },
                    ])
                  }
                >
                  Add {layer.name} to map
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    downloadText(JSON.stringify(layer.data), `converted-${index + 1}.geojson`, 'application/geo+json')
                  }
                >
                  Download GeoJSON
                </Button>
              </div>
            ))}
            {result.layers.map((layer: { name: string; data: GeoJSON.FeatureCollection }, index: number) => (
              <details key={`match-${index}`} className="rounded border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Match {layer.name} attributes to a source schema
                </summary>
                <PortalDraftReview
                  sourceName={layer.name}
                  rows={layer.data.features.map((feature) => feature.properties ?? {})}
                  geometry={layer.data}
                />
              </details>
            ))}
            {!!result.archiveEntries?.length && (
              <details>
                <summary>Archive contents ({result.archiveEntries.length})</summary>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">
                  {result.archiveEntries.join('\n')}
                </pre>
              </details>
            )}
          </>
        )}
      </div>
      <PortalDraftReview write={write} canWrite={canWrite} />
      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="font-semibold">Zotero / bibliographic CSV</h3>
        <p className="text-sm text-muted-foreground">
          Review source columns, map titles and identifiers, and find repeated DOIs before a portal draft import. Every
          source column is retained. Duplicates are flagged, never merged automatically; publishing stays in the portal.
        </p>
        <input
          aria-label="Bibliographic CSV"
          type="file"
          accept=".csv"
          className="max-w-full text-sm"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            try {
              if (file.size > 20 * 1024 * 1024) throw new Error('Choose a CSV under 20 MB.')
              const table = checkedCsv(await file.text())
              setBibliography(table)
              setTitleColumn(table.headers.find((key) => /^title$/i.test(key)) || '')
              setDoiColumn(table.headers.find((key) => /^doi$/i.test(key)) || '')
              setPage(0)
              setError('')
            } catch (reason) {
              setBibliography(undefined)
              setError(errorText(reason))
            }
          }}
        />
        {bibliography && (
          <>
            <div className="flex flex-wrap gap-3">
              {[
                ['Title column', titleColumn, setTitleColumn],
                ['DOI column', doiColumn, setDoiColumn],
              ].map(([label, value, setValue]) => (
                <label key={String(label)} className="text-sm">
                  {String(label)}
                  <select
                    aria-label={String(label)}
                    value={String(value)}
                    className="ml-2 rounded-md border bg-background p-2"
                    onChange={(event) => (setValue as typeof setTitleColumn)(event.target.value)}
                  >
                    <option value="">Not supplied</option>
                    {bibliography.headers.map((header) => (
                      <option key={header}>{header}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="text-sm">
              {bibliographyRows.length} records · {[...duplicateCounts.values()].filter((count) => count > 1).length}{' '}
              repeated DOI identifiers ·{' '}
              {titleColumn
                ? bibliographyRows.filter((row) => !row[titleColumn]?.trim()).length
                : bibliographyRows.length}{' '}
              records without a mapped title
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
                Previous citations
              </Button>
              <p className="text-sm">
                Page {current + 1} of {pages}
              </p>
              <Button size="sm" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
                Next citations
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadText(
                    JSON.stringify(
                      {
                        schema: 'nechako-bibliography-review-v1',
                        mapping: { title: titleColumn, doi: doiColumn },
                        records: bibliographyRows,
                        duplicateDois: [...duplicateCounts.entries()].filter(([, count]) => count > 1),
                      },
                      null,
                      2,
                    ),
                    'bibliography-review.json',
                    'application/json',
                  )
                }
              >
                Export draft review
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadText(
                    csvExport(
                      bibliography.headers,
                      bibliographyRows.map((row) => bibliography.headers.map((key) => row[key])),
                    ),
                    'bibliography.csv',
                    'text/csv',
                  )
                }
              >
                Export all columns
              </Button>
            </div>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">
              {JSON.stringify(bibliographyRows.slice(current * 50, (current + 1) * 50), null, 2)}
            </pre>
          </>
        )}
      </div>
      <PortalMonitoringImport />
      <PortalGpapImport onVectors={onVectors} />
      <PortalLocalAttachments />
      <PortalLocalDrafts onVectors={onVectors} />
    </div>
  )
}
