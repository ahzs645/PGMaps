/**
 * Review → Field review: issue the active road to a field crew, import what they bring back, and
 * decide each observation against the road it was issued on and the road as it stands (guide
 * `docs/forestry-road-design/field-review.md`). Every change is one named undo step.
 */
import { useMemo, useRef, useState } from 'react'
import { Download, FileDown, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { downloadText } from '@/lib/download'
import { Field, NumberField, roadFieldClass, RoadSelect } from './Controls'
import { RoadSection } from './SidebarParts'
import { useStationReader } from './roadStation'
import { labelStation, withStationing } from './roadStationing'
import { isoDate } from './projectIssue'
import type { CrossingRegister } from './crossingRegister'
import {
  crossingCheckDrafts,
  FIELD_CHECK_KINDS,
  FIELD_MATCH_RADIUS_M,
  fieldPackKml,
  fieldReviewSummary,
  issueRoad,
  nextCheckLabel,
  nextIssueLabel,
  readObservation,
  readObservations,
  roadCentreline,
  withObservation,
  type CheckDraft,
  type FieldCheckKind,
  type FieldIssue,
  type FieldObservation,
  type FieldReviewState,
} from './fieldReview'
import { readSpatialFile } from './surveyInterchange'
import type { Alignment } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

const EMPTY: FieldReviewState = { issues: [], observations: [] }
const metres = (v: number) => `${Math.abs(v).toFixed(1)} m ${v < 0 ? 'left' : 'right'}`
const fileStem = (text: string) => text.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'road'

export function FieldReviewSection({
  workspace,
  register,
  onFieldPackPdf,
  onShowCulverts,
}: {
  workspace: RoadWorkspace
  register: CrossingRegister
  /** Builds and downloads the issue's geospatial PDF from the plan map. */
  onFieldPackPdf?: (issue: FieldIssue) => void
  onShowCulverts?: (chainage?: number) => void
}) {
  const { project, alignment, update, setStation } = workspace
  const readStation = useStationReader(workspace)
  const state = project.fieldReview ?? EMPTY
  const summary = fieldReviewSummary(project.fieldReview)
  const [revision, setRevision] = useState(project.issue?.revision ?? '')
  const [drafts, setDrafts] = useState<CheckDraft[] | null>(null)
  const [kind, setKind] = useState<FieldCheckKind>('landing')
  const [lengthM, setLengthM] = useState(0)
  const [message, setMessage] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const station = (road: Alignment, chainage: number) => withStationing(road.stationing, () => labelStation(chainage))
  const checks = drafts ?? crossingCheckDrafts(register.rows)
  // The labels the issue will give, in the order it gives them (`issueRoad`).
  const labels = checks
    .reduce<{ label: string }[]>((out, c) => [...out, { label: nextCheckLabel(out, c.kind) }], [])
    .map((l) => l.label)
  const write = (change: (s: FieldReviewState) => FieldReviewState, label: string) =>
    update(
      (x) => {
        const next = change(x.fieldReview ?? EMPTY)
        const out = { ...x }
        if (next.issues.length || next.observations.length) out.fieldReview = next
        else delete out.fieldReview
        return out
      },
      label,
      { ownStep: true },
    )

  const issue = () => {
    try {
      const made = issueRoad({
        alignment,
        label: nextIssueLabel(state),
        revision,
        issuedOn: isoDate(new Date()),
        terrain: {
          name: project.terrain.name,
          verticalReference: project.terrain.verticalReference,
          ...(project.terrain.epsg ? { epsg: project.terrain.epsg } : {}),
        },
        checks,
        station: (s) => station(alignment, s),
      })
      write((s) => ({ ...s, issues: [...s.issues, made] }), `Issued field pack ${made.label}`)
      downloadPack(made)
      setDrafts(null)
      setMessage(`${made.label} issued with ${made.checks.length} checks.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }
  const downloadPack = (made: FieldIssue) => {
    downloadText(
      fieldPackKml(made),
      `${fileStem(`${made.label}-${made.roadName}`)}.kml`,
      'application/vnd.google-earth.kml+xml',
    )
    onFieldPackPdf?.(made)
  }
  const importFile = async (picked: File | undefined) => {
    if (!picked) return
    try {
      const read = readObservations(
        project.fieldReview,
        (await readSpatialFile(picked)) as GeoJSON.FeatureCollection,
        picked.name,
      )
      if (read.added.length)
        write(
          (s) => ({ ...s, observations: [...s.observations, ...read.added] }),
          `Imported field observations from ${picked.name}`,
        )
      setMessage(
        [
          `${read.added.length} new observation${read.added.length === 1 ? '' : 's'}`,
          read.duplicates ? `${read.duplicates} already held` : '',
          read.skipped ? `${read.skipped} line or area feature${read.skipped === 1 ? '' : 's'} not read` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }
  const ordered = [...state.observations].sort(
    (a, b) => Number(a.status !== 'pending') - Number(b.status !== 'pending'),
  )

  return (
    <RoadSection
      title="Field review"
      summary={`${summary.issues} issued · ${summary.pending} to review`}
      defaultOpen={summary.pending > 0}
      help="Issue the active road to a field crew as a georeferenced PDF and a KML of the road and its numbered checks. Bring back the crew's KML or KMZ: an observation joins a check by the check's label in its name, note or a check attribute, or by your choice. Each is read on the road as issued and on the road as it stands now; nothing is applied to the design."
      data-testid="road-field-review-section"
    >
      <div className={cn(insetBox(), 'space-y-2')} data-testid="road-field-issue">
        <p className="text-xs font-medium">Issue field pack · {alignment.name}</p>
        <Field label="Revision">
          <input
            className={roadFieldClass}
            aria-label="Field pack revision"
            value={revision}
            maxLength={40}
            onChange={(e) => setRevision(e.target.value)}
          />
        </Field>
        <ul className="space-y-1 text-xs" aria-label="Checks to issue">
          {checks.map((c, i) => (
            <li key={`${c.kind}-${c.chainage}-${i}`} className="flex items-center justify-between gap-1">
              <span>
                <span className="font-medium">{labels[i]}</span> {FIELD_CHECK_KINDS[c.kind].label} ·{' '}
                {station(alignment, c.chainage)}
                {c.endChainage !== undefined && ` to ${station(alignment, c.endChainage)}`}
              </span>
              <Button
                variant="ghost"
                size="icon-2xs"
                aria-label={`Leave out check at ${station(alignment, c.chainage)}`}
                onClick={() => setDrafts(checks.filter((_, k) => k !== i))}
              >
                <Trash2 className="size-3" />
              </Button>
            </li>
          ))}
          {!checks.length && <li className="text-muted-foreground">No checks yet.</li>}
        </ul>
        <div className="grid grid-cols-[1fr_5rem] items-end gap-1">
          <Field label="Check">
            <RoadSelect
              ariaLabel="Check kind"
              className={roadFieldClass}
              value={kind}
              onValueChange={(value) => setKind(value as FieldCheckKind)}
              options={Object.entries(FIELD_CHECK_KINDS).map(([value, k]) => ({ value, label: k.label }))}
            />
          </Field>
          <NumberField label="Length m" value={lengthM} min={0} max={2000} step={1} onChange={setLengthM} />
        </div>
        <Button
          size="xs"
          variant="outline"
          className="w-full"
          onClick={() => {
            const at = readStation()
            setDrafts(
              [...checks, { kind, chainage: at, ...(lengthM > 0 ? { endChainage: at + lengthM } : {}) }].sort(
                (a, b) => a.chainage - b.chainage,
              ),
            )
          }}
        >
          Add check at the selected station
        </Button>
        <Button size="sm" className="w-full" onClick={issue} data-testid="road-field-issue-button">
          <FileDown className="size-3" /> Issue field pack
        </Button>
      </div>

      {state.issues.length > 0 && (
        <ul className="space-y-1 text-xs" aria-label="Issued field packs">
          {state.issues.map((made) => (
            <li key={made.id} className={cn(insetBox(), 'flex items-center justify-between gap-1')}>
              <span>
                <span className="font-medium">{made.label}</span> · {made.roadName} · Rev {made.revision || '–'} ·{' '}
                {made.issuedOn} · {made.checks.length} checks
              </span>
              <span className="flex shrink-0 gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-2xs"
                  aria-label={`Download ${made.label} again`}
                  onClick={() => downloadPack(made)}
                >
                  <Download className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-2xs"
                  aria-label={`Remove ${made.label}`}
                  onClick={() =>
                    write(
                      (s) => ({
                        issues: s.issues.filter((i) => i.id !== made.id),
                        observations: s.observations.map((o) =>
                          o.issueId === made.id ? { ...o, issueId: null, checkId: null, match: null } : o,
                        ),
                      }),
                      `Removed field pack ${made.label}`,
                    )
                  }
                >
                  <Trash2 className="size-3" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Button size="sm" variant="outline" className="w-full" onClick={() => file.current?.click()}>
        <Upload className="size-3" /> Import observations (KML or KMZ)
      </Button>
      <input
        ref={file}
        type="file"
        accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
        className="hidden"
        aria-label="Import field observations"
        onChange={(e) => {
          void importFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {message && (
        <p className="text-2xs text-muted-foreground" role="status" data-testid="road-field-review-message">
          {message}
        </p>
      )}

      {ordered.length > 0 && (
        <ul className="space-y-2" aria-label="Field observations">
          {ordered.map((o) => (
            <ObservationRow
              key={o.id}
              observation={o}
              state={state}
              roads={project.alignments}
              station={station}
              onWrite={write}
              onStation={setStation}
              onShowCulverts={onShowCulverts}
              activeRoadId={alignment.id}
            />
          ))}
        </ul>
      )}
    </RoadSection>
  )
}

function ObservationRow({
  observation: o,
  state,
  roads,
  station,
  onWrite,
  onStation,
  onShowCulverts,
  activeRoadId,
}: {
  observation: FieldObservation
  state: FieldReviewState
  roads: Alignment[]
  station: (road: Alignment, chainage: number) => string
  onWrite: (change: (s: FieldReviewState) => FieldReviewState, label: string) => void
  onStation: (chainage: number) => void
  onShowCulverts?: (chainage?: number) => void
  activeRoadId: string
}) {
  const issue = state.issues.find((i) => i.id === o.issueId) ?? null
  const road = roads.find((r) => r.id === issue?.roadId) ?? null
  const line = useMemo(() => (road ? roadCentreline(road) : null), [road])
  const reading = useMemo(() => readObservation(state, o, line), [state, o, line])
  const [current, setCurrent] = useState(0)
  const [issuedPick, setIssuedPick] = useState(0)
  const name = o.name || 'Unnamed point'
  /** An issued chainage, labelled with the road's stationing (or as metres when the road is gone). */
  const issuedStation = (s: number) => (road ? station(road, s) : `${s.toFixed(1)} m`)
  const decide = (status: FieldObservation['status']) =>
    onWrite(
      (s) =>
        withObservation(s, o.id, (x) => {
          const next: FieldObservation = { ...x, status, decidedOn: isoDate(new Date()) }
          delete next.issuedChainage
          delete next.currentChainage
          if (status === 'accepted') {
            const i = reading.issued[issuedPick],
              c = reading.current[current]
            if (i) next.issuedChainage = i.chainage
            if (c) next.currentChainage = c.chainage
          }
          if (status === 'pending') delete next.decidedOn
          return next
        }),
      `${status === 'accepted' ? 'Accepted' : status === 'rejected' ? 'Rejected' : 'Reopened'} field observation ${name}`,
    )
  const pending = o.status === 'pending'
  const goTo = road?.id === activeRoadId ? (o.currentChainage ?? reading.current[current]?.chainage) : undefined
  return (
    <li className={cn(insetBox(), 'space-y-1 text-xs')} data-testid="road-field-observation">
      <div className="flex items-start justify-between gap-1">
        <span className="font-medium">{name}</span>
        <span className="shrink-0 text-2xs text-muted-foreground">
          {o.status === 'pending' ? 'To review' : o.status === 'accepted' ? 'Accepted' : 'Rejected'}
          {o.decidedOn ? ` ${o.decidedOn}` : ''}
        </span>
      </div>
      {o.note && <p className="text-muted-foreground">{o.note}</p>}
      <p className="text-2xs text-muted-foreground">
        {o.file}
        {o.recordedAt ? ` · ${o.recordedAt}` : ''}
      </p>
      {pending ? (
        <>
          <Field label="Answers check">
            <RoadSelect
              ariaLabel={`Check answered by ${name}`}
              className={roadFieldClass}
              value={o.checkId ? `${o.issueId}|${o.checkId}` : o.issueId ? `${o.issueId}|` : '|'}
              onValueChange={(value) => {
                const [issueId, checkId] = value.split('|')
                onWrite(
                  (s) =>
                    withObservation(s, o.id, (x) => ({
                      ...x,
                      issueId: issueId || null,
                      checkId: checkId || null,
                      match: checkId ? (x.match === 'file' && x.checkId === checkId ? 'file' : 'designer') : null,
                    })),
                  `Matched field observation ${name}`,
                )
              }}
              options={[
                { value: '|', label: 'No issue chosen' },
                ...state.issues.flatMap((i) => [
                  { value: `${i.id}|`, label: `${i.label}: no check` },
                  ...[...i.checks]
                    .sort((a, b) => {
                      const near = (c: typeof a) => reading.nearChecks.findIndex((n) => n.check.id === c.id)
                      return (near(a) < 0 ? 1e9 : near(a)) - (near(b) < 0 ? 1e9 : near(b))
                    })
                    .map((c) => ({
                      value: `${i.id}|${c.id}`,
                      label: `${i.label} ${c.label} ${FIELD_CHECK_KINDS[c.kind].label} · ${c.station}${
                        reading.nearChecks.some((n) => n.check.id === c.id) ? ' · near' : ''
                      }`,
                    })),
                ]),
              ]}
            />
          </Field>
          {o.match === 'file' && reading.check && (
            <p className="text-2xs text-muted-foreground">
              Named in the file.{' '}
              {reading.fromCheckM !== null && `${reading.fromCheckM.toFixed(0)} m from ${reading.check.label}.`}
            </p>
          )}
          {issue && (
            <Field label={`Station as issued (${issue.label})`}>
              {reading.issued.length ? (
                <RoadSelect
                  ariaLabel={`Issued station of ${name}`}
                  className={roadFieldClass}
                  value={String(issuedPick)}
                  onValueChange={(v) => setIssuedPick(Number(v))}
                  options={reading.issued.map((c, k) => ({
                    value: String(k),
                    label: `${issuedStation(c.chainage)} · ${metres(c.offset)}`,
                  }))}
                />
              ) : (
                <p className="text-2xs text-muted-foreground">
                  More than {FIELD_MATCH_RADIUS_M} m from the issued road.
                </p>
              )}
            </Field>
          )}
          {road && (
            <Field label="Station now">
              {reading.current.length ? (
                <RoadSelect
                  ariaLabel={`Current station of ${name}`}
                  className={roadFieldClass}
                  value={String(current)}
                  onValueChange={(v) => setCurrent(Number(v))}
                  options={reading.current.map((c, k) => ({
                    value: String(k),
                    label: `${station(road, c.chainage)} · ${metres(c.offset)}`,
                  }))}
                />
              ) : (
                <p className="text-2xs text-muted-foreground">
                  More than {FIELD_MATCH_RADIUS_M} m from {road.name} as it stands.
                </p>
              )}
            </Field>
          )}
          {reading.issued.length > 1 || reading.current.length > 1 ? (
            <p className="text-2xs text-warning-foreground">
              The road passes this point more than once: choose the leg.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-1">
            <Button size="xs" onClick={() => decide('accepted')} data-testid="road-field-accept">
              Accept
            </Button>
            <Button size="xs" variant="outline" onClick={() => decide('rejected')}>
              Reject
            </Button>
            {goTo !== undefined && (
              <Button size="xs" variant="ghost" onClick={() => onStation(goTo)}>
                Go to station
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <p>
            {reading.check
              ? `${issue?.label} ${reading.check.label} ${FIELD_CHECK_KINDS[reading.check.kind].label}`
              : 'No check'}
            {o.issuedChainage !== undefined && ` · issued ${issuedStation(o.issuedChainage)}`}
            {road && o.currentChainage !== undefined && ` · now ${station(road, o.currentChainage)}`}
          </p>
          <div className="flex flex-wrap gap-1">
            {goTo !== undefined && (
              <Button size="xs" variant="ghost" onClick={() => onStation(goTo)}>
                Go to station
              </Button>
            )}
            {o.status === 'accepted' && reading.check?.kind === 'crossing' && goTo !== undefined && onShowCulverts && (
              <Button size="xs" variant="outline" onClick={() => onShowCulverts(goTo)}>
                Culverts at this station
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={() => decide('pending')}>
              Review again
            </Button>
          </div>
        </>
      )}
    </li>
  )
}
