import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { InlineAlert, SearchInput } from '@/components/ui/map-panels'
import { downloadBlob, downloadText } from '@/lib/download'
import { formatDate } from '@/lib/format'
import { errorText, portalRead, PORTAL_CONNECTION_EVENT } from '@/lib/nechakoPortal'
import { PortalExpressionBuilder } from './PortalExpressionBuilder'
import { PortalSubmissionDialog } from './PortalSubmissionDialog'
import { buildPublicSubmissionArchive } from './data/submissionDownload'
import { loadSubmissionFormDefinitions } from './data/submissionFormLayout'
import { compileSearchClause } from './data/searchBuilder'
import {
  browseSubmissionSnapshot,
  snapshotSearchFieldGroups,
  submissionBrowserForms,
  UNKNOWN_SUBMISSION_YEAR,
} from './data/submissionBrowser'
import { csvExport } from './data/monitoring'
import { geographicArea, type VectorData } from './data/workspace'
import {
  filterSubmissionSnapshot,
  loadSubmissionSnapshot,
  submissionType,
  type SubmissionRecord,
  type SubmissionSnapshot,
} from './data/submissionSnapshot'

type Selection = 'normal' | 'extent' | 'area'
const selectClass = 'min-w-0 rounded border bg-background px-2 py-1.5 text-sm'
const PAGE_SIZE = 25

export function PortalSubmissionSearch({
  mapBounds,
  vectors = [],
}: {
  mapBounds?: [number, number, number, number]
  vectors?: VectorData[]
}) {
  const [snapshot, setSnapshot] = useState<SubmissionSnapshot>(),
    [loadError, setLoadError] = useState(''),
    [downloading, setDownloading] = useState(false),
    [retry, setRetry] = useState(0)
  const [expression, setExpression] = useState(''),
    [appliedExpression, setAppliedExpression] = useState(''),
    [formId, setFormId] = useState('')
  const [selection, setSelection] = useState<Selection>('normal'),
    [layerId, setLayerId] = useState(''),
    [geoIds, setGeoIds] = useState<Set<string>>()
  const [geoApplied, setGeoApplied] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [page, setPage] = useState(0)
  const [selected, setSelected] = useState<SubmissionRecord>(),
    [builder, setBuilder] = useState<'expression' | 'simple'>(),
    [simpleWords, setSimpleWords] = useState(''),
    [simpleMode, setSimpleMode] = useState<'AND' | 'OR'>('AND'),
    [helpOpen, setHelpOpen] = useState(false)
  const [view, setView] = useState<'search' | 'browser'>('search')
  const [browserFormId, setBrowserFormId] = useState('')
  const [browserYear, setBrowserYear] = useState('')
  const [browserText, setBrowserText] = useState('')
  const [browserPage, setBrowserPage] = useState(0)
  const spatialRequest = useRef<AbortController | undefined>(undefined)
  useEffect(() => {
    const invalidate = () => {
      spatialRequest.current?.abort()
      spatialRequest.current = undefined
      setGeoIds(undefined)
      setGeoApplied(false)
      setBusy(false)
    }
    window.addEventListener(PORTAL_CONNECTION_EVENT, invalidate)
    return () => {
      spatialRequest.current?.abort()
      window.removeEventListener(PORTAL_CONNECTION_EVENT, invalidate)
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoadError('')
    void loadSubmissionSnapshot(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setSnapshot(data)
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setLoadError(errorText(reason))
      })
    return () => controller.abort()
  }, [retry])
  const polygons = vectors.filter(
    (vector) =>
      vector.data.features.length &&
      vector.data.features.every(
        (feature) => feature.geometry && ['Polygon', 'MultiPolygon'].includes(feature.geometry.type),
      ),
  )
  const forms = useMemo(
    () =>
      [...new Map((snapshot?.records ?? []).map((record) => [record.formId, record.formName])).entries()].sort((a, b) =>
        a[1].localeCompare(b[1]),
      ),
    [snapshot],
  )
  const searchRows = useMemo(() => {
    if (!snapshot) return []
    return filterSubmissionSnapshot(snapshot.records, appliedExpression, formId, geoIds)
  }, [snapshot, appliedExpression, formId, geoIds])
  const browseForms = useMemo(() => submissionBrowserForms(snapshot?.records ?? []), [snapshot])
  const fieldOptions = useMemo(() => snapshotSearchFieldGroups(snapshot?.records ?? []), [snapshot])
  const browserRows = useMemo(
    () => browseSubmissionSnapshot(snapshot?.records ?? [], browserFormId, browserYear, browserText),
    [snapshot, browserFormId, browserYear, browserText],
  )
  const rows = view === 'browser' ? browserRows : searchRows
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
    currentPage = Math.min(view === 'browser' ? browserPage : page, pages - 1)
  const setResultPage = view === 'browser' ? setBrowserPage : setPage
  const chooseBrowserGroup = (id: string, year = '') => {
    setBrowserFormId(id)
    setBrowserYear(year)
    setBrowserPage(0)
  }
  const search = async () => {
    if (!snapshot || busy) return
    const controller = new AbortController()
    spatialRequest.current = controller
    setError('')
    try {
      // Validate before replacing the previous successful result collection.
      filterSubmissionSnapshot(snapshot.records, expression, formId)
      if (selection !== 'normal') {
        let area: { geojson: string }
        if (selection === 'extent') {
          if (!mapBounds) throw new Error('The current map extent is not available.')
          area = geographicArea(mapBounds)
        } else {
          const vector = polygons.find((item) => item.id === layerId)
          if (!vector) throw new Error('Choose a polygon layer for the source area search.')
          area = {
            geojson: JSON.stringify({ ...vector.data, crs: { type: 'name', properties: { name: 'EPSG:4326' } } }),
          }
        }
        setBusy(true)
        const result = await portalRead(
          'rest/portal/getSearchResults.php',
          {
            keys: JSON.stringify({
              token: 'comparator',
              value: '>=',
              left: { token: 'column', value: 'Submission ID' },
              right: { token: 'number', value: '1' },
            }),
            fields: JSON.stringify(['Submission ID']),
            area: JSON.stringify(area),
          },
          controller.signal,
        )
        if (controller.signal.aborted || spatialRequest.current !== controller) return
        if (
          !result ||
          typeof result !== 'object' ||
          !('results' in result) ||
          !Array.isArray(result.results) ||
          result.results.some((row) => !row || typeof row !== 'object' || !/^[1-9]\d*$/.test(String(row.submission_id)))
        )
          throw new Error('The original portal did not return a valid spatial submission selection.')
        setGeoIds(new Set(result.results.map((row) => String(row.submission_id))))
        setGeoApplied(true)
      } else {
        setGeoIds(undefined)
        setGeoApplied(false)
      }
      setAppliedExpression(expression)
      setPage(0)
    } catch (reason) {
      if (controller.signal.aborted || spatialRequest.current !== controller) return
      setError(errorText(reason))
      if (selection !== 'normal') {
        setGeoIds(new Set())
        setGeoApplied(false)
      }
    } finally {
      if (spatialRequest.current === controller) {
        spatialRequest.current = undefined
        setBusy(false)
      }
    }
  }
  const changeSelection = (next: Selection) => {
    setSelection(next)
    setGeoIds(undefined)
    setGeoApplied(false)
    setLayerId('')
    setPage(0)
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-nechako-submission-search>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{view === 'browser' ? 'Submission Browser' : 'Submission Search'}</h3>
        <Button size="sm" variant="outline" onClick={() => setView(view === 'search' ? 'browser' : 'search')}>
          {view === 'search' ? 'Switch to Submission Browser' : 'Switch to Submission Search'}
        </Button>
      </div>
      <div hidden={view !== 'search'} className="shrink-0 space-y-2">
        <form
          className="flex shrink-0 gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void search()
          }}
        >
          <SearchInput
            aria-label="Submission search expression"
            placeholder="Search submission titles, names and field content"
            value={expression}
            onChange={(event) => setExpression(event.target.value)}
            onClear={() => {
              setExpression('')
              setAppliedExpression('')
              setGeoIds(undefined)
              setGeoApplied(false)
              setPage(0)
            }}
            wrapperClassName="min-w-0 flex-1"
            className="w-full"
            disabled={busy}
          />
          <Button type="submit" size="sm" disabled={!snapshot || busy}>
            {busy ? 'Searching…' : 'Search'}
          </Button>
        </form>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setBuilder('expression')}>
            Expression Builder
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSimpleWords(expression)
              setBuilder('simple')
            }}
          >
            Simple Expression Builder
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="sm:ml-auto"
            disabled={!rows.length}
            onClick={() =>
              downloadText(
                csvExport(
                  ['Submission ID', 'Type', 'Submission Title', 'Submission Name', 'Submission Date', 'Submitted By'],
                  rows.map((record) => [
                    record.id,
                    submissionType(record),
                    record.title,
                    record.name,
                    record.date,
                    record.submittedBy ?? '',
                  ]),
                ),
                'nechako-submission-search.csv',
                'text/csv',
              )
            }
          >
            Export to CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!snapshot || downloading}
            onClick={async () => {
              if (!snapshot) return
              setDownloading(true)
              setError('')
              try {
                const forms = await loadSubmissionFormDefinitions()
                const blob = await buildPublicSubmissionArchive(snapshot, forms)
                downloadBlob(blob, 'nechako-public-submissions.zip')
              } catch (reason) {
                setError(errorText(reason))
              } finally {
                setDownloading(false)
              }
            }}
          >
            {downloading ? 'Preparing download…' : 'Download public data'}
          </Button>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
          <label className="flex min-w-0 items-center gap-2">
            Form
            <select
              aria-label="Submission form"
              className={`${selectClass} max-w-[250px]`}
              value={formId}
              onChange={(event) => {
                setFormId(event.target.value)
                setPage(0)
              }}
              disabled={busy}
            >
              <option value="">All forms</option>
              {forms.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setHelpOpen(true)}>
            Help
          </Button>
        </div>
      </div>
      {view === 'browser' && (
        <div className="shrink-0 space-y-2">
          <p className="text-xs text-muted-foreground">
            Browse the captured public submissions by form and submission year. Counts describe this capture only. Your
            search expression, form filter and geographic selection are retained when you switch back.
          </p>
          {snapshot && <p className="text-xs text-muted-foreground">Capture scope: {snapshot.manifest.scope}</p>}
          <SearchInput
            aria-label="Filter submission browser"
            placeholder="Filter captured titles, names, IDs and content"
            value={browserText}
            onChange={(event) => {
              setBrowserText(event.target.value)
              setBrowserPage(0)
            }}
            onClear={() => {
              setBrowserText('')
              setBrowserPage(0)
            }}
          />
        </div>
      )}
      {!snapshot && !loadError && <InlineAlert loading>Loading captured submissions…</InlineAlert>}
      {loadError && (
        <InlineAlert tone="error">
          {loadError}
          <Button size="sm" variant="outline" className="ml-2" onClick={() => setRetry((value) => value + 1)}>
            Retry submission snapshot
          </Button>
        </InlineAlert>
      )}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      <div
        className={`min-h-0 flex-1 ${view === 'browser' ? 'grid gap-3 md:grid-cols-[minmax(180px,30%)_minmax(0,1fr)]' : 'flex flex-col'}`}
      >
        {view === 'browser' && (
          <nav
            aria-label="Captured submission hierarchy"
            className="max-h-48 overflow-auto rounded border p-2 text-xs md:max-h-none"
          >
            <Button
              size="sm"
              variant={browserFormId ? 'ghost' : 'secondary'}
              className="mb-2 w-full justify-start"
              aria-pressed={!browserFormId}
              onClick={() => chooseBrowserGroup('')}
            >
              All captured forms ({snapshot?.records.length ?? 0})
            </Button>
            {browseForms.map((form) => (
              <details key={form.id} className="border-t py-2" open={browserFormId === form.id || undefined}>
                <summary className="cursor-pointer break-words font-medium">
                  {form.name} · Form {form.id} ({form.count})
                </summary>
                <div className="mt-2 grid gap-1 pl-2">
                  <button
                    type="button"
                    className="rounded px-2 py-1.5 text-left hover:bg-muted aria-pressed:bg-muted"
                    aria-pressed={browserFormId === form.id && !browserYear}
                    onClick={() => chooseBrowserGroup(form.id)}
                  >
                    All {form.name} submissions ({form.count})
                  </button>
                  {form.years.map((item) => (
                    <button
                      key={item.year}
                      type="button"
                      className="rounded px-2 py-1.5 text-left hover:bg-muted aria-pressed:bg-muted"
                      aria-label={`${form.name} · ${item.year === UNKNOWN_SUBMISSION_YEAR ? 'Date not supplied' : item.year} · ${item.count} captured submissions`}
                      aria-pressed={browserFormId === form.id && browserYear === item.year}
                      onClick={() => chooseBrowserGroup(form.id, item.year)}
                    >
                      {item.year === UNKNOWN_SUBMISSION_YEAR ? 'Date not supplied' : item.year} ({item.count})
                    </button>
                  ))}
                </div>
              </details>
            ))}
          </nav>
        )}
        <div className="min-h-[120px] flex-1 overflow-auto rounded border bg-background" data-nechako-submission-table>
          <table className="w-full min-w-[650px] table-fixed text-left text-xs">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr>
                {[
                  ['Type', 'w-16'],
                  ['Submission Title', 'w-[28%]'],
                  ['Submission Name', 'w-[28%]'],
                  ['Submission Date', 'w-28'],
                  ['Submitted By', 'w-28'],
                ].map(([label, width]) => (
                  <th key={label} className={`${width} border-b p-2 font-medium`}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((record) => (
                <tr key={record.id} className="border-b hover:bg-muted/50" aria-selected={selected?.id === record.id}>
                  <td
                    className="p-2"
                    title={
                      record.parentId === undefined
                        ? 'Parent relationship not supplied'
                        : record.parentId !== null && record.parentId > 0
                          ? `Activity of submission ${record.parentId}`
                          : 'Submission'
                    }
                  >
                    {submissionType(record)}
                  </td>
                  <td className="p-2">
                    <button
                      type="button"
                      className="block w-full truncate text-left text-primary underline-offset-2 hover:underline"
                      title={record.title || `Submission ${record.id}`}
                      onClick={() => setSelected(record)}
                    >
                      {record.title || `Submission ${record.id}`}
                    </button>
                  </td>
                  <td className="truncate p-2" title={record.name}>
                    {record.name || '—'}
                  </td>
                  <td className="truncate p-2" title={record.date}>
                    {record.date || 'Not supplied'}
                  </td>
                  <td className="truncate p-2" title={record.submittedBy}>
                    {record.submittedBy || 'Not supplied'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {snapshot && !rows.length && <p className="p-4 text-sm text-muted-foreground">No matching submissions.</p>}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs">
        <span aria-live="polite">
          {rows.length.toLocaleString()} {view === 'browser' ? 'captured submissions' : 'submissions'} · Page{' '}
          {currentPage + 1} of {pages}
        </span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            aria-label="Previous submissions"
            disabled={!currentPage}
            onClick={() => setResultPage(currentPage - 1)}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label="Next submissions"
            disabled={currentPage + 1 >= pages}
            onClick={() => setResultPage(currentPage + 1)}
          >
            Next
          </Button>
        </div>
      </div>
      <div hidden={view !== 'search'} className="shrink-0">
        <div className="flex flex-wrap gap-2 border-t pt-2 text-xs">
          <label className="flex items-center gap-2">
            Selection Type:
            <select
              aria-label="Submission selection type"
              className={selectClass}
              disabled={busy}
              value={selection}
              onChange={(event) => changeSelection(event.target.value as Selection)}
            >
              <option value="normal">Normal</option>
              <option value="extent" disabled={!mapBounds}>
                Select By Extent
              </option>
              <option value="area" disabled={!polygons.length}>
                Select By Area
              </option>
            </select>
          </label>
          <label className="flex min-w-0 items-center gap-2">
            Selection Layer:
            <select
              aria-label="Submission selection layer"
              className={`${selectClass} max-w-[240px]`}
              value={selection === 'extent' ? 'extent' : layerId}
              disabled={busy || selection === 'normal'}
              onChange={(event) => {
                setLayerId(event.target.value)
                setGeoIds(undefined)
                setGeoApplied(false)
              }}
            >
              {selection === 'extent' ? (
                <option value="extent">Current Extent</option>
              ) : (
                <>
                  <option value="">{selection === 'normal' ? 'No spatial search' : 'Choose a polygon layer'}</option>
                  {polygons.map((vector) => (
                    <option key={vector.id} value={vector.id}>
                      {vector.name}
                    </option>
                  ))}
                </>
              )}
            </select>
          </label>
        </div>
      </div>
      <p className="shrink-0 text-[11px] text-muted-foreground">
        {view === 'search' && selection !== 'normal'
          ? geoApplied
            ? 'Filtered by source spatial selection. '
            : 'Click Search to apply the source spatial selection. '
          : ''}
        {snapshot
          ? `${snapshot.manifest.recordCount.toLocaleString()} captured anonymous submissions · ${formatDate(snapshot.manifest.capturedAt)}`
          : 'Anonymous submission snapshot'}
      </p>
      {selected && snapshot && (
        <PortalSubmissionDialog
          key={selected.id}
          record={selected}
          records={snapshot.records}
          capturedAt={snapshot.manifest.capturedAt}
          onClose={() => setSelected(undefined)}
          onOpenSubmission={(id) => {
            const record = snapshot.records.find((item) => item.id === id)
            if (record) setSelected(record)
            else
              setError(`Submission ${id} is not in the anonymous capture. Find it in the original portal using its ID.`)
          }}
        />
      )}
      {builder && (
        <DialogShell
          title={builder === 'expression' ? 'Expression Builder' : 'Simple Expression Builder'}
          onClose={() => setBuilder(undefined)}
          size="lg"
        >
          {builder === 'expression' ? (
            <PortalExpressionBuilder
              defaultOpen
              fieldOptions={fieldOptions}
              onApply={(value) => {
                setExpression(value)
                setBuilder(undefined)
              }}
            />
          ) : (
            <div className="space-y-3">
              <label className="grid gap-1 text-sm">
                Search words
                <SearchInput
                  aria-label="Simple expression words"
                  value={simpleWords}
                  onChange={(event) => setSimpleWords(event.target.value)}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                Match
                <select
                  aria-label="Simple expression match"
                  className={selectClass}
                  value={simpleMode}
                  onChange={(event) => setSimpleMode(event.target.value as 'AND' | 'OR')}
                >
                  <option value="AND">All words</option>
                  <option value="OR">Any word</option>
                </select>
              </label>
              <Button
                onClick={() => {
                  try {
                    const value = compileSearchClause({
                      kind: 'group',
                      operator: simpleMode,
                      clauses: simpleWords
                        .trim()
                        .split(/\s+/)
                        .filter(Boolean)
                        .map((text) => ({ kind: 'term', text })),
                    })
                    setExpression(value)
                    setBuilder(undefined)
                    setError('')
                  } catch (reason) {
                    setError(errorText(reason))
                  }
                }}
              >
                Use simple expression
              </Button>
            </div>
          )}
        </DialogShell>
      )}
      {helpOpen && (
        <DialogShell title="Submission search help" onClose={() => setHelpOpen(false)} size="md">
          <p className="text-sm leading-6">
            Search all captured field content. Words and quoted phrases support AND, OR and field comparisons; local ~
            contains text. S marks a submission and A its parent-linked activity when the source relationship is
            supplied. Spatial selection asks the original portal for source IDs, then applies these local content
            filters. For live queries and other collections, open Data Inventory → Search collections.
          </p>
        </DialogShell>
      )}
    </div>
  )
}
