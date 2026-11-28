import { useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FileButton } from '@/components/ui/file-button'
import { FORM_INPUT_CLASS, FormField, NullableNumberField, StyledSelect } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { addCrossingCandidate, removeCrossingRead, saveCrossingRead } from '../edits'
import type { Block, Plan } from '../plan'
import {
  CROSSING_READ_SOURCE_LABELS,
  candidateState,
  crossingReadCurrent,
  crossingReadsOf,
  evidenceKindLabel,
  type CrossingCandidate,
  type CrossingRead,
  type CrossingReadSource,
} from './candidates'
import { CROSSING_ORIGIN_LABELS, CROSSING_ROLE_LABELS, crossingFootprint, crossingsOf } from './record'
import { designerRead } from './designerImport'
import { DEFAULT_CORRIDOR_M, MAX_CORRIDOR_M, readMappedCrossings, type Corridor } from './mappedRead'

const today = () => new Date().toISOString().slice(0, 10)
const metres = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

type Reading = { status: 'idle' } | { status: 'reading'; stage: string } | { status: 'failed'; error: string }

/** How far a candidate lies, in words. */
const whereText = (c: CrossingCandidate) =>
  c.distanceM === 0 ? 'Inside the block' : `${metres.format(c.distanceM)} m from the block`

/** One read's layers that gave nothing because they could not be read: never "none". */
function LayerNotes({ read }: { read: CrossingRead }) {
  const notRead = read.layers.filter((l) => l.status === 'failed')
  const short = read.layers.filter((l) => l.status === 'truncated')
  const skipped = read.layers.filter((l) => l.status === 'skipped' && l.message)
  return (
    <div className="space-y-1 text-2xs" data-testid={`crossing-read-layers-${read.source}`}>
      <p className="text-muted-foreground">
        {read.layers
          .filter((l) => l.status === 'read' || l.status === 'truncated')
          .map((l) => `${l.label}: ${l.count.toLocaleString()}`)
          .join(' · ')}
      </p>
      {notRead.length > 0 && (
        <InlineAlert tone="warning">
          Not read: {notRead.map((l) => `${l.label}${l.message ? ` (${l.message})` : ''}`).join('; ')}. What those
          layers hold is unknown, not none.
        </InlineAlert>
      )}
      {short.length > 0 && (
        <p className="text-warning">
          Stopped short: {short.map((l) => `${l.label}${l.message ? ` (${l.message})` : ''}`).join('; ')}
        </p>
      )}
      {skipped.map((l) => (
        <p key={l.id} className="text-muted-foreground">
          {l.label}: {l.message}
        </p>
      ))}
      {(read.notes ?? []).map((note) => (
        <InlineAlert key={note} tone={note.startsWith('Not read') ? 'warning' : 'info'}>
          {note}
        </InlineAlert>
      ))}
    </div>
  )
}

/** One candidate, with what it would join and the click that adds it. */
function CandidateRow({
  plan,
  block,
  schedule,
  read,
  candidate,
  current,
  edit,
  onAdded,
}: {
  plan: Plan
  block: Block
  schedule: string
  read: CrossingRead
  candidate: CrossingCandidate
  current: boolean
  edit: (change: (plan: Plan) => Plan) => void
  onAdded: (key: string) => void
}) {
  const state = candidateState(crossingsOf(plan, block.id, schedule), candidate)
  const add = (options: { site?: number; apart?: boolean } = {}) => {
    const placed = addCrossingCandidate(plan, block.id, schedule, read.source, candidate.id, options)
    if (!placed.key) return
    edit((p) => addCrossingCandidate(p, block.id, schedule, read.source, candidate.id, options).plan)
    onAdded(placed.key)
  }
  const kinds = [...new Set(candidate.evidence.map((e) => evidenceKindLabel(e.kind)))]
  return (
    <li
      className="space-y-1 border-t py-1.5 text-xs"
      data-candidate={candidate.id}
      data-state={state.state}
      data-testid="crossing-candidate"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{candidate.label}</p>
          <p className="text-2xs text-muted-foreground">
            {CROSSING_ORIGIN_LABELS[candidate.origin]} · {whereText(candidate)} · {CROSSING_ROLE_LABELS[candidate.role]}
            {kinds.length > 0 && <> · {kinds.join(', ')}</>}
          </p>
          {candidate.note && <p className="text-2xs text-muted-foreground">{candidate.note}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {state.state === 'added' ? (
            <Badge tone="neutral" size="sm">
              Added as {state.record.label}
            </Badge>
          ) : (
            <>
              <Button size="sm" variant="outline" disabled={!current} onClick={() => add()}>
                {state.state === 'matches' ? `Add to ${state.record.label}` : 'Add'}
              </Button>
              {state.state === 'matches' && (
                <Button size="sm" variant="ghost" disabled={!current} onClick={() => add({ apart: true })}>
                  Add as its own
                </Button>
              )}
              {candidate.sites &&
                candidate.sites.map((site, i) => (
                  <Button
                    key={i}
                    size="sm"
                    variant="ghost"
                    disabled={!current}
                    onClick={() => add({ site: i, apart: true })}
                  >
                    Add {site.label} alone
                  </Button>
                ))}
            </>
          )}
        </div>
      </div>
      {state.state === 'matches' && (
        <p className="text-2xs text-muted-foreground">
          Lies {state.distanceM === undefined ? '' : `${metres.format(state.distanceM)} m `}from {state.record.label},
          where the PSCIS site rule would take them as one place: adding it puts its ids and evidence on that crossing.
        </p>
      )}
    </li>
  )
}

function ReadCard({
  plan,
  block,
  schedule,
  read,
  edit,
  onAdded,
}: {
  plan: Plan
  block: Block
  schedule: string
  read: CrossingRead
  edit: (change: (plan: Plan) => Plan) => void
  onAdded: (key: string) => void
}) {
  const current = crossingReadCurrent(plan, read)
  const [showAll, setShowAll] = useState(false)
  const records = crossingsOf(plan, block.id, schedule)
  const open = read.candidates.filter((c) => candidateState(records, c).state !== 'added')
  const shown = showAll ? read.candidates : read.candidates.slice(0, 25)
  return (
    <div className="space-y-1 rounded-md border p-2" data-testid={`crossing-read-${read.source}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium">
            {CROSSING_READ_SOURCE_LABELS[read.source]}: {read.candidates.length} found, {open.length} not added
          </p>
          <p className="text-2xs text-muted-foreground">
            {read.basis}. Read {read.readOn}.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => edit((p) => removeCrossingRead(p, block.id, schedule, read.source))}
          aria-label={`Clear the ${CROSSING_READ_SOURCE_LABELS[read.source].toLowerCase()} read`}
        >
          Clear
        </Button>
      </div>
      {!current && (
        <InlineAlert tone="info">
          Read for the block’s earlier shape: read again before adding from it. Crossings already added keep what they
          were given.
        </InlineAlert>
      )}
      <LayerNotes read={read} />
      {read.candidates.length === 0 &&
      read.layers.some((l) => (l.id === 'sections' || l.id === 'segments') && l.status === 'failed') ? (
        <p className="text-2xs text-muted-foreground">
          No crossing could be looked for: the roads were not read. What the corridor holds is unknown, not none.
        </p>
      ) : read.candidates.length === 0 ? (
        <p className="text-2xs text-muted-foreground">
          No crossing found. A stream the mapped layers do not hold can still be crossed: the block’s small streams are
          often below the Freshwater Atlas’s resolution.
        </p>
      ) : (
        <ul data-testid={`crossing-candidates-${read.source}`}>
          {shown.map((c) => (
            <CandidateRow
              key={c.id}
              plan={plan}
              block={block}
              schedule={schedule}
              read={read}
              candidate={c}
              current={current}
              edit={edit}
              onAdded={onAdded}
            />
          ))}
        </ul>
      )}
      {read.candidates.length > shown.length && (
        <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
          Show all {read.candidates.length}
        </Button>
      )}
    </div>
  )
}

const CORRIDOR_KINDS = [
  { value: 'distance', label: 'Every road within the distance' },
  { value: 'file', label: 'One road file (road permit or forest service road)' },
  { value: 'timber-mark', label: 'Road segments under one timber mark' },
] as const

/**
 * Crossings read for the block, on the reviewer's click: the road designer's register from its
 * GeoJSON export, and the mapped layers in a stated corridor. Each read is kept with the plan for the
 * block's footprint; each place it found is added only by a click.
 */
export function CrossingReads({
  plan,
  edit,
  block,
  schedule,
  onAdded,
}: {
  plan: Plan
  edit: (change: (plan: Plan) => Plan) => void
  block: Block
  schedule: string
  onAdded: (key: string) => void
}) {
  const [reading, setReading] = useState<Reading>({ status: 'idle' })
  const [designerNote, setDesignerNote] = useState<string | null>(null)
  const [kind, setKind] = useState<Corridor['by']>('distance')
  const [distance, setDistance] = useState<number | null>(DEFAULT_CORRIDOR_M)
  const [id, setId] = useState('')
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  const reads = crossingReadsOf(plan, block.id, schedule)
  const readOf = (source: CrossingReadSource) => reads.find((r) => r.source === source)

  async function readDesigner(files: File[]) {
    const file = files[0]
    if (!file) return
    setDesignerNote(null)
    try {
      const { shape, signature } = crossingFootprint(plan, block, schedule)
      const {
        read,
        file: parsed,
        beyond,
      } = designerRead(
        await file.text(),
        file.name,
        { block: block.id, schedule, shape: shape.id, footprint: signature, geometry: shape.geometry },
        today(),
      )
      edit((p) => saveCrossingRead(p, read))
      setDesignerNote(
        `${parsed.crossings.length} register point${parsed.crossings.length === 1 ? '' : 's'} on ${parsed.roads.length} road${parsed.roads.length === 1 ? '' : 's'}${beyond ? `; ${beyond} more than 20 km from the block left out` : ''}.`,
      )
    } catch (e) {
      setDesignerNote(e instanceof Error ? e.message : 'The file could not be read.')
    }
  }

  async function readMapped() {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const metresValue = Math.min(MAX_CORRIDOR_M, Math.max(0, distance ?? DEFAULT_CORRIDOR_M))
    const corridor: Corridor =
      kind === 'file'
        ? { by: 'file', file: id, metres: metresValue }
        : kind === 'timber-mark'
          ? { by: 'timber-mark', mark: id, metres: metresValue }
          : { by: 'distance', metres: metresValue }
    setReading({ status: 'reading', stage: 'Starting the read…' })
    try {
      // JSTS loads with the overlays, on the first read only.
      const { crossingOverlay } = await import('../oldForest/oldForest')
      const { shape, signature } = crossingFootprint(plan, block, schedule)
      const read = await readMappedCrossings({
        footprint: shape.geometry,
        block: block.id,
        schedule,
        shape: shape.id,
        signature,
        corridor,
        fetch: (url, init) => fetch(url, init),
        signal: controller.signal,
        overlay: crossingOverlay,
        readOn: today(),
        onProgress: (stage) => setReading({ status: 'reading', stage }),
      })
      if (controller.signal.aborted) return
      // The block was redrawn during the read: `saveCrossingRead` refuses an answer for other ground.
      edit((p) => saveCrossingRead(p, read))
      setReading({ status: 'idle' })
    } catch (e) {
      if (controller.signal.aborted) return setReading({ status: 'idle' })
      setReading({ status: 'failed', error: e instanceof Error ? e.message : 'The read failed.' })
    } finally {
      if (abort.current === controller) abort.current = null
    }
  }

  const designer = readOf('designer')
  const mapped = readOf('mapped')
  const needsId = kind !== 'distance'
  return (
    <div className="space-y-2" data-testid="crossing-reads">
      <p className="text-xs font-medium">Find crossings</p>
      <p className="text-2xs text-muted-foreground">
        Places the road designer’s register or the mapped layers put a crossing. Each is a candidate: add the ones the
        block’s roads make. What a record holds is evidence beside the answers, never the answer.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <FileButton
          size="sm"
          variant="outline"
          label="Read the road designer’s GeoJSON export"
          accept=".geojson,.json,application/json,application/geo+json"
          onFiles={(files) => void readDesigner(files)}
        >
          <Upload className="size-3.5" />
          From the road designer
        </FileButton>
        {designerNote && (
          <span className="text-2xs text-muted-foreground" data-testid="crossing-designer-note">
            {designerNote}
          </span>
        )}
      </div>
      <form
        className="grid grid-cols-2 items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void readMapped()
        }}
      >
        <FormField label="Roads to read" group>
          <StyledSelect
            aria-label="Roads to read"
            value={kind}
            options={CORRIDOR_KINDS.map((k) => ({ value: k.value, label: k.label }))}
            onValueChange={(v) => setKind(v as Corridor['by'])}
          />
        </FormField>
        <NullableNumberField
          label="Within"
          unit="m"
          value={distance}
          min={0}
          max={MAX_CORRIDOR_M}
          updateOn="commit"
          onValueChange={setDistance}
        />
        {needsId && (
          <FormField label={kind === 'file' ? 'Road file' : 'Timber mark'}>
            <input
              className={FORM_INPUT_CLASS}
              value={id}
              maxLength={20}
              aria-label={kind === 'file' ? 'Road file' : 'Timber mark'}
              onChange={(e) => setId(e.target.value)}
            />
          </FormField>
        )}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            type="submit"
            disabled={reading.status === 'reading' || (needsId && !/^[A-Za-z0-9-]{1,20}$/.test(id.trim()))}
          >
            From the map
          </Button>
          {reading.status === 'reading' && (
            <>
              <span className="text-2xs text-muted-foreground" role="status">
                {reading.stage}
              </span>
              <Button size="sm" variant="ghost" type="button" onClick={() => abort.current?.abort()}>
                Stop
              </Button>
            </>
          )}
        </div>
      </form>
      {reading.status === 'failed' && <InlineAlert tone="error">{reading.error}</InlineAlert>}
      {designer && (
        <ReadCard plan={plan} block={block} schedule={schedule} read={designer} edit={edit} onAdded={onAdded} />
      )}
      {mapped && <ReadCard plan={plan} block={block} schedule={schedule} read={mapped} edit={edit} onAdded={onAdded} />}
    </div>
  )
}
