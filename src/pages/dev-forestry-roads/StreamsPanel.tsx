import { useMemo, useState } from 'react'
import { ChevronLeft, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { Field, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import { RoadSection } from './SidebarParts'
import { ConstraintPolicyEditor } from './ConstraintPolicyEditor'
import type { ConstraintPolicy } from './constraints'
import { riparianArea } from './riparian'
import {
  assessmentFingerprint,
  effectiveClass,
  EMPTY_STREAM_ASSESSMENT,
  FISH_LABELS,
  RIPARIAN_CLASSES,
  RIPARIAN_RULES,
  RIPARIAN_WIDTHS,
  STREAM_STATUS_LABELS,
  streamStatus,
  suggestRiparianClass,
  WATERSHED_LABELS,
  WIDTH_BASIS_LABELS,
  type FishDetermination,
  type RiparianClass,
  type StreamAssessment,
  type WatershedDetermination,
  type WidthBasis,
} from './streamClass'
import type { ContextFeature } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'
import { ProvincialStreamsPanel, ProvincialStreamSourceView } from './ProvincialStreamsPanel'

type Filter = 'all' | 'unassessed' | 'no-fish' | 'no-width' | 'this-road' | 'needs-review'
const FILTERS: Record<Filter, string> = {
  all: 'All streams',
  unassessed: 'Unassessed',
  'no-fish': 'Missing fish determination',
  'no-width': 'Missing width',
  'this-road': 'Crossing the active road',
  'needs-review': 'Assessment needs review',
}
const today = () => new Date().toISOString().slice(0, 10)

/** Streams and their evidence. A stream row opens its assessment; its profile is one action inside it. */
export function StreamsPanel({
  workspace: w,
  onDraw,
  onImport,
  onProfile,
}: {
  workspace: RoadWorkspace
  onDraw: () => void
  onImport: () => void
  onProfile: (id: string) => void
}) {
  const { project, analysis, analyses } = w
  const streams = useMemo(() => project.context.filter((f) => f.kind === 'stream'), [project.context])
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const crossings = useMemo(() => {
    const counts = new Map<string, number>()
    for (const result of analyses.values())
      for (const crossing of result.crossings)
        if (crossing.kind === 'stream') counts.set(crossing.featureId, (counts.get(crossing.featureId) ?? 0) + 1)
    return counts
  }, [analyses])
  const onActiveRoad = useMemo(() => new Set(analysis.crossings.map((c) => c.featureId)), [analysis.crossings])
  const status = (f: ContextFeature) => streamStatus(f.streamAssessment, f.geometry.coordinates)
  const matches = (f: ContextFeature) => {
    const a = f.streamAssessment
    if (filter === 'unassessed') return status(f) === 'unassessed'
    if (filter === 'no-fish') return !a || a.fish === 'unresolved'
    if (filter === 'no-width') return !a || a.channelWidthM === null
    if (filter === 'this-road') return onActiveRoad.has(f.id)
    if (filter === 'needs-review') return status(f) === 'needs-review'
    return true
  }
  const open = streams.find((f) => f.id === openId)
  const unassessed = streams.filter((f) => status(f) === 'unassessed').length
  const save = (id: string, patch: Partial<StreamAssessment>) =>
    w.update((x) => ({
      ...x,
      context: x.context.map((f) =>
        f.id === id ? { ...f, streamAssessment: { ...EMPTY_STREAM_ASSESSMENT, ...f.streamAssessment, ...patch } } : f,
      ),
    }))
  const visible = streams.filter(matches)
  const renderStream = (f: ContextFeature) => {
    const riparian = effectiveClass(f.streamAssessment)
    const width = f.streamAssessment?.channelWidthM
    const count = crossings.get(f.id) ?? 0
    return (
      <button
        key={f.id}
        className="block w-full rounded border px-2 py-1 text-left text-xs hover:bg-muted"
        data-stream-row={f.id}
        onClick={() => setOpenId(f.id)}
      >
        <span className="block truncate font-medium">{f.name}</span>
        <span className="block text-2xs leading-4 text-muted-foreground">
          {riparian ?? 'No class'} · {STREAM_STATUS_LABELS[status(f)].toLowerCase()}
          {width != null ? ` · ${width} m` : ''}
          {count ? ` · ${count} road crossing${count === 1 ? '' : 's'}` : ''}
        </span>
      </button>
    )
  }
  return (
    <RoadSection
      title="Streams"
      summary={streams.length ? `${streams.length}${unassessed ? ` · ${unassessed} unassessed` : ''}` : 'None'}
      defaultOpen
      help={
        <>
          Record what is known about each stream and the page suggests its B.C. riparian class from{' '}
          {RIPARIAN_RULES.citation}. A suggestion is a planning aid, not a determination. Width, fish status and
          watershed status need their own evidence.
        </>
      }
    >
      {open ? (
        <StreamDetails
          key={open.id}
          stream={open}
          crossings={crossings.get(open.id) ?? 0}
          onBack={() => setOpenId(null)}
          onProfile={() => onProfile(open.id)}
          onChange={(patch) => save(open.id, patch)}
          onPolicyChange={(riparianPolicy) =>
            w.update((x) => ({
              ...x,
              context: x.context.map((f) => (f.id === open.id ? { ...f, riparianPolicy } : f)),
            }))
          }
          onRemove={() => {
            setOpenId(null)
            w.update((x) => ({ ...x, context: x.context.filter((c) => c.id !== open.id) }))
          }}
        />
      ) : (
        <div className="space-y-2" data-testid="road-streams">
          <ProvincialStreamsPanel workspace={w} />
          <div className="grid grid-cols-2 gap-1">
            <Button variant="outline" size="sm" className="text-xs" aria-label="Draw stream" onClick={onDraw}>
              Draw stream
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              aria-label="Import streams / constraints"
              onClick={onImport}
            >
              <Upload className="mr-1 size-3" />
              Import
            </Button>
          </div>
          {streams.length > 3 && (
            <RoadSelect
              ariaLabel="Filter streams"
              className={roadFieldClass}
              value={filter}
              onValueChange={(value) => setFilter(value as Filter)}
            >
              {Object.entries(FILTERS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </RoadSelect>
          )}
          {visible.length > 50 ? (
            <VirtualResultList items={visible} getKey={(f) => f.id} estimateSize={52} label="Streams">
              {renderStream}
            </VirtualResultList>
          ) : (
            visible.map(renderStream)
          )}
        </div>
      )}
    </RoadSection>
  )
}

function StreamDetails({
  stream,
  crossings,
  onBack,
  onProfile,
  onChange,
  onPolicyChange,
  onRemove,
}: {
  stream: ContextFeature
  crossings: number
  onBack: () => void
  onProfile: () => void
  onChange: (patch: Partial<StreamAssessment>) => void
  onPolicyChange: (policy: ConstraintPolicy) => void
  onRemove: () => void
}) {
  const assessment = stream.streamAssessment ?? EMPTY_STREAM_ASSESSMENT
  const suggestion = suggestRiparianClass(assessment)
  const status = streamStatus(stream.streamAssessment, stream.geometry.coordinates)
  // Empty follows the evidence, so the class on offer keeps up with what has been entered.
  const [choice, setChoice] = useState<RiparianClass | ''>('')
  const decision = choice || assessment.reviewedClass || suggestion.riparianClass || ''
  const shown = effectiveClass(stream.streamAssessment)
  const widths = shown ? RIPARIAN_WIDTHS[shown] : null
  const screening = riparianArea(stream)
  const importedDiffers =
    !!assessment.importedClass && !!shown && assessment.importedClass.replace('-', '') !== shown.replace('-', '')
  return (
    <div className="space-y-2" data-testid="road-stream-details">
      <ProvincialStreamSourceView stream={stream} />
      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost" className="size-6" aria-label="Back to streams" onClick={onBack}>
          <ChevronLeft className="size-4" />
        </Button>
        <p className="min-w-0 flex-1 truncate text-xs font-semibold">{stream.name}</p>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onProfile}>
          View terrain profile
        </Button>
      </div>
      <div className="rounded border bg-muted/20 p-2 text-2xs" data-testid="road-stream-suggestion">
        <p className="text-xs">
          <span className="font-semibold">{shown ?? 'No class yet'}</span>
          <span className="text-muted-foreground">
            {' '}
            · {STREAM_STATUS_LABELS[status]}
            {crossings ? ` · ${crossings} road crossing${crossings === 1 ? '' : 's'}` : ''}
          </span>
        </p>
        {widths && (
          <p>
            {widths.reserveM} m reserve + {widths.managementM} m management each side
          </p>
        )}
        {suggestion.alternatives && (
          <p>
            {suggestion.alternatives.ifFishOrWatershed} if fish-bearing or in a community watershed, otherwise{' '}
            {suggestion.alternatives.ifNeither}
          </p>
        )}
        {suggestion.basis.map((line) => (
          <p key={line} className="text-muted-foreground">
            {line}
          </p>
        ))}
        {suggestion.outstanding.map((line) => (
          <p key={line} className="text-amber-700 dark:text-amber-400">
            Outstanding: {line.toLowerCase()}
          </p>
        ))}
        {assessment.importedClass && (
          <p className={importedDiffers ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}>
            Source file says {assessment.importedClass}
            {importedDiffers ? `, the rules give ${shown}` : ''}
          </p>
        )}
      </div>
      {status === 'needs-review' && (
        <InlineAlert tone="warning">
          The evidence or the reach changed after this was reviewed. Confirm the class again.
        </InlineAlert>
      )}
      <div className="grid grid-cols-2 gap-2">
        <OptionalNumberField
          label="Channel width (m)"
          value={assessment.channelWidthM}
          min={0.01}
          max={10000}
          step={0.1}
          placeholder="not measured"
          hint="Width of the channel between its banks, not the water's width on the day. Record how it was measured."
          onChange={(channelWidthM) => onChange({ channelWidthM })}
        />
        <Field label="Measured from">
          <RoadSelect
            ariaLabel="Measured from"
            className={roadFieldClass}
            value={assessment.widthBasis ?? ''}
            onValueChange={(value) => onChange({ widthBasis: (value || undefined) as WidthBasis | undefined })}
          >
            <option value="">Not recorded</option>
            {Object.entries(WIDTH_BASIS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </RoadSelect>
        </Field>
        <Field
          label="Fish stream"
          hint="Under the regulation a fish stream is a watercourse frequented by listed species with a gradient under 20%, unless an exception applies. A steeper slope alone does not establish fish absence, and no record of fish is not evidence of absence."
        >
          <RoadSelect
            ariaLabel="Fish stream"
            className={roadFieldClass}
            value={assessment.fish}
            onValueChange={(value) => onChange({ fish: value as FishDetermination })}
          >
            {Object.entries(FISH_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </RoadSelect>
        </Field>
        <Field label="Community watershed">
          <RoadSelect
            ariaLabel="Community watershed"
            className={roadFieldClass}
            value={assessment.communityWatershed}
            onValueChange={(value) => onChange({ communityWatershed: value as WatershedDetermination })}
          >
            {Object.entries(WATERSHED_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </RoadSelect>
        </Field>
        <OptionalNumberField
          label="1 km average width (m)"
          value={assessment.oneKmAverageWidthM ?? null}
          min={0.01}
          max={100000}
          step={1}
          placeholder="not measured"
          hint="The greater of stream or active flood plain width, averaged over 1 km. 100 m or more makes the stream S1-A."
          onChange={(oneKmAverageWidthM) => onChange({ oneKmAverageWidthM })}
        />
      </div>
      <details className="rounded border" data-testid="stream-riparian-policy">
        <summary className="cursor-pointer px-2 py-1.5 text-xs font-medium">Riparian map & route treatment</summary>
        <div className="space-y-2 border-t p-2">
          <p className="text-2xs text-muted-foreground">
            {screening?.note} These areas are preliminary horizontal screening buffers, not surveyed legal boundaries.
          </p>
          <ConstraintPolicyEditor feature={stream} onChange={onPolicyChange} />
        </div>
      </details>
      <details className="rounded border">
        <summary className="cursor-pointer px-2 py-1.5 text-xs font-medium">Record a review</summary>
        <div className="space-y-2 border-t p-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Reviewed class">
              <RoadSelect
                ariaLabel="Reviewed class"
                className={roadFieldClass}
                value={decision}
                onValueChange={(value) => setChoice(value as RiparianClass | '')}
              >
                <option value="">Choose</option>
                {RIPARIAN_CLASSES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </RoadSelect>
            </Field>
            <Field label="Assessor">
              <input
                className={roadFieldClass}
                maxLength={200}
                value={assessment.assessor ?? ''}
                onChange={(event) => onChange({ assessor: event.target.value || undefined })}
              />
            </Field>
          </div>
          <Field label="Evidence link">
            <input
              className={roadFieldClass}
              type="url"
              maxLength={2000}
              placeholder="https://… field card or assessment"
              value={assessment.evidenceUrl ?? ''}
              onChange={(event) => onChange({ evidenceUrl: event.target.value || undefined })}
            />
          </Field>
          <Field label="Notes">
            <textarea
              className={roadFieldClass}
              rows={2}
              maxLength={2000}
              value={assessment.notes ?? ''}
              onChange={(event) => onChange({ notes: event.target.value || undefined })}
            />
          </Field>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              className="min-w-0 flex-1"
              disabled={!decision || !assessment.assessor?.trim()}
              onClick={() =>
                onChange({
                  reviewedClass: decision as RiparianClass,
                  reviewedFingerprint: assessmentFingerprint(assessment, stream.geometry.coordinates),
                  reviewedRules: `${RIPARIAN_RULES.id}@${RIPARIAN_RULES.consolidatedTo}`,
                  assessedOn: today(),
                })
              }
            >
              Record review
            </Button>
            {assessment.reviewedClass && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onChange({
                    reviewedClass: undefined,
                    reviewedFingerprint: undefined,
                    reviewedRules: undefined,
                    assessedOn: undefined,
                  })
                }
              >
                Clear
              </Button>
            )}
          </div>
          {assessment.reviewedClass && assessment.assessedOn && (
            <p className="text-2xs text-muted-foreground">
              Reviewed as {assessment.reviewedClass} by {assessment.assessor} on {assessment.assessedOn}
            </p>
          )}
        </div>
      </details>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="flex-1 text-xs"
          aria-label={`Remove context ${stream.name}`}
          onClick={onRemove}
        >
          <Trash2 className="mr-1 size-3" />
          Remove stream
        </Button>
        <InfoTip label="About these widths">
          Widths are the minimums in s. 47, on each side, in slope distance from the stream channel bank. Where an
          active flood plain is wider than the management zone, the zone extends to its outer edge. Rules read from the
          consolidation current to {RIPARIAN_RULES.consolidatedTo}.
        </InfoTip>
      </div>
    </div>
  )
}
