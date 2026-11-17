import { useEffect, useRef, useState } from 'react'
import { PencilRuler, Radar, Search, SquareArrowOutUpRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { ListHeader, ListState } from '@/components/ui/result-list'
import { Field, roadFieldClass, RoadSelect } from './Controls'
import {
  BC_CUTBLOCK_SEARCH_DEFAULT_LIMIT,
  searchBcCutblocks,
  type BcCutblockSearchFilters,
  type BcCutblockSearchRecord,
  type BcCutblockSearchResult,
} from './bcAccessSearch'
import { findLidarAcquisitions, summarizeLidar, type LidarSummary } from './lidarAcquisitions'
import {
  LIDAR_TEST_BLOCKS,
  LIDAR_TEST_BLOCKS_SCREENED,
  LIDAR_TEST_CATEGORIES,
  type LidarTestBlock,
  type LidarTestCategory,
} from './lidarTestBlocks'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'

const SEARCH_FIELDS = [
  { key: 'openingId', label: 'Opening ID', placeholder: 'e.g. 60677' },
  { key: 'forestFileId', label: 'Forest licence', placeholder: 'Exact licence ID' },
  { key: 'cuttingPermitId', label: 'Cutting permit', placeholder: 'Exact permit ID' },
  { key: 'timberMark', label: 'Timber mark', placeholder: 'Exact timber mark' },
  { key: 'cutBlockId', label: 'Cutblock ID', placeholder: 'Exact block ID' },
] as const
type SearchField = (typeof SEARCH_FIELDS)[number]['key']
type SearchDraft = Record<SearchField, string>
const EMPTY_DRAFT: SearchDraft = {
  openingId: '',
  forestFileId: '',
  cuttingPermitId: '',
  timberMark: '',
  cutBlockId: '',
}
const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

interface BcAccessDiscoveryProps {
  onOpenStudy: (openingId: string) => Promise<void>
  /** Starts a design from a block with no opening ID, by its FTEN cutblock key. Absent hides the action. */
  onOpenPlannedBlock?: (cutblockSKey: string) => Promise<void>
  disabled?: boolean
  /** Stops an in-flight query when a containing dialog is hidden without unmounting. */
  active?: boolean
}

/** Search is read-only. Only an explicit Open study action asks the host to load a new workspace. */
export function BcAccessDiscoveryPanel({ active = true, ...props }: BcAccessDiscoveryProps) {
  return active ? <ActiveDiscoveryPanel {...props} /> : null
}

function ActiveDiscoveryPanel({
  onOpenStudy,
  onOpenPlannedBlock,
  disabled = false,
}: Omit<BcAccessDiscoveryProps, 'active'>) {
  const [draft, setDraft] = useState<SearchDraft>(EMPTY_DRAFT)
  const [limit, setLimit] = useState(BC_CUTBLOCK_SEARCH_DEFAULT_LIMIT)
  const [result, setResult] = useState<BcCutblockSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [blockKey, setBlockKey] = useState<string | null>(null)
  const [openError, setOpenError] = useState('')
  const pending = useRef<AbortController | null>(null)
  const pendingOpen = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      pending.current?.abort()
      pending.current = null
    }
  }, [])

  const clearQuery = () => {
    pending.current?.abort()
    pending.current = null
    setLoading(false)
    setResult(null)
    setError('')
    setStatus('')
    setOpenError('')
  }
  const edit = (key: SearchField, value: string) => {
    clearQuery()
    setDraft((previous) => ({ ...previous, [key]: value }))
  }
  const search = async () => {
    if (disabled || pendingOpen.current) return
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setLoading(true)
    setError('')
    setStatus('')
    setOpenError('')
    setResult(null)
    const filters: BcCutblockSearchFilters = { limit }
    for (const { key } of SEARCH_FIELDS) if (draft[key].trim()) filters[key] = draft[key].trim()
    try {
      const found = await searchBcCutblocks(filters, controller.signal)
      if (controller.signal.aborted || pending.current !== controller || !mounted.current) return
      setResult(found)
    } catch (cause) {
      if (!controller.signal.aborted && pending.current === controller && mounted.current) setError(errorMessage(cause))
    } finally {
      if (pending.current === controller && mounted.current) {
        pending.current = null
        setLoading(false)
      }
    }
  }
  const cancel = () => {
    clearQuery()
    setStatus('Search cancelled. No records were added to the project.')
  }
  const openStudy = async (id: string) => {
    if (disabled || pendingOpen.current) return
    pendingOpen.current = true
    setOpeningId(id)
    setOpenError('')
    try {
      await onOpenStudy(id)
    } catch (cause) {
      if (mounted.current) setOpenError(`Could not open study for opening ${id}. ${errorMessage(cause)}`)
    } finally {
      pendingOpen.current = false
      if (mounted.current) setOpeningId(null)
    }
  }
  const openPlannedBlock = async (cutblockSKey: string, label: string) => {
    if (disabled || pendingOpen.current || !onOpenPlannedBlock) return
    pendingOpen.current = true
    setBlockKey(cutblockSKey)
    setOpenError('')
    try {
      await onOpenPlannedBlock(cutblockSKey)
    } catch (cause) {
      if (mounted.current) setOpenError(`Could not open cutblock ${label}. ${errorMessage(cause)}`)
    } finally {
      pendingOpen.current = false
      if (mounted.current) setBlockKey(null)
    }
  }
  const blocked = disabled || openingId !== null || blockKey !== null
  const hasSelector = SEARCH_FIELDS.some(({ key }) => draft[key].trim())

  return (
    <section className="min-w-0 space-y-3" aria-label="Find BC cutblocks" data-testid="bc-cutblock-discovery">
      <div>
        <h3 className="text-sm font-semibold">Search live BC cutblocks</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Enter an opening ID or a source identifier. Filled fields must all match exactly. Open a result to load its
          block polygons, identity evidence and nearby road records as a new study.
        </p>
      </div>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void search()
        }}
      >
        <fieldset disabled={blocked} className="min-w-0 space-y-3">
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            {SEARCH_FIELDS.map(({ key, label, placeholder }) => (
              <Field key={key} label={label}>
                <input
                  className={roadFieldClass}
                  value={draft[key]}
                  placeholder={placeholder}
                  maxLength={key === 'openingId' ? 15 : 80}
                  inputMode={key === 'openingId' ? 'numeric' : 'text'}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => edit(key, event.target.value)}
                />
              </Field>
            ))}
            <Field label="Maximum results">
              <RoadSelect
                ariaLabel="Maximum cutblock results"
                className={roadFieldClass}
                value={String(limit)}
                onValueChange={(value) => {
                  clearQuery()
                  setLimit(Number(value))
                }}
              >
                {[10, 25, 50].map((count) => (
                  <option key={count} value={count}>
                    {count} records
                  </option>
                ))}
              </RoadSelect>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!hasSelector || loading} className="w-full sm:w-auto">
              <Search className="size-4" aria-hidden="true" />
              Search BC cutblocks
            </Button>
            {loading ? (
              <Button type="button" variant="outline" onClick={cancel}>
                <X className="size-4" aria-hidden="true" />
                Cancel search
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                disabled={!hasSelector && !result && !error}
                onClick={() => {
                  clearQuery()
                  setDraft(EMPTY_DRAFT)
                }}
              >
                Clear search
              </Button>
            )}
          </div>
        </fieldset>
      </form>
      {status && (
        <p className="text-xs text-muted-foreground" role="status">
          {status}
        </p>
      )}
      {openingId && <InlineAlert loading>Opening study for {openingId}…</InlineAlert>}
      {blockKey && <InlineAlert loading>Opening FTEN cutblock {blockKey}…</InlineAlert>}
      {openError && (
        <InlineAlert
          tone="error"
          title={openError.startsWith('Could not open cutblock') ? 'Cutblock not opened' : 'Study not opened'}
        >
          {openError}
        </InlineAlert>
      )}
      <ListState
        loading={loading}
        loadingLabel="Searching BC tenure cutblocks…"
        error={error}
        errorTitle="Cutblock search failed"
        empty={result !== null && result.records.length === 0}
        emptyLabel="No FTEN cutblock records matched these exact identifiers. Try fewer identifiers or check the source code. This does not establish that no historical block existed."
      >
        {result && (
          <div className="space-y-2" data-testid="bc-cutblock-search-results">
            <ListHeader
              count={result.returnedCount}
              noun={['cutblock record returned', 'cutblock records returned']}
              sticky={false}
            />
            {result.hasMore && (
              <InlineAlert tone="warning" title="More records match">
                Showing the first {result.returnedCount} records from this bounded search. Add an opening, permit,
                timber mark or block ID to narrow the result. This is not a complete inventory.
              </InlineAlert>
            )}
            <p className="text-xs text-muted-foreground">
              FTEN source records · checked {result.query.retrievedAt.slice(0, 10)} ·{' '}
              <a className="underline" href={result.query.requestUrl} target="_blank" rel="noreferrer">
                View this query
              </a>
            </p>
            {result.records.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground">
                  Dates are reported harvest/disturbance dates; the completion date may be estimated. Opening a study
                  does not establish which roads were built for or used by the block.
                </p>
                <ul className="space-y-2" aria-label="BC cutblock search results">
                  {result.records.map((record) => (
                    <li key={record.id}>
                      <CutblockSearchRecord
                        record={record}
                        disabled={blocked}
                        opening={openingId !== null && openingId === record.openingId}
                        onOpen={(id) => void openStudy(id)}
                        loadingBlock={blockKey !== null && blockKey === record.cutblockSKey}
                        onOpenBlock={
                          onOpenPlannedBlock
                            ? () => void openPlannedBlock(record.cutblockSKey, record.cutBlockId ?? record.cutblockSKey)
                            : undefined
                        }
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </ListState>
      <LidarTestBlocks
        disabled={blocked}
        pendingOpening={openingId}
        pendingBlock={blockKey}
        onOpenStudy={(id) => void openStudy(id)}
        onOpenBlock={
          onOpenPlannedBlock ? (block) => void openPlannedBlock(block.cutblockSKey!, block.block) : undefined
        }
      />
    </section>
  )
}

/** Real blocks with LiDAR flown at a useful time; each opens through the same study or design action as a result. */
function LidarTestBlocks({
  disabled,
  pendingOpening,
  pendingBlock,
  onOpenStudy,
  onOpenBlock,
}: {
  disabled: boolean
  pendingOpening: string | null
  pendingBlock: string | null
  onOpenStudy: (openingId: string) => void
  onOpenBlock?: (block: LidarTestBlock) => void
}) {
  const categories = Object.keys(LIDAR_TEST_CATEGORIES) as LidarTestCategory[]
  return (
    <details className={cn(insetBox({ padding: 'lg' }), 'min-w-0')} data-testid="lidar-test-blocks">
      <summary className="cursor-pointer text-sm font-semibold">LiDAR test blocks</summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Real blocks whose LidarBC DEM tiles were flown at a useful time, screened {LIDAR_TEST_BLOCKS_SCREENED}. Opening
        one reads its records live. Then load the LiDAR ground from Terrain → Load 1 m DEM → LidarBC; a listed tile is a
        footprint, so that load reports whether it holds elevations over the block.
      </p>
      {categories.map((category) => {
        const blocks = LIDAR_TEST_BLOCKS.filter((block) => block.category === category)
        return (
          <section key={category} className="mt-3 min-w-0" aria-label={LIDAR_TEST_CATEGORIES[category].title}>
            <h4 className="text-xs font-semibold">{LIDAR_TEST_CATEGORIES[category].title}</h4>
            <p className="text-xs text-muted-foreground">{LIDAR_TEST_CATEGORIES[category].use}</p>
            <ul className="mt-1 divide-y">
              {blocks.map((block) => {
                const label = `${block.licence}${block.cuttingPermit ? ` CP ${block.cuttingPermit}` : ''} · block ${block.block}`
                const canOpen = block.openingId ? true : !!onOpenBlock
                const loading = block.openingId
                  ? pendingOpening === block.openingId
                  : pendingBlock !== null && pendingBlock === block.cutblockSKey
                return (
                  <li key={block.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="break-words font-medium">
                        {label} <span className="font-normal text-muted-foreground">({block.district})</span>
                      </div>
                      <div className="break-words text-muted-foreground">
                        Harvest {block.harvest} · {block.lidar}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled || !canOpen}
                      aria-label={`${block.openingId ? 'Open study' : 'Design from block'} for LiDAR test block ${label}`}
                      onClick={() =>
                        block.openingId ? onOpenStudy(block.openingId) : onOpenBlock && onOpenBlock(block)
                      }
                    >
                      {loading ? 'Opening…' : block.openingId ? 'Open study' : 'Design from block'}
                    </Button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </details>
  )
}

/** The LidarBC flights over one result, read only when asked: one small index query per product. */
function LidarCheck({ record }: { record: BcCutblockSearchRecord }) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'done'; summary: LidarSummary; truncated: boolean }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  if (!record.bounds) return null
  const bounds = record.bounds
  const check = async () => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setState({ kind: 'loading' })
    try {
      const found = await findLidarAcquisitions(bounds, fetch, controller.signal)
      if (controller.signal.aborted) return
      setState({
        kind: 'done',
        summary: summarizeLidar(found.acquisitions, {
          start: record.disturbanceStartDate,
          end: record.disturbanceEndDate,
        }),
        truncated: found.truncated,
      })
    } catch (cause) {
      if (!controller.signal.aborted) setState({ kind: 'error', message: errorMessage(cause) })
    }
  }
  return (
    <div className="min-w-0 space-y-1 text-xs" data-lidar-check={record.id}>
      {state.kind === 'done' ? (
        <p className="break-words">
          <span className="font-medium">LidarBC: </span>
          {state.summary.text}
          {state.truncated ? ' The tile list was cut; open the block and use the LidarBC terrain source.' : ''}
        </p>
      ) : state.kind === 'error' ? (
        <p className="break-words text-destructive">LiDAR not read. {state.message}</p>
      ) : null}
      {state.kind !== 'done' && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={state.kind === 'loading'}
          aria-label={`Check LiDAR for cutblock ${record.cutBlockId ?? record.cutblockSKey}`}
          onClick={() => void check()}
        >
          <Radar className="size-3.5" aria-hidden="true" />
          {state.kind === 'loading' ? 'Checking LiDAR…' : 'Check LiDAR'}
        </Button>
      )}
    </div>
  )
}

function CutblockSearchRecord({
  record,
  disabled,
  opening,
  onOpen,
  loadingBlock,
  onOpenBlock,
}: {
  record: BcCutblockSearchRecord
  disabled: boolean
  opening: boolean
  onOpen: (openingId: string) => void
  loadingBlock: boolean
  onOpenBlock?: () => void
}) {
  const available = record.openingId !== null && record.bounds !== null
  // Only a block with no positive opening ID; one with an opening goes through its study.
  const designable = !!onOpenBlock && record.openingId === null && record.bounds !== null
  const facts = [
    ['Forest licence', record.forestFileId],
    ['Cutting permit', record.cuttingPermitId],
    ['Cutblock', record.cutBlockId],
    ['Timber mark', record.timberMark],
    ['Harvest start', record.disturbanceStartDate],
    ['Completion (may be estimated)', record.disturbanceEndDate],
    ['Client', record.clientNumber],
    ['Administrative status', record.lifecycleStatus],
  ] as const
  return (
    <article className={cn(insetBox({ padding: 'lg' }), 'min-w-0 space-y-3')} data-cutblock-record={record.id}>
      <div className="min-w-0">
        <h4 className="break-words text-sm font-semibold">
          {record.openingId
            ? `Opening ${record.openingId}`
            : record.reportedOpeningId
              ? `Reported opening ${record.reportedOpeningId}`
              : 'Opening ID not reported'}
        </h4>
        <p className="mt-0.5 break-words text-xs text-muted-foreground">FTEN cutblock record {record.cutblockSKey}</p>
      </div>
      <dl className="grid min-w-0 gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words font-medium">{value || 'Not reported'}</dd>
          </div>
        ))}
      </dl>
      <LidarCheck record={record} />
      {!available && (
        <p className="text-xs text-muted-foreground">
          {record.openingId
            ? 'No polygon geometry was returned for this record.'
            : record.reportedOpeningId
              ? 'A positive opening ID is required to open a study. This reported identifier cannot be cross-checked with RESULTS.'
              : 'An opening ID is needed to open a study.'}
          {designable &&
            ' You can still start a design from its FTEN footprint and the tenure roads near it; nothing is cross-checked with RESULTS.'}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full sm:w-auto"
        disabled={disabled || !available}
        aria-label={`${available ? 'Open study' : 'Study unavailable'} for opening ${record.openingId ?? record.reportedOpeningId ?? 'not reported'}, cutblock ${record.cutBlockId ?? record.cutblockSKey}`}
        onClick={() => record.openingId && onOpen(record.openingId)}
      >
        <SquareArrowOutUpRight className="size-3.5" aria-hidden="true" />
        {!available ? 'Study unavailable' : opening ? 'Opening study…' : 'Open study'}
      </Button>
      {designable && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full sm:ml-2 sm:w-auto"
          disabled={disabled}
          aria-label={`Design from cutblock ${record.cutBlockId ?? record.cutblockSKey}, record ${record.cutblockSKey}`}
          onClick={onOpenBlock}
        >
          <PencilRuler className="size-3.5" aria-hidden="true" />
          {loadingBlock ? 'Opening block…' : 'Design from this block'}
        </Button>
      )}
    </article>
  )
}
