import { useState } from 'react'
import { StyledSelect } from '@/components/ui/styled-select'
import { Button } from '@/components/ui/button'
import { FORM_INPUT_CLASS } from '@/components/ui/form-field'
import { amount, chosenValues, referenceArithmetic, type ReferenceRow } from './referenceMeasurements'
import {
  comparisonFigures,
  numeratorChoices,
  denominatorChoices,
  type ReferenceComparison,
  type ReferenceCapture,
  type ComparisonBasis,
} from './referenceComparison'
import type { ProjectAttachment } from './projectArchive'

const pct = (v: number | null | undefined) => (v == null ? 'Unavailable' : Number(v.toFixed(3)) + '%')
function Pick<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Record<T, string>
  onChange: (v: T) => void
}) {
  return (
    <label className="grid gap-1">
      {label}
      <StyledSelect className={FORM_INPUT_CLASS} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {Object.entries<string>(options).map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </StyledSelect>
    </label>
  )
}
function Result({ record }: { record: ReferenceComparison }) {
  const { result, reference, difference } = comparisonFigures(record)
  const check = referenceArithmetic(record.source),
    chosen = referenceArithmetic(record.selected)
  return (
    <div className="space-y-1 rounded-md border p-2">
      <p>
        Printed {pct(amount(record.source.percent))} · {record.source.rating ?? record.source.finalDetermination}
      </p>
      <p>
        Source arithmetic {pct(check.percentage)} ({check.numerator ?? '—'} / {check.denominator ?? '—'}{' '}
        {record.source.unit}) · {record.source.method}
      </p>
      <p>
        Selected reference {pct(reference)} · {record.benchmark === 'arithmetic' ? 'recomputed' : 'reported value'} ·{' '}
        {chosen.denominator ?? '—'} {record.selected.unit} · {record.selected.method}
      </p>
      <p>
        {record.capture.renderer} {pct(result?.percent)} ({result?.numerator ?? '—'} / {result?.denominator ?? '—'} px)
        · {numeratorChoices[record.basis.numerator]} · {denominatorChoices[record.basis.denominator]}
      </p>
      <p>
        Run sightline figure at capture{' '}
        {record.capture.sightlinePercent == null
          ? 'not recorded with this figure'
          : pct(record.capture.sightlinePercent) + ' (perspective, the assessment’s figure)'}
      </p>
      <p>
        {difference === null
          ? 'Difference unavailable until the measurement bases match.'
          : Number(difference.toFixed(3)) + ' percentage points (capture minus selected reference).'}
      </p>
    </div>
  )
}
export function ReferenceComparisonPanel({
  row,
  captures,
  attachments,
  onChange,
}: {
  row: ReferenceRow
  captures: ReferenceCapture[]
  attachments: ProjectAttachment[]
  onChange: (row: ReferenceRow) => void
}) {
  const [captureId, setCaptureId] = useState('')
  const [basis, setBasis] = useState<ComparisonBasis>({ numerator: 'cumulative', denominator: 'gross' })
  const [referenceNumerator, setReferenceNumerator] = useState<ReferenceComparison['referenceNumerator']>('')
  const [referenceDenominator, setReferenceDenominator] = useState<ReferenceComparison['referenceDenominator']>('')
  const [scale, setScale] = useState<ReferenceComparison['referenceScale']>('')
  const [benchmark, setBenchmark] = useState<ReferenceComparison['benchmark']>('arithmetic')
  const [confirmedStamp, setConfirmedStamp] = useState(''),
    [reviewer, setReviewer] = useState('')
  const [evidence, setEvidence] = useState<ReferenceComparison['evidence']>([])
  const [working, setWorking] = useState(false),
    [error, setError] = useState('')
  const available = captures.filter((c) => c.viewId === row.viewId && c.landformId === row.landformId)
  const cap = available.find((c) => c.id === captureId)
  const selected = chosenValues(row)
  const stamp = JSON.stringify([
    cap?.id,
    cap?.savedAt,
    row.viewId,
    row.landformId,
    selected,
    row.origins,
    basis,
    referenceNumerator,
    referenceDenominator,
    scale,
    benchmark,
    evidence,
    reviewer,
  ])
  const confirmed = !!cap && confirmedStamp === stamp
  const record: ReferenceComparison | null = cap
    ? {
        source: row.printed,
        origins: row.origins,
        selected,
        viewId: row.viewId,
        landformId: row.landformId,
        reviewer: reviewer.trim(),
        savedAt: '',
        confirmed,
        referenceScale: scale,
        referenceNumerator,
        referenceDenominator,
        basis,
        benchmark,
        evidence,
        capture: {
          id: cap.id,
          name: cap.name,
          viewId: cap.viewId,
          landformId: cap.landformId,
          landform: cap.landform,
          renderer: cap.renderer,
          savedAt: cap.savedAt,
          setup: cap.setup,
          counts: cap.readCounts(),
        },
      }
    : null
  const addFile = async (file: ProjectAttachment) => {
    setWorking(true)
    setError('')
    try {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.blob.arrayBuffer()))
      const sha256 = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
      setEvidence((current) => [
        ...current.filter((e) => e.sha256 !== sha256 || e.name !== file.name),
        { name: file.name, sha256 },
      ])
    } catch (e) {
      setError(String(e))
    } finally {
      setWorking(false)
    }
  }
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer font-medium">
        Compare with a saved PGMaps figure ({row.comparisons?.length ?? 0} saved)
      </summary>
      <div className="mt-3 space-y-3">
        <p>
          Link the workspace viewpoint and mapped landform above. Save an after-harvest analysis sheet for that planned
          view to use its measured pixels.
        </p>
        <Pick
          label="Capture"
          value={captureId}
          options={{
            '': 'Choose a saved figure',
            ...Object.fromEntries(available.map((c) => [c.id, c.name + ' · ' + c.landform + ' · ' + c.savedAt])),
          }}
          onChange={(id) => {
            setCaptureId(id)
            setConfirmedStamp('')
          }}
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <Pick
            label="Reference result to compare"
            value={benchmark}
            options={{ arithmetic: 'Recomputed from selected values', reported: 'Selected reported percentage' }}
            onChange={setBenchmark}
          />
          <Pick
            label="Source measurement scale"
            value={scale}
            options={{
              '': 'Unresolved',
              perspective: 'Perspective image area',
              plan: 'Planimetric ground area',
              ocular: 'Ocular judgment',
            }}
            onChange={setScale}
          />
          <Pick
            label="Source numerator basis"
            value={referenceNumerator}
            options={{ '': 'Unresolved', ...numeratorChoices }}
            onChange={setReferenceNumerator}
          />
          <Pick
            label="Source denominator basis"
            value={referenceDenominator}
            options={{ '': 'Unresolved', ...denominatorChoices }}
            onChange={setReferenceDenominator}
          />
          <Pick
            label="Capture numerator"
            value={basis.numerator}
            options={numeratorChoices}
            onChange={(numerator) => setBasis({ ...basis, numerator })}
          />
          <Pick
            label="Capture denominator"
            value={basis.denominator}
            options={denominatorChoices}
            onChange={(denominator) => setBasis({ ...basis, denominator })}
          />
        </div>
        <label className="grid gap-1">
          Dataset or evidence retained in the project
          <StyledSelect
            className={FORM_INPUT_CLASS}
            value=""
            disabled={working}
            onChange={(e) => {
              if (e.target.value) void addFile(attachments[Number(e.target.value)])
            }}
          >
            <option value="">Choose an attachment</option>
            {attachments.map((a, i) => (
              <option key={i} value={i}>
                {a.name}
              </option>
            ))}
          </StyledSelect>
        </label>
        {evidence.map((e) => (
          <div key={e.name + e.sha256} className="break-all">
            {e.name} · SHA-256 {e.sha256}{' '}
            <Button
              type="button"
              size="2xs"
              variant="ghost"
              onClick={() => setEvidence(evidence.filter((f) => f !== e))}
            >
              Remove
            </Button>
          </div>
        ))}
        <label className="grid gap-1">
          Reviewed by
          <input
            className={FORM_INPUT_CLASS}
            value={reviewer}
            maxLength={200}
            onChange={(e) => setReviewer(e.target.value)}
          />
        </label>
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmedStamp(e.target.checked ? stamp : '')}
          />
          I checked the camera framing, study-date treatment, visible face and exclusions against this capture.
        </label>
        {record && <Result record={record} />}
        {error && <p role="alert">{error}</p>}
        <Button
          type="button"
          size="sm"
          disabled={!record || !reviewer.trim() || !confirmed || working || (row.comparisons?.length ?? 0) >= 100}
          onClick={() => {
            if (record) {
              onChange({
                ...row,
                comparisons: [...(row.comparisons ?? []), { ...record, savedAt: new Date().toISOString() }],
              })
              setConfirmedStamp('')
            }
          }}
        >
          Save reviewed comparison
        </Button>
        {row.comparisons?.map((c, i) => (
          <details className="rounded-md border p-2" key={i}>
            <summary>
              {c.capture.name} · {c.reviewer} · {c.savedAt}
            </summary>
            <Result record={c} />
            <p>
              {c.capture.landform} · {c.capture.savedAt}
            </p>
            <details>
              <summary>Values and evidence at review</summary>
              <pre className="whitespace-pre-wrap break-words">
                {JSON.stringify(
                  {
                    captureSetup: c.capture.setup,
                    source: c.source,
                    origins: c.origins,
                    selected: c.selected,
                    scale: c.referenceScale,
                    numerator: c.referenceNumerator,
                    denominator: c.referenceDenominator,
                    evidence: c.evidence,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </details>
        ))}
      </div>
    </details>
  )
}
