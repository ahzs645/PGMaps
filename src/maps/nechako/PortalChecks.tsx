import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { InlineAlert, SearchInput } from '@/components/ui/map-panels'
import { errorText, parsePortalSearch, portalRead } from '@/lib/nechakoPortal'
import { geographicArea, type VectorData } from './data/workspace'
import { PortalSubmission } from './PortalSubmission'
import { downloadText } from '@/lib/download'
import { csvExport } from './data/monitoring'
import { fetchJson } from '@/lib/fetchJson'
import { SHOWCASE_BASE, type CatalogueSource } from './data/showcase'
import { PortalExpressionBuilder } from './PortalExpressionBuilder'
import { checkedSavedSearches, QUERY_STORAGE_KEY, type SavedSearch } from './data/searchBuilder'
import { RecordDialog } from '@/components/ui/record-dialog'

export function useReadCheck(read = portalRead) {
  const [state, setState] = useState<{ loading: boolean; data?: unknown; error?: string }>({ loading: false })
  const request = useRef<AbortController>()
  useEffect(
    () => () => {
      const pending = request.current
      request.current = undefined
      pending?.abort()
    },
    [],
  )
  const run = useCallback(
    async (path: string, params?: Record<string, string>) => {
      request.current?.abort()
      const controller = new AbortController()
      request.current = controller
      setState({ loading: true })
      const timeout = setTimeout(() => controller.abort(), 60000)
      try {
        const data = await read(path, params, controller.signal)
        if (request.current === controller && !controller.signal.aborted) setState({ loading: false, data })
      } catch (error) {
        if (request.current === controller)
          setState({
            loading: false,
            error: controller.signal.aborted ? 'The request timed out or was cancelled.' : errorText(error),
          })
      } finally {
        clearTimeout(timeout)
      }
    },
    [read],
  )
  return { ...state, run }
}

export function JsonResults({ data }: { data: unknown }) {
  const [page, setPage] = useState(0)
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && 'results' in data && Array.isArray(data.results)
      ? data.results
      : null
  const size = 20
  const pages = rows ? Math.max(1, Math.ceil(rows.length / size)) : 1
  const current = Math.min(page, pages - 1)
  return (
    <div className="rounded-lg border p-4">
      {rows && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {rows.length} records · Page {current + 1} of {pages}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={current === 0} onClick={() => setPage(current - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
      <pre className="max-h-[500px] overflow-auto whitespace-pre-wrap break-words text-xs">
        {JSON.stringify(rows ? rows.slice(current * size, (current + 1) * size) : data, null, 2)}
      </pre>
    </div>
  )
}

export function CheckState({
  loading,
  error,
  data,
  local = false,
  showData = true,
}: {
  loading: boolean
  error?: string
  data?: unknown
  local?: boolean
  showData?: boolean
}) {
  return (
    <div className="space-y-3" aria-live="polite">
      {loading && <InlineAlert loading>{local ? 'Loading bundled data…' : 'Requesting the live portal…'}</InlineAlert>}
      {error && (
        <InlineAlert tone="error" title={local ? 'Bundled data unavailable' : 'Portal request failed'}>
          {error}
          {!local && (
            <p className="mt-2">
              A registration error needs investigation in the portal configuration. A browser “Failed to fetch” can also
              indicate CORS or a network failure.
            </p>
          )}
        </InlineAlert>
      )}
      {showData && data !== undefined && <JsonResults data={data} />}
    </div>
  )
}

export function PortalSearch({
  mapBounds,
  vectors = [],
  initialQuery = 'nechako',
  onMonitoring,
}: {
  mapBounds?: [number, number, number, number]
  vectors?: VectorData[]
  initialQuery?: string
  onMonitoring?: (context: { submissionId: string; formId: string; layerId?: string; recId?: string }) => void
}) {
  const contexts = useReadCheck()
  const results = useReadCheck()
  const [query, setQuery] = useState(initialQuery)
  const [savedQueries, setSavedQueries] = useState<SavedSearch[]>(() => {
    try {
      return checkedSavedSearches(JSON.parse(localStorage.getItem(QUERY_STORAGE_KEY) || '[]'))
    } catch {
      return []
    }
  })
  const [queryName, setQueryName] = useState('')
  const [queryStorageError, setQueryStorageError] = useState('')
  const [fields, setFields] = useState<string[]>([])
  const [syntaxError, setSyntaxError] = useState('')
  const [tree, setTree] = useState<unknown>()
  const [submitted, setSubmitted] = useState(false)
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [areaMode, setAreaMode] = useState<'none' | 'extent' | 'polygon'>('none')
  const [areaVectorId, setAreaVectorId] = useState('')
  const [bounds, setBounds] = useState<[number, number, number, number]>([-126, 52, -122, 56])
  const [selectedSubmission, setSelectedSubmission] = useState('')
  const runContexts = contexts.run
  useEffect(() => {
    void runContexts('rest/portal/getSearchContext.php', { types: JSON.stringify(['metadata', 'content']) })
  }, [runContexts])
  const available = Array.isArray(contexts.data)
    ? contexts.data.flatMap((item) => (typeof item?.context === 'string' ? [item.context as string] : []))
    : []
  // Until changed, search every currently advertised context. Keep selections
  // explicit after the user edits them, including an empty selection.
  const [fieldsEdited, setFieldsEdited] = useState(false)
  const selected = fieldsEdited ? fields.filter((field) => available.includes(field)) : available
  const persistQueries = (queries: SavedSearch[]) => {
    try {
      const checked = checkedSavedSearches(queries)
      localStorage.setItem(QUERY_STORAGE_KEY, JSON.stringify(checked))
      setSavedQueries(checked)
      setQueryStorageError('')
    } catch (reason) {
      setQueryStorageError(errorText(reason))
    }
  }
  const search = () => {
    setSyntaxError('')
    try {
      if (!selected.length) throw new Error('Select at least one search context.')
      const keys = parsePortalSearch(query)
      let area: { geojson: string } | null = areaMode === 'extent' ? geographicArea(bounds) : null
      if (areaMode === 'polygon') {
        const vector = vectors.find((item) => item.id === areaVectorId)
        if (
          !vector?.data.features.length ||
          vector.data.features.some(
            (feature) => !feature.geometry || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type),
          )
        )
          throw new Error('Choose a nonempty polygon layer as the search area.')
        area = { geojson: JSON.stringify({ ...vector.data, crs: { type: 'name', properties: { name: 'EPSG:4326' } } }) }
      }
      setTree(keys)
      setSubmitted(true)
      setSubmittedQuery(query)
      void results.run('rest/portal/getSearchResults.php', {
        keys: JSON.stringify(keys),
        fields: JSON.stringify(selected),
        area: JSON.stringify(area),
      })
    } catch (error) {
      setSubmitted(false)
      setTree(undefined)
      setSyntaxError(errorText(error))
    }
  }
  return (
    <div className="max-w-4xl space-y-5">
      <h2 className="text-xl font-semibold">Portal submission search</h2>
      <p className="text-sm text-muted-foreground">
        Search the portal’s metadata and content using its expression format. The existing literature project searches a
        separate research dataset.
      </p>
      <InlineAlert title="Live portal submissions">
        Search uses the original portal's catalogue and permissions. Direct PGMaps requests can receive a registration
        error; configure the verified gateway in Account / Connection for local access. Bundled research is a separate
        collection.
      </InlineAlert>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          search()
        }}
        className="space-y-4"
      >
        <label className="block text-sm font-medium">
          Search expression
          <SearchInput
            className="mt-1 w-full rounded-md border bg-background p-3 text-base"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search expression"
          />
        </label>
        <PortalExpressionBuilder onApply={setQuery} />
        <p className="text-xs text-muted-foreground">
          Examples: salmon AND water; (salmon OR trout) AND river; {'{Submission ID} >= 100'}. Separate terms imply OR.
          Use quoted text and {'{column}'} comparisons; ! negates a comparison operator.
        </p>
        <fieldset className="rounded-lg border p-4">
          <legend className="px-1 text-sm font-medium">Search contexts</legend>
          {contexts.loading && <InlineAlert loading>Loading search contexts…</InlineAlert>}
          {contexts.error && <InlineAlert tone="error">{contexts.error}</InlineAlert>}
          <div className="grid gap-3 sm:grid-cols-2">
            {available.map((field) => (
              <label key={field} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(field)}
                  onChange={(event) => {
                    setFieldsEdited(true)
                    setFields(event.target.checked ? [...selected, field] : selected.filter((item) => item !== field))
                  }}
                />
                {field}
              </label>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => {
              setFieldsEdited(false)
              void runContexts('rest/portal/getSearchContext.php', { types: JSON.stringify(['metadata', 'content']) })
            }}
          >
            Reload contexts
          </Button>
        </fieldset>
        <fieldset className="space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">Geographic limit</legend>
          <select
            aria-label="Search geographic limit"
            value={areaMode}
            onChange={(event) => setAreaMode(event.target.value as typeof areaMode)}
            className="rounded-md border bg-background p-2 text-base"
          >
            <option value="none">No geographic limit</option>
            <option value="extent">Longitude/latitude extent</option>
            <option value="polygon">Imported or drawn polygon layer</option>
          </select>
          {areaMode === 'extent' && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {['West', 'South', 'East', 'North'].map((label, index) => (
                  <label key={label} className="text-sm">
                    {label}
                    <input
                      aria-label={`Search ${label.toLowerCase()}`}
                      type="number"
                      step="any"
                      value={bounds[index]}
                      className="mt-1 w-full rounded-md border bg-background p-2"
                      onChange={(event) =>
                        setBounds(
                          (current) =>
                            current.map((value, i) =>
                              i === index ? Number(event.target.value) : value,
                            ) as typeof bounds,
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!mapBounds}
                onClick={() => {
                  if (mapBounds) setBounds(mapBounds)
                }}
              >
                Use current map extent
              </Button>
              <p className="text-xs text-muted-foreground">
                Sends the portal client’s area.geojson contract in EPSG:4326. Live spatial results remain unverified
                while registration blocks the endpoint.
              </p>
            </>
          )}
          {areaMode === 'polygon' && (
            <label className="block text-sm">
              Search area layer
              <select
                aria-label="Search area layer"
                value={areaVectorId}
                onChange={(event) => setAreaVectorId(event.target.value)}
                className="ml-2 max-w-full rounded-md border bg-background p-2 text-base"
              >
                <option value="">Choose a polygon layer from Layers / Files</option>
                {vectors
                  .filter(
                    (item) =>
                      item.data.features.length > 0 &&
                      item.data.features.every(
                        (feature) => feature.geometry && ['Polygon', 'MultiPolygon'].includes(feature.geometry.type),
                      ),
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
              <p className="mt-2 text-xs text-muted-foreground">
                The original client also sends vector search areas as GeoJSON. Live geographic filtering needs
                verification after registration is fixed.
              </p>
            </label>
          )}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={results.loading || !available.length}>
            Search portal
          </Button>
          <Button type="button" asChild variant="outline">
            <a href="https://nechakowatershed-portal.ca/" target="_blank" rel="noreferrer">
              Search in original portal
            </a>
          </Button>
        </div>
      </form>
      <details className="space-y-3 rounded-lg border p-3">
        <summary className="cursor-pointer font-medium">Saved queries in this browser ({savedQueries.length})</summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Saves the expression, contexts and geographic filter on this device. Polygon queries refer to a workspace
            layer; load that layer before running the query. Saving never submits or publishes a portal record.
          </p>
          <label className="grid gap-1 text-sm">
            Query name
            <input
              aria-label="Saved query name"
              className="rounded-md border bg-background p-2 text-base"
              maxLength={160}
              value={queryName}
              onChange={(e) => setQueryName(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!queryName.trim() || savedQueries.length >= 50}
              onClick={() =>
                persistQueries([
                  ...savedQueries,
                  {
                    id: crypto.randomUUID(),
                    name: queryName.trim(),
                    expression: query,
                    contexts: selected,
                    area: { mode: areaMode, bounds, vectorId: areaVectorId },
                  },
                ])
              }
            >
              Save current query
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!savedQueries.length}
              onClick={() =>
                downloadText(JSON.stringify(savedQueries, null, 2), 'nechako-saved-queries.json', 'application/json')
              }
            >
              Export saved queries
            </Button>
            <label className="text-sm">
              Import saved queries
              <input
                aria-label="Import saved queries"
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  try {
                    if (file.size > 200000) throw new Error('Saved-query imports are limited to 200 KB.')
                    persistQueries(checkedSavedSearches(JSON.parse(await file.text())))
                  } catch (reason) {
                    setQueryStorageError(errorText(reason))
                  }
                  e.target.value = ''
                }}
              />
            </label>
          </div>
          {queryStorageError && <InlineAlert tone="error">{queryStorageError}</InlineAlert>}
          {savedQueries.map((saved) => (
            <div key={saved.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
              <span className="min-w-0 flex-1 break-words text-sm">{saved.name}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setQuery(saved.expression)
                  setFields(saved.contexts)
                  setFieldsEdited(true)
                  setAreaMode(saved.area.mode)
                  setBounds(saved.area.bounds)
                  setAreaVectorId(saved.area.vectorId)
                  setQueryName(saved.name)
                }}
              >
                Load {saved.name}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => persistQueries(savedQueries.filter((item) => item.id !== saved.id))}
              >
                Remove {saved.name}
              </Button>
            </div>
          ))}
        </div>
      </details>
      {syntaxError && <InlineAlert tone="error">{syntaxError}</InlineAlert>}
      {submitted && (
        <div className="space-y-3">
          <p className="text-sm">Results for: {submittedQuery}</p>
          <CheckState {...results} showData={false} />
          {results.data !== undefined && (
            <SubmissionResults key={submittedQuery} data={results.data} onSelect={setSelectedSubmission} />
          )}
        </div>
      )}
      <RecordDialog
        open={!!selectedSubmission}
        title={`Portal submission ${selectedSubmission}`}
        onClose={() => setSelectedSubmission('')}
      >
        <PortalSubmission submissionId={selectedSubmission || undefined} onMonitoring={onMonitoring} />
      </RecordDialog>
      <PortalSubmission onMonitoring={onMonitoring} />
      {tree !== undefined && (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm">Submitted expression tree</summary>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(tree, null, 2)}</pre>
        </details>
      )}
      <Link
        className="inline-block text-sm text-primary underline"
        to="/projects/nechako-watershed-research-portal"
      >
        Open the existing literature project
      </Link>
    </div>
  )
}

function ReadOnlyCheck({ title, path, params }: { title: string; path: string; params?: Record<string, string> }) {
  const check = useReadCheck()
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-semibold">{title}</h3>
      <Button variant="outline" size="sm" disabled={check.loading} onClick={() => void check.run(path, params)}>
        Check {title.toLowerCase()}
      </Button>
      <CheckState {...check} />
    </div>
  )
}

export function PortalProjects() {
  return (
    <div className="max-w-4xl space-y-5">
      <h2 className="text-xl font-semibold">Projects and monitoring</h2>
      <p className="text-sm text-muted-foreground">
        PGMaps already has project packages and research viewers. Portal saved projects have their own camera, layers,
        styles, ownership, sharing and history. Use Layers → Save, load and import workspaces to review native portal
        project JSON; conversion limits are reported and the original is retained. Protected project synchronization
        still needs server integration.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link to="/projects">PGMaps project library</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/projects/nechako-watershed-research-portal">Nechako literature</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/dev/water-temperature">Water temperature</Link>
        </Button>
      </div>
      <ReadOnlyCheck title="Saved projects" path="rest/openmap/savedProjects.php" params={{ mode: 'list' }} />
      <ReadOnlyCheck title="Default project" path="rest/openmap/getDefaultProject.php" />
      <ReadOnlyCheck
        title="Available report forms"
        path="rest/portal/getForms.php"
        params={{ page: '1', start: '0', limit: '25' }}
      />
      <InlineAlert title="Monitoring CSV is available in the Monitoring view">
        Column/station matching, time zones, quality validation, paged tables, line/bar and dual-axis charts, statistics
        and exports are available for local CSV files. Protected portal schema/data integration still needs an
        authenticated sample.
      </InlineAlert>
    </div>
  )
}

function SubmissionResults({ data, onSelect }: { data: unknown; onSelect: (id: string) => void }) {
  const [page, setPage] = useState(0)
  const source = data && typeof data === 'object' && 'results' in data ? data.results : data
  if (!Array.isArray(source)) return null
  const rows = source.filter(
    (value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value),
  )
  const pages = Math.max(1, Math.ceil(rows.length / 25)),
    current = Math.min(page, pages - 1)
  const columns = ['submission_id', 'submission_title', 'submission_name', 'submission_date', 'submitted_by']
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Submission table: {rows.length} object records · Page {current + 1} of {pages}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={!current} onClick={() => setPage(current - 1)}>
          Previous submissions
        </Button>
        <Button size="sm" variant="outline" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
          Next submissions
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            downloadText(
              csvExport(
                columns,
                rows.map((row) => columns.map((key) => row[key])),
              ),
              'portal-search-results.csv',
              'text/csv',
            )
          }
        >
          Export submission results
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead>
            <tr>
              {columns.map((key) => (
                <th key={key} className="p-2">
                  {key.replace(/_/g, ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(current * 25, (current + 1) * 25).map((row, index) => (
              <tr key={index} className="border-t">
                {columns.map((key) => (
                  <td key={key} className="p-2">
                    {key === 'submission_id' && /^[1-9]\d*$/.test(String(row[key])) ? (
                      <button className="text-primary underline" onClick={() => onSelect(String(row[key]))}>
                        {String(row[key])}
                      </button>
                    ) : (
                      String(row[key] ?? 'Not supplied')
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const readSnapshotJson: typeof portalRead = (path, _params, signal) => fetchJson(path, signal)

export function PortalFormats({ defaultSource = 'live' }: { defaultSource?: CatalogueSource }) {
  const [source, setSource] = useState(defaultSource)
  const path = source === 'snapshot' ? `${SHOWCASE_BASE}spatial-formats.json` : 'rest/portal/getSpatialFormats.php'
  const check = useReadCheck(source === 'snapshot' ? readSnapshotJson : portalRead)
  const run = check.run
  useEffect(() => {
    void run(path)
  }, [run, path])
  return (
    <div className="max-w-4xl space-y-4">
      <h2 className="text-xl font-semibold">
        {source === 'snapshot' ? 'Bundled spatial format registry' : 'Live spatial format registry'}
      </h2>
      <label className="block text-sm font-medium">
        Format registry source
        <select
          aria-label="Format registry source"
          className="ml-2 max-w-full rounded-md border bg-background p-2 text-base"
          value={source}
          onChange={(event) => setSource(event.target.value as CatalogueSource)}
        >
          <option value="snapshot">Repository snapshot</option>
          <option value="live">Live portal registry</option>
        </select>
      </label>
      <p className="text-sm text-muted-foreground">
        These formats are advertised by the portal. Listing a format does not verify import/export round trips or make
        it a supported PGMaps file upload.
      </p>
      <Button variant="outline" disabled={check.loading} onClick={() => void run(path)}>
        Refresh formats
      </Button>
      <CheckState {...check} local={source === 'snapshot'} />
      <p className="text-sm text-muted-foreground">
        The submission chooser additionally lists KMZ. Documents, images, audio/video, monitoring CSV, Zotero CSV and
        GeoPaparazzi archives have separate workflows. See the comparison for conversion and viewer gaps.
      </p>
    </div>
  )
}
