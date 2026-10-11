import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadBlob, downloadText } from '@/lib/download'
import { errorText } from '@/lib/nechakoPortal'
import { convertFiles } from './data/conversion'
import { checkedCsv, csvExport } from './data/monitoring'
import type { VectorData } from './data/workspace'

export function PortalFiles({ onVectors }: { onVectors: (layers: VectorData[]) => void }) {
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
  const [preview, setPreview] = useState<File>(),
    [previewUrl, setPreviewUrl] = useState('')
  useEffect(() => {
    if (!preview) {
      setPreviewUrl('')
      return
    }
    const url = URL.createObjectURL(preview)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [preview])
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
          GeoJSON imports locally. Shapefile sidecars/ZIP, GML, GPX, KML/KMZ, SQLite, SpatiaLite and GeoPackage use the
          optional GDAL service. Each converted layer remains separate; attributes and geometry are normalized to WGS84.
          The original files remain available below. GeoPaparazzi currently provides a database inventory.
        </p>
        <label className="block text-sm">
          GIS files (20 MB combined)
          <input
            aria-label="GIS files"
            type="file"
            multiple
            accept=".geojson,.json,.shp,.shx,.dbf,.prj,.cpg,.zip,.gml,.gpx,.kml,.kmz,.db,.sqlite,.gpkg,.gpap"
            className="mt-1 block w-full text-sm"
            onChange={(event) => {
              generation.current++
              setLoading(false)
              setResult(undefined)
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
            {!!result.tables?.length && (
              <pre className="max-h-80 overflow-auto text-xs">{JSON.stringify(result.tables, null, 2)}</pre>
            )}
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
      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="font-semibold">Document and media preview</h3>
        <p className="text-sm text-muted-foreground">
          Preview local raster images, PDF, audio or video. Other documents and archives retain their original download.
          Protected portal attachments need an authorized portal session.
        </p>
        <input
          aria-label="Attachment preview file"
          type="file"
          className="max-w-full text-sm"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file && file.size > 50 * 1024 * 1024) {
              setError('Preview files must be under 50 MB.')
              setPreview(undefined)
            } else {
              setPreview(file)
              setError('')
            }
          }}
        />
        {preview && (
          <>
            <p className="text-sm">
              {preview.name} · {preview.size.toLocaleString()} bytes · {preview.type || 'Type not supplied'}
            </p>
            {/^image\/(png|jpeg|gif|webp)$/.test(preview.type) && (
              <img src={previewUrl} alt={preview.name} className="max-h-[500px] max-w-full" />
            )}
            {preview.type === 'application/pdf' && (
              <iframe title={`Preview ${preview.name}`} src={previewUrl} sandbox="" className="h-[500px] w-full" />
            )}
            {preview.type.startsWith('audio/') && <audio src={previewUrl} controls className="max-w-full" />}
            {preview.type.startsWith('video/') && (
              <video src={previewUrl} controls className="max-h-[500px] max-w-full" />
            )}
            <Button size="sm" variant="outline" onClick={() => downloadBlob(preview, preview.name)}>
              Download original attachment
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
