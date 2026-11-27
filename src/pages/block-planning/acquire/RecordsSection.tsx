import { lazy, Suspense, useState } from 'react'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmRemoveButton } from '@/components/ui/confirm-remove'
import { CopyButton } from '@/components/ui/copy-button'
import { DisclosureCard } from '@/components/ui/disclosure'
import { FORM_INPUT_CLASS, FormField, StyledSelect } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import type { Pack } from '../../../../packages/legal-rules/src/contract'
import {
  addReceivedRecord,
  applyReceivedAsClaimEvidence,
  applyReceivedAsCrossingEvidence,
  applyReceivedAsFact,
  recordRequestEvent,
  removeReceivedRecord,
  setRecordIds,
} from '../edits'
import type { BlockPlanningExport } from '../exports'
import type { Block, Plan } from '../plan'
import { CHANNEL_CATALOGUE, channelOf, citedSource, gapKindOf, type Channel } from './channels'
import { blockGaps, gapSubject, type Gap } from './gaps'
import {
  MAX_RECEIVED_QUOTE,
  RECORD_ID_FIELDS,
  RECORD_ID_LABELS,
  recordIdsOf,
  REQUEST_EVENT_LABELS,
  REQUEST_EVENTS,
  type ReceivedRecord,
  type ReceivedValue,
  type RequestEventStatus,
} from './record'
import { claimTargets, type UseResult } from './received'
import { draftLetters, type DraftLetter } from './requests'
import { requestStanding, type RequestStanding } from './status'

const ProvisionLink = lazy(() =>
  import('../../legal-workbench/ProvisionPreview').then((m) => ({ default: m.ProvisionLink })),
)

/** Today in the reviewer's own calendar, as YYYY-MM-DD. */
export function localToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const STATE_TONE: Record<RequestStanding['state'], BadgeTone> = {
  'not-requested': 'neutral',
  requested: 'info',
  extended: 'info',
  received: 'success',
  partial: 'warning',
  refused: 'danger',
  'not-held': 'warning',
  withdrawn: 'neutral',
}

function daysText(channel: Channel) {
  if (!channel.days) return channel.daysNote
  const d = channel.days
  return `${d.count} ${d.business ? 'business ' : ''}days${d.extension ? `, extendable by ${d.extension}` : ''}. ${channel.daysNote}`
}

function StandingBadge({ standing }: { standing: RequestStanding }) {
  if (standing.noLongerNeeded)
    return (
      <Badge tone="neutral" size="sm">
        No longer needed
      </Badge>
    )
  return (
    <Badge tone={standing.overdue ? 'danger' : STATE_TONE[standing.state]} size="sm">
      {standing.label}
      {standing.due && standing.state !== 'received' ? ` · due ${standing.due}` : ''}
      {standing.overdue ? ' · overdue' : ''}
    </Badge>
  )
}

/** The block's identifiers and dates, each committed when its field loses focus. */
function Identifiers({ plan, edit, block }: { plan: Plan; edit: Edit; block: Block }) {
  const ids = recordIdsOf(plan, block.id)
  const text = (field: (typeof RECORD_ID_FIELDS)[number]) => (
    <FormField key={field} label={RECORD_ID_LABELS[field]}>
      <input
        key={`${block.id}:${field}:${ids[field] ?? ''}`}
        className={FORM_INPUT_CLASS}
        defaultValue={ids[field] ?? ''}
        maxLength={60}
        onBlur={(e) => {
          if (e.currentTarget.value.trim() !== (ids[field] ?? ''))
            edit((p) => setRecordIds(p, block.id, { [field]: e.currentTarget.value }))
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </FormField>
  )
  const date = (field: 'permitIssued' | 'recordsFrom' | 'recordsTo', label: string) => (
    <FormField label={label}>
      <input
        type="date"
        aria-label={label}
        className={FORM_INPUT_CLASS}
        value={ids[field] ?? ''}
        onChange={(e) => edit((p) => setRecordIds(p, block.id, { [field]: e.target.value }))}
      />
    </FormField>
  )
  return (
    <DisclosureCard
      title="Identifiers a request quotes"
      summary={`${RECORD_ID_FIELDS.filter((f) => ids[f]).length} entered`}
      help="An identifier holds a number (a licence, a permit, a file, an opening): a name typed here is not kept. Requests quote these and the crossings' road files, places and PSCIS ids."
    >
      <div className="grid grid-cols-2 gap-2" data-testid="records-identifiers">
        {RECORD_ID_FIELDS.map(text)}
        {date('permitIssued', 'Cutting permit issued')}
        <div />
        {date('recordsFrom', 'Records from (FOI range)')}
        {date('recordsTo', 'Records to (FOI range)')}
      </div>
    </DisclosureCard>
  )
}

type Edit = (change: (plan: Plan) => Plan) => void

/** A letter, its freedom of information version, and copying or saving it. */
function LetterView({ letter, onSave }: { letter: DraftLetter; onSave?: () => void }) {
  const [foi, setFoi] = useState(false)
  const text = foi && letter.foiText ? letter.foiText : letter.text
  return (
    <div className="space-y-1 rounded-md border bg-muted/40 p-2" data-testid="records-letter">
      <div className="flex flex-wrap items-center gap-2">
        {letter.foiText && (
          <Button size="sm" variant="outline" aria-pressed={foi} onClick={() => setFoi(!foi)}>
            {foi ? 'Show the letter' : 'Freedom of information version'}
          </Button>
        )}
        <CopyButton
          text={text}
          title="Copy the request"
          className="shrink-0 rounded border border-input bg-background px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Copy
        </CopyButton>
        {onSave && (
          <Button size="sm" variant="outline" onClick={onSave}>
            Save as text…
          </Button>
        )}
      </div>
      <pre className="whitespace-pre-wrap break-words font-sans text-2xs">{text}</pre>
    </div>
  )
}

/** Marks an event on the requests a letter covers. */
function EventForm({
  letter,
  requested,
  onRecord,
}: {
  letter: DraftLetter
  requested: boolean
  onRecord: (status: RequestEventStatus, date: string, reference: string) => void
}) {
  const [status, setStatus] = useState<RequestEventStatus>(requested ? 'received' : 'requested')
  const [date, setDate] = useState(localToday())
  const [reference, setReference] = useState('')
  const choices = requested ? REQUEST_EVENTS.filter((e) => e !== 'requested') : (['requested'] as const)
  return (
    <div className="grid grid-cols-[1fr_8.5rem_1fr_auto] items-end gap-1.5" data-testid="records-event">
      <FormField label="What happened" group>
        <StyledSelect
          aria-label={`What happened to the request through ${letter.channel.label}`}
          value={status}
          options={choices.map((e) => ({ value: e, label: REQUEST_EVENT_LABELS[e] }))}
          onValueChange={(v) => setStatus(v as RequestEventStatus)}
        />
      </FormField>
      <FormField label="On">
        <input
          type="date"
          aria-label="Event date"
          className={FORM_INPUT_CLASS}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </FormField>
      <FormField label="Reference">
        <input
          className={FORM_INPUT_CLASS}
          aria-label="Event reference"
          placeholder="Request or file number"
          maxLength={200}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </FormField>
      <Button size="sm" disabled={!date} onClick={() => onRecord(status, date, reference)}>
        {status === 'requested' ? 'Mark requested' : `Mark ${REQUEST_EVENT_LABELS[status].toLowerCase()}`}
      </Button>
    </div>
  )
}

interface ValueDraft {
  label: string
  value: string
  target: string
  page: string
  quote: string
}
const blankValue = (): ValueDraft => ({ label: '', value: '', target: '', page: '', quote: '' })

/** "Enter what came back": a record received, as the reviewer's transcription. */
function ReceivedForm({
  plan,
  edit,
  block,
  gaps,
  from,
  onDone,
}: {
  plan: Plan
  edit: Edit
  block: Block
  gaps: Gap[]
  from?: string
  onDone: () => void
}) {
  const [title, setTitle] = useState('')
  const [channel, setChannel] = useState(from ?? CHANNEL_CATALOGUE.channels[0].id)
  const [documentDate, setDocumentDate] = useState('')
  const [receivedOn, setReceivedOn] = useState(localToday())
  const [reference, setReference] = useState('')
  const [severed, setSevered] = useState(false)
  const [severedNote, setSeveredNote] = useState('')
  const [values, setValues] = useState<ValueDraft[]>([blankValue()])
  // What a value can bear on: each open fact of the block and its crossings, by crossing.
  const targets = gaps.flatMap((g) =>
    g.facts.map((f) => ({
      value: `${g.crossing ?? ''}|${f.pack}|${f.fact}`,
      label: `${gapSubject(plan, g)}: ${f.label}`,
    })),
  )
  const crossings = (plan.crossings ?? []).filter((c) => c.block === block.id)
  const options = [
    { value: '', label: 'No question (a note)' },
    ...targets,
    ...crossings.map((c) => ({ value: `${c.key}||`, label: `${c.label}: evidence only` })),
  ]
  const patch = (i: number, change: Partial<ValueDraft>) =>
    setValues(values.map((v, j) => (j === i ? { ...v, ...change } : v)))
  const save = () => {
    const kept: ReceivedValue[] = values
      .filter((v) => v.label.trim() && v.value.trim())
      .map((v, i) => {
        const [crossing, pack, fact] = v.target.split('|')
        return {
          id: `value-${i + 1}`,
          label: v.label.trim(),
          value: v.value.trim(),
          ...(pack && fact ? { fact: { pack, fact } } : {}),
          ...(crossing ? { crossing } : {}),
          ...(v.page.trim() ? { page: v.page.trim() } : {}),
          ...(v.quote.trim() ? { quote: v.quote.trim().slice(0, MAX_RECEIVED_QUOTE) } : {}),
        }
      })
    const record: Omit<ReceivedRecord, 'id'> = {
      block: block.id,
      title,
      from: channel,
      receivedOn,
      values: kept,
      ...(documentDate ? { documentDate } : {}),
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      ...(severed ? { severed: true, ...(severedNote.trim() ? { severedNote: severedNote.trim() } : {}) } : {}),
      ...(from ? { gaps: gaps.filter((g) => g.channels.includes(from)).map((g) => g.id) } : {}),
    }
    edit((p) => addReceivedRecord(p, record).plan)
    onDone()
  }
  return (
    <div className="space-y-2 rounded-md border p-2" data-testid="records-received-form">
      <p className="text-xs font-medium">Enter what came back</p>
      <p className="text-2xs text-muted-foreground">
        Your transcription of the record: the document itself is not kept, and no person&apos;s name belongs here. A
        value answers nothing until you use it.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <FormField label="Title">
          <input
            className={FORM_INPUT_CLASS}
            aria-label="Record title"
            maxLength={300}
            value={title}
            placeholder="Road permit file, section 03"
            onChange={(e) => setTitle(e.target.value)}
          />
        </FormField>
        <FormField label="From" group>
          <StyledSelect
            aria-label="Received through"
            value={channel}
            options={CHANNEL_CATALOGUE.channels.map((c) => ({ value: c.id, label: c.label }))}
            onValueChange={setChannel}
          />
        </FormField>
        <FormField label="Document dated">
          <input
            type="date"
            aria-label="Document dated"
            className={FORM_INPUT_CLASS}
            value={documentDate}
            onChange={(e) => setDocumentDate(e.target.value)}
          />
        </FormField>
        <FormField label="Received on">
          <input
            type="date"
            aria-label="Received on"
            className={FORM_INPUT_CLASS}
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
          />
        </FormField>
        <FormField label="Reference">
          <input
            className={FORM_INPUT_CLASS}
            aria-label="Record reference"
            maxLength={200}
            value={reference}
            placeholder="FOI file or letter number"
            onChange={(e) => setReference(e.target.value)}
          />
        </FormField>
        <FormField label="Severed" group>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={severed} onChange={(e) => setSevered(e.target.checked)} />
            Parts were withheld
          </label>
          {severed && (
            <input
              className={FORM_INPUT_CLASS + ' mt-1'}
              aria-label="Severed under"
              maxLength={500}
              value={severedNote}
              placeholder="FOIPPA s. 21, s. 22"
              onChange={(e) => setSeveredNote(e.target.value)}
            />
          )}
        </FormField>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium">Values read from it</p>
        {values.map((v, i) => (
          <div key={i} className="grid grid-cols-2 gap-1.5 rounded border p-1.5" data-testid="records-value-draft">
            <FormField label="States">
              <input
                className={FORM_INPUT_CLASS}
                aria-label={`Value ${i + 1} states`}
                maxLength={200}
                value={v.label}
                placeholder="Crossing installed"
                onChange={(e) => patch(i, { label: e.target.value })}
              />
            </FormField>
            <FormField label="Value">
              <input
                className={FORM_INPUT_CLASS}
                aria-label={`Value ${i + 1}`}
                maxLength={2000}
                value={v.value}
                placeholder="Yes, a number, or the words"
                onChange={(e) => patch(i, { value: e.target.value })}
              />
            </FormField>
            <FormField label="Bears on" group className="col-span-2">
              <StyledSelect
                aria-label={`Value ${i + 1} bears on`}
                value={v.target}
                options={options}
                onValueChange={(target) => patch(i, { target })}
              />
            </FormField>
            <FormField label="Page">
              <input
                className={FORM_INPUT_CLASS}
                aria-label={`Value ${i + 1} page`}
                maxLength={40}
                value={v.page}
                onChange={(e) => patch(i, { page: e.target.value })}
              />
            </FormField>
            <FormField label="Short quote">
              <input
                className={FORM_INPUT_CLASS}
                aria-label={`Value ${i + 1} quote`}
                maxLength={MAX_RECEIVED_QUOTE}
                value={v.quote}
                placeholder="Word for word, at most 124 characters"
                onChange={(e) => patch(i, { quote: e.target.value })}
              />
            </FormField>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setValues([...values, blankValue()])}>
          Add a value
        </Button>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={!title.trim() || !receivedOn} onClick={save}>
          Keep this record
        </Button>
        <Button size="sm" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** One received record: what it states, and using each value. */
function ReceivedCard({
  plan,
  edit,
  record,
  library,
  keepPacks,
}: {
  plan: Plan
  edit: Edit
  record: ReceivedRecord
  library: Pack[]
  keepPacks: (plan: Plan) => Plan
}) {
  const [problem, setProblem] = useState('')
  const today = localToday()
  const claims = claimTargets(plan, library, record.block)
  const run = (attempt: (p: Plan) => UseResult) => {
    const first = attempt(plan)
    if ('error' in first) return setProblem(first.error)
    setProblem('')
    edit((p) => {
      const again = attempt(p)
      return 'plan' in again ? keepPacks(again.plan) : p
    })
  }
  return (
    <div className="space-y-1.5 rounded-md border p-2 text-xs" data-testid={`records-received-${record.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{record.title}</p>
          <p className="text-2xs text-muted-foreground">
            From {channelOf(record.from)?.label ?? record.from}
            {record.documentDate ? ` · dated ${record.documentDate}` : ''} · received {record.receivedOn}
            {record.reference ? ` · ${record.reference}` : ''}
            {record.severed ? ` · severed${record.severedNote ? ` (${record.severedNote})` : ''}` : ''}
          </p>
        </div>
        <ConfirmRemoveButton
          label={`Remove ${record.title}`}
          question="Remove this record?"
          detail="Answers and evidence already taken from it stay where they were used."
          onConfirm={() => edit((p) => removeReceivedRecord(p, record.id))}
        />
      </div>
      {record.values.length ? (
        <ul className="space-y-1.5">
          {record.values.map((v) => {
            const crossing = plan.crossings?.find((c) => c.key === v.crossing)
            return (
              <li key={v.id} className="space-y-1 rounded border p-1.5" data-value={v.id}>
                <p>
                  <span className="font-medium">{v.label}:</span> {v.value}
                  {v.page ? <span className="text-muted-foreground"> · p. {v.page}</span> : null}
                  <span className="text-muted-foreground"> · your transcription</span>
                </p>
                {v.quote && <p className="text-2xs italic text-muted-foreground">“{v.quote}”</p>}
                {v.uses?.length ? (
                  <p className="text-2xs text-muted-foreground">
                    Used: {v.uses.map((u) => `${u.target} (${u.on})`).join('; ')}
                  </p>
                ) : (
                  <p className="text-2xs text-muted-foreground">Not used: it answers nothing yet.</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {v.fact && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => run((p) => applyReceivedAsFact(p, library, record.id, v.id, today))}
                    >
                      Use as the answer
                    </Button>
                  )}
                  {crossing && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => run((p) => applyReceivedAsCrossingEvidence(p, record.id, v.id, today))}
                    >
                      Add to {crossing.label}’s evidence
                    </Button>
                  )}
                  {claims.length > 0 && (
                    <StyledSelect
                      aria-label={`Use ${v.label} as evidence for an exception`}
                      value=""
                      options={[
                        { value: '', label: 'Evidence for an exception claimed…' },
                        ...claims.map((c, i) => ({ value: String(i), label: `${c.caseLabel}: ${c.ruleTitle}` })),
                      ]}
                      onValueChange={(i) => {
                        const c = claims[Number(i)]
                        if (c) run((p) => applyReceivedAsClaimEvidence(p, record.id, v.id, c, today))
                      }}
                    />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-2xs text-muted-foreground">No values transcribed.</p>
      )}
      {problem && <InlineAlert tone="warning">{problem}</InlineAlert>}
    </div>
  )
}

/** One channel's letter for the block: the gaps it covers, their status, and what was done. */
function ChannelCard({
  plan,
  edit,
  block,
  gaps,
  letter,
  today,
  onSave,
}: {
  plan: Plan
  edit: Edit
  block: Block
  gaps: Gap[]
  letter: DraftLetter
  today: string
  onSave?: () => void
}) {
  const [open, setOpen] = useState<'letter' | 'event' | 'received' | null>(null)
  const channel = letter.channel
  const statusOf = (gap: Gap) => plan.acquisition?.requests?.find((r) => r.gap === gap.id && r.channel === channel.id)
  const requested = letter.gaps.some((g) => statusOf(g))
  return (
    <div className="space-y-1.5 rounded-md border p-2" data-testid={`records-channel-${channel.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium">{channel.label}</p>
          <p className="text-2xs text-muted-foreground">
            {channel.holder} ·{' '}
            <a className="underline" href={channel.route.url} target="_blank" rel="noreferrer">
              {channel.route.label}
            </a>
          </p>
          <p className="text-2xs text-muted-foreground">
            Fee: {channel.fee}. Time: {daysText(channel)}
            {channel.foippa.length ? ` Likely withheld under FOIPPA ${channel.foippa.join(', ')}.` : ''}
          </p>
          {channel.cites.map((c) => {
            const source = citedSource(c.source)
            return (
              <p key={c.provision} className="text-2xs text-muted-foreground">
                {source ? (
                  <Suspense fallback={<span>{c.provision}</span>}>
                    <ProvisionLink
                      citation={{
                        sourceUrl: source.url,
                        sourceTitle: source.title,
                        provision: c.provision,
                        quotes: [c.quote],
                      }}
                    />
                  </Suspense>
                ) : (
                  c.provision
                )}
                : “{c.quote}”
              </p>
            )
          })}
        </div>
      </div>
      <ul className="space-y-1">
        {letter.gaps.map((gap) => {
          const standing = requestStanding(statusOf(gap), channel, today, true)
          return (
            <li key={gap.id} className="flex flex-wrap items-center gap-1.5 text-xs" data-gap={gap.id}>
              <span>
                {gapKindOf(gap.kind).label} · {gapSubject(plan, gap)}
              </span>
              <Badge tone={gap.asked ? 'warning' : 'neutral'} size="sm">
                {gap.asked ? 'Asked now' : 'May be needed'}
              </Badge>
              <StandingBadge standing={standing} />
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant={open === 'letter' ? 'default' : 'outline'}
          onClick={() => setOpen(open === 'letter' ? null : 'letter')}
        >
          {channel.search ? 'What to search' : channel.field ? 'Field check list' : 'Draft request'}
        </Button>
        <Button
          size="sm"
          variant={open === 'event' ? 'default' : 'outline'}
          onClick={() => setOpen(open === 'event' ? null : 'event')}
        >
          {requested ? 'Record what happened' : 'Mark requested'}
        </Button>
        <Button
          size="sm"
          variant={open === 'received' ? 'default' : 'outline'}
          onClick={() => setOpen(open === 'received' ? null : 'received')}
        >
          Enter what came back
        </Button>
      </div>
      {open === 'letter' && <LetterView letter={letter} onSave={onSave} />}
      {open === 'event' && (
        <EventForm
          letter={letter}
          requested={requested}
          onRecord={(status, date, reference) => {
            const targets = status === 'requested' ? letter.gaps : letter.gaps.filter((g) => statusOf(g))
            edit((p) => recordRequestEvent(p, channel.id, targets, { status, date, reference }))
            setOpen(null)
          }}
        />
      )}
      {open === 'received' && (
        <ReceivedForm
          plan={plan}
          edit={edit}
          block={block}
          gaps={gaps}
          from={channel.id}
          onDone={() => setOpen(null)}
        />
      )}
    </div>
  )
}

/**
 * Review → *Records to get*: what the block's and its crossings' reviews cannot answer from public
 * data, grouped by the channel that can answer it, each with its drafted request, its status, and
 * what came back as the reviewer's transcription. Nothing is sent, and nothing here decides a
 * question: a received value answers only when the reviewer uses it.
 */
export function RecordsSection({
  plan,
  edit,
  block,
  schedule,
  library,
  keepPacks,
  openExport,
}: {
  plan: Plan
  edit: Edit
  block: Block
  schedule: string
  library: Pack[]
  keepPacks: (plan: Plan) => Plan
  openExport?: (output: BlockPlanningExport) => void
}) {
  const [entering, setEntering] = useState(false)
  const today = localToday()
  const gaps = blockGaps(plan, library, block.id, schedule)
  const letters = draftLetters(plan, gaps, today)
  const derived = new Set(gaps.map((g) => g.id))
  const stale = (plan.acquisition?.requests ?? []).filter(
    (r) => r.block === block.id && r.schedule === schedule && !derived.has(r.gap),
  )
  const received = (plan.acquisition?.received ?? []).filter((r) => r.block === block.id)
  const onSave = openExport ? () => openExport('requests') : undefined
  return (
    <div className="space-y-3" data-testid="block-planning-records">
      <p className="text-2xs text-muted-foreground">
        What the block&apos;s and its crossings&apos; reviews cannot answer from public data, grouped by where to ask.
        Each request is a draft to copy: nothing is sent from here, and no person is named. A record that comes back is
        your transcription, and answers a question only when you use a value from it.
      </p>
      <Identifiers plan={plan} edit={edit} block={block} />
      {letters.length ? (
        <div className="space-y-2">
          {letters.map((letter) => (
            <ChannelCard
              key={letter.key}
              plan={plan}
              edit={edit}
              block={block}
              gaps={gaps}
              letter={letter}
              today={today}
              onSave={onSave}
            />
          ))}
        </div>
      ) : (
        <InlineAlert tone="info">No open question here waits on a record public data does not hold.</InlineAlert>
      )}
      {stale.length > 0 && (
        <div className="space-y-1" data-testid="records-no-longer-needed">
          <p className="text-xs font-medium">No longer needed</p>
          <p className="text-2xs text-muted-foreground">
            Requests whose question has since been answered. They are kept with what happened to them.
          </p>
          <ul className="space-y-1">
            {stale.map((r) => {
              const kind = gapKindOf(r.gap.split(':')[0] as Gap['kind'])
              const standing = requestStanding(r, channelOf(r.channel), today, false)
              return (
                <li key={`${r.gap}|${r.channel}`} className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span>
                    {kind?.label ?? r.gap} · {gapSubject(plan, { block: r.block, crossing: r.gap.split(':')[3] })} ·{' '}
                    {channelOf(r.channel)?.label ?? r.channel}
                  </span>
                  <StandingBadge standing={standing} />
                  <span className="text-2xs text-muted-foreground">
                    {r.events.map((e) => `${REQUEST_EVENT_LABELS[e.status]} ${e.date}`).join(' · ')}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <div className="space-y-2" data-testid="records-received">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium">Received</p>
          {!entering && (
            <Button size="sm" variant="outline" onClick={() => setEntering(true)}>
              Enter what came back
            </Button>
          )}
        </div>
        {entering && (
          <ReceivedForm plan={plan} edit={edit} block={block} gaps={gaps} onDone={() => setEntering(false)} />
        )}
        {received.length ? (
          received.map((r) => (
            <ReceivedCard key={r.id} plan={plan} edit={edit} record={r} library={library} keepPacks={keepPacks} />
          ))
        ) : (
          <p className="text-2xs text-muted-foreground">Nothing received yet.</p>
        )}
      </div>
    </div>
  )
}
