import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InlineAlert, SearchInput } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatGroup } from '@/components/ui/stat-group'
import { TabBar } from '@/components/ui/tab-bar'
import { ExternalLink } from '@/components/ui/text-button'
import { fetchJson } from '@/lib/fetchJson'
import { withBase } from '@/lib/dataUrl'
import { formatBytes, formatDate, formatNumber } from '@/lib/format'
import { errorText } from '@/lib/nechakoPortal'
import { SHOWCASE_BASE, type ShowcaseManifest } from './data/showcase'
import {
  buildPortalInventory,
  filterPortalInventory,
  ORIGINAL_PORTAL_URL,
  PORTAL_AUDIT_DATE,
  type InventoryFacet,
  type InventoryPanel,
} from './data/portalInventory'
import { collectionStats, type CollectionFile } from './data/portalCollections'
import {
  readSubmissionManifest,
  SUBMISSION_SNAPSHOT_BASE,
  type SubmissionSnapshotManifest,
} from './data/submissionSnapshot'

const availabilityLabels = {
  bundled: 'Public snapshot available',
  partial: 'Some metadata available',
  original: 'Original portal collection',
} as const

/** Public collection coverage and audit counts; never imports authenticated account data. */
export function PortalInventory({
  onOpen,
  importedFiles = [],
  searchCollections,
}: {
  onOpen?: (panel: InventoryPanel) => void
  importedFiles?: CollectionFile[]
  searchCollections?: ReactNode
}) {
  const [view, setView] = useState<'overview' | 'search'>('overview')
  const [manifest, setManifest] = useState<ShowcaseManifest>()
  const [submissionManifest, setSubmissionManifest] = useState<SubmissionSnapshotManifest>()
  const [submissionError, setSubmissionError] = useState('')
  const [submissionRetry, setSubmissionRetry] = useState(0)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [query, setQuery] = useState('')
  const [facet, setFacet] = useState<InventoryFacet>('all')
  useEffect(() => {
    const controller = new AbortController()
    fetchJson<ShowcaseManifest>(`${SHOWCASE_BASE}manifest.json`, controller.signal)
      .then(setManifest)
      .catch((reason) => {
        if (!controller.signal.aborted) setError(errorText(reason))
      })
    return () => controller.abort()
  }, [retry])
  useEffect(() => {
    const controller = new AbortController()
    readSubmissionManifest(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setSubmissionManifest(value)
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setSubmissionError(errorText(reason))
      })
    return () => controller.abort()
  }, [submissionRetry])
  const submissionFile = submissionManifest?.files?.['submissions.json.gz']
  const entries = useMemo(() => buildPortalInventory(manifest), [manifest])
  const results = useMemo(() => filterPortalInventory(entries, query, facet), [entries, query, facet])
  const imported = useMemo(() => collectionStats(importedFiles), [importedFiles])
  return (
    <div className="space-y-6" data-nechako-inventory>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Watershed information and data</h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Explore the original portal’s collections, people’s projects, stories and geographic information. Each
          collection shows what was observed and what is available in this preview.
        </p>
        <p className="text-xs text-muted-foreground">
          Original interface audit: {formatDate(PORTAL_AUDIT_DATE, { timeZone: 'UTC' })} · Public snapshot:{' '}
          {manifest ? formatDate(manifest.captured_at_utc) : 'Loading date…'}
          {manifest?.public_projects_captured_at_utc && (
            <> · Public saved maps: {formatDate(manifest.public_projects_captured_at_utc)}</>
          )}
        </p>
      </div>
      {searchCollections && (
        <TabBar
          label="Data inventory view"
          idPrefix="nechako-inventory"
          value={view}
          onChange={setView}
          options={[
            { value: 'overview', label: 'Size overview' },
            { value: 'search', label: 'Search collections' },
          ]}
        />
      )}
      <div
        className="space-y-6"
        hidden={Boolean(searchCollections) && view !== 'overview'}
        role={searchCollections ? 'tabpanel' : undefined}
        id="nechako-inventory-panel-overview"
        aria-labelledby={searchCollections ? 'nechako-inventory-tab-overview' : undefined}
      >
        <section className="space-y-3 rounded-lg border p-4" aria-labelledby="portal-submission-size">
          <h3 className="font-semibold" id="portal-submission-size">
            Captured public submissions
          </h3>
          {submissionManifest ? (
            <>
              <StatGroup
                variant="tiles"
                size="sm"
                columns={4}
                items={[
                  { label: 'Submissions', value: formatNumber(submissionManifest.recordCount) },
                  { label: 'Captured fields', value: formatNumber(submissionManifest.fieldCount) },
                  { label: 'Media references', value: formatNumber(submissionManifest.mediaCount) },
                  { label: 'Attachment references', value: formatNumber(submissionManifest.attachmentCount) },
                ]}
              />
              <p className="text-xs text-muted-foreground">
                Captured {formatDate(submissionManifest.capturedAt)} · {formatNumber(submissionManifest.layerCount)}{' '}
                spatial layer references.
                {submissionFile && Number.isSafeInteger(submissionFile.bytes) && submissionFile.bytes >= 0 && (
                  <>
                    {' '}
                    Compressed submission file: {formatBytes(submissionFile.bytes)} (
                    {formatNumber(submissionFile.bytes)} bytes).
                    {Number.isSafeInteger(submissionFile.uncompressedBytes) &&
                      Number(submissionFile.uncompressedBytes) >= 0 && (
                        <>
                          {' '}
                          Decoded JSON: {formatBytes(submissionFile.uncompressedBytes!)} (
                          {formatNumber(submissionFile.uncompressedBytes!)} bytes).
                        </>
                      )}
                  </>
                )}
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                These counts measure the public records and fields captured from the original portal. Embedded media is
                represented by source submission/field references and digests; existing media URLs remain source links.
                Media bodies, attachment/spatial files and monitoring observations are excluded. The measured JSON size
                does not establish total portal storage or the number of private records.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {onOpen ? (
                  <Button variant="outline" size="sm" onClick={() => onOpen('search')}>
                    Browse captured submissions
                  </Button>
                ) : (
                  <Link className="text-sm text-primary underline" to="/dev/nechako/portal?panel=search">
                    Browse captured submissions
                  </Link>
                )}
                <a
                  className="text-sm text-primary underline"
                  href={withBase(`${SUBMISSION_SNAPSHOT_BASE}manifest.json`)}
                  download
                >
                  Download submission manifest
                </a>
                <ExternalLink href={ORIGINAL_PORTAL_URL}>Original portal</ExternalLink>
              </div>
            </>
          ) : submissionError ? (
            <InlineAlert tone="warning" title="Public submission capture unavailable">
              {submissionError}
              <Button
                className="ml-2"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSubmissionError('')
                  setSubmissionRetry((value) => value + 1)
                }}
              >
                Retry submission manifest
              </Button>
              <p className="mt-2">Use the original portal to browse source submissions.</p>
              <ExternalLink href={ORIGINAL_PORTAL_URL}>Original portal</ExternalLink>
            </InlineAlert>
          ) : (
            <InlineAlert loading>Loading public submission counts and measured size…</InlineAlert>
          )}
        </section>
        {imported.files > 0 && (
          <div className="space-y-3 rounded-lg border p-4" data-nechako-session-size>
            <h3 className="font-semibold">Imported information in this browser session</h3>
            <StatGroup
              variant="tiles"
              size="sm"
              columns={4}
              items={[
                { label: 'Imported files', value: imported.files },
                { label: 'Imported records', value: formatNumber(imported.records) },
                {
                  label: 'Original JSON',
                  value: formatBytes(imported.jsonBytes),
                  note: `${formatNumber(imported.jsonBytes)} bytes`,
                },
                { label: 'Unmeasured references', value: imported.unmeasuredReferences },
              ]}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              The original JSON bytes are measured locally. Linked media is not downloaded. Missing or conflicting
              linked-file sizes remain unknown; declared sizes are unverified and do not establish total source storage.
            </p>
            {onOpen && (
              <Button size="sm" variant="outline" onClick={() => onOpen('collections')}>
                Import or inspect a collection
              </Button>
            )}
          </div>
        )}
        <StatGroup
          variant="tiles"
          columns={4}
          items={[
            {
              label: 'Bundled research',
              value: manifest ? formatNumber(manifest.counts.research_records) : '…',
              note: 'nwsviz records',
            },
            {
              label: 'Verified ERA5 record',
              value: formatNumber(25933),
              note: 'Layer 386 / record 1 · live paged read',
            },
            { label: 'Original saved maps', value: 19, note: 'Administrator view · 9 visible without login' },
            { label: 'Source storage', value: 'Unknown', compact: true, note: 'No full server-storage inventory' },
          ]}
        />
        <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
          <h3 className="font-semibold">How much data is available?</h3>
          {manifest && (
            <>
              <p className="text-sm">
                The bundled public snapshot lists <strong>{formatNumber(manifest.files.length)} files</strong> totaling{' '}
                <strong>{formatBytes(manifest.snapshot_file_bytes)}</strong> (
                {formatNumber(manifest.snapshot_file_bytes)} bytes), excluding its manifest.
              </p>
              <p className="text-sm text-muted-foreground">
                This measures research tables, service metadata, derived locations and captured public map definitions.
                Uploaded documents/images, full monitoring tables and source GIS databases are not included. WMS imagery
                remains live; a small map-definition file can reference a much larger dataset.
              </p>
              <a className="text-sm text-primary underline" href={withBase(`${SHOWCASE_BASE}manifest.json`)} download>
                Download measured-file manifest
              </a>
            </>
          )}
          {!manifest && !error && <InlineAlert loading>Loading measured snapshot size…</InlineAlert>}
          {error && (
            <InlineAlert tone="error" title="Snapshot manifest unavailable">
              {error}
              <Button
                className="ml-2"
                size="sm"
                variant="outline"
                onClick={() => {
                  setError('')
                  setRetry((value) => value + 1)
                }}
              >
                Retry
              </Button>
            </InlineAlert>
          )}
          <p className="text-xs text-muted-foreground">
            Counts use different units and source systems. Catalog entries, layer groups, records, saved maps and
            documents overlap in purpose and cannot be added into a single “total data” count. Unknown sizes are
            unmeasured, not zero.
          </p>
        </div>
        <div className="space-y-3">
          <label className="block text-sm font-medium">
            Find a collection
            <SearchInput
              aria-label="Search watershed collections"
              placeholder="Stories, people’s projects, water, photos, schemas…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery('')}
              className="mt-1"
              data-map-search-input="false"
            />
          </label>
          <SegmentedControl
            label="Collection coverage"
            value={facet}
            onChange={setFacet}
            fullWidth={false}
            options={[
              { value: 'all', label: 'All collections' },
              { value: 'bundled', label: 'Has bundled files' },
              { value: 'original', label: 'Original portal / partial' },
            ]}
          />
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {results.length} of {entries.length} collection categories
          </p>
        </div>
        {!results.length && (
          <InlineAlert>
            No collections match these filters.
            <Button
              className="ml-2"
              size="sm"
              variant="outline"
              onClick={() => {
                setQuery('')
                setFacet('all')
              }}
            >
              Reset filters
            </Button>
          </InlineAlert>
        )}
        <div className="grid gap-4 xl:grid-cols-2">
          {results.map((entry) => (
            <article
              key={entry.id}
              className="min-w-0 space-y-3 rounded-lg border p-4"
              aria-labelledby={`inventory-${entry.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="font-semibold" id={`inventory-${entry.id}`}>
                  {entry.title}
                </h3>
                <Badge
                  tone={
                    entry.availability === 'bundled' ? 'success' : entry.availability === 'partial' ? 'info' : 'neutral'
                  }
                >
                  {availabilityLabels[entry.availability]}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">Source: {entry.source}</p>
              <p className="text-sm leading-6">{entry.description}</p>
              <dl className="space-y-2">
                {entry.measures.map((measure) => (
                  <div key={measure.label} className="rounded-md bg-muted/30 px-3 py-2">
                    <div className="flex flex-wrap justify-between gap-1 text-sm">
                      <dt>{measure.label}</dt>
                      <dd className="font-semibold tabular-nums">
                        {measure.value === null ? 'Not inventoried' : `${formatNumber(measure.value)} ${measure.unit}`}
                      </dd>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{measure.evidence}</p>
                  </div>
                ))}
              </dl>
              <p className="text-sm leading-6 text-muted-foreground">{entry.coverage}</p>
              <p className="text-xs text-muted-foreground">
                Bundled files:{' '}
                {entry.bundledBytes === null
                  ? 'Not measured / not bundled'
                  : `${formatBytes(entry.bundledBytes)} (${formatNumber(entry.bundledBytes)} bytes)`}{' '}
                · Full source size: {entry.sourceBytes === null ? 'Unknown' : formatBytes(entry.sourceBytes)}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {entry.panel &&
                  (onOpen ? (
                    <Button variant="outline" size="sm" onClick={() => onOpen(entry.panel!)}>
                      {entry.actionLabel}
                    </Button>
                  ) : (
                    <Link className="text-sm text-primary underline" to={`/dev/nechako/portal?panel=${entry.panel}`}>
                      {entry.actionLabel}
                    </Link>
                  ))}
                {entry.workbenchView && (
                  <Link className="text-sm text-primary underline" to={`/dev/nechako?view=${entry.workbenchView}`}>
                    {entry.workbenchView === 'layers'
                      ? 'Explore map-service catalogue'
                      : entry.workbenchView === 'monitoring'
                        ? 'Open observation workbench'
                        : entry.workbenchView === 'formats'
                          ? 'Inspect supported formats'
                          : 'Browse research records'}
                  </Link>
                )}
                <ExternalLink href={ORIGINAL_PORTAL_URL}>Original portal</ExternalLink>
              </div>
            </article>
          ))}
        </div>
        {manifest && <p className="text-xs leading-5 text-muted-foreground">{manifest.attribution}</p>}
      </div>
      {searchCollections && (
        <div
          hidden={view !== 'search'}
          role="tabpanel"
          id="nechako-inventory-panel-search"
          aria-labelledby="nechako-inventory-tab-search"
        >
          {searchCollections}
        </div>
      )}
    </div>
  )
}
