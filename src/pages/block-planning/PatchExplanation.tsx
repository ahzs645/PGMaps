import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DisclosureCard, DisclosureRow } from '@/components/ui/disclosure'
import { FORM_INPUT_CLASS, FormField, SelectField } from '@/components/ui/form-field'
import type { Analysis } from '../forest-patches/analysis'
import { explainPatches, type FieldComparison } from '../forest-patches/explanation'
import { disturbanceBasis, type Project, type Scenario } from '../forest-patches/project'

type Props = {
  project: Project
  result: Analysis
  year: number
  scenario: Scenario
  onComparison: (comparison: FieldComparison | null) => void
}

const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 })
const points = (value: number | null) =>
  value === null ? 'Unknown' : Math.abs(value) > 0 && Math.abs(value) < 0.005 ? '<0.01' : format(Math.abs(value))
const screenLabel = (value: boolean | null) =>
  value === null ? 'Missing evidence' : value ? 'One or more classes moved farther' : 'No class moved farther'

export function PatchExplanation({ project, result, year, scenario, onComparison }: Props) {
  const explanation = useMemo(() => explainPatches(result, year, scenario), [result, year, scenario])
  const { classes, totalHa, unclassifiedHa, screen } = explanation
  const byGap = [...classes]
    .filter((c) => c.gapPoints !== null)
    .sort((a, b) => Math.abs(b.gapPoints!) - Math.abs(a.gapPoints!))
  const greatestGap = byGap[0]?.gapPoints
  const widest =
    greatestGap == null ? [] : byGap.filter((c) => Math.abs(Math.abs(c.gapPoints!) - Math.abs(greatestGap)) < 1e-8)
  const byMovement = classes
    .filter((c) => c.movement !== null && c.movement < -1e-8)
    .sort((a, b) => a.movement! - b.movement!)
  const worstMovement = byMovement[0]?.movement
  const worst = worstMovement == null ? [] : byMovement.filter((c) => Math.abs(c.movement! - worstMovement) < 1e-8)
  const [selectedBin, setSelectedBin] = useState('')
  const selectedClass = classes.find((c) => c.bin === selectedBin) ?? widest[0] ?? classes[0]
  const patches = selectedClass?.patches ?? []
  const priorClass = result.timeline
    .find((row) => row.year === year - 5 && row.scenario === scenario)
    ?.classes.find((c) => c.bin === selectedClass?.bin)
  const footprints = project.features.filter(
    (f) => f.properties.scenario === 'reference' || f.properties.scenario === scenario,
  )
  const missingDates = footprints.filter((f) => f.properties.yearBasis === 'editor-default')
  const [id, setId] = useState('')
  const footprint = footprints.find((f) => f.properties.id === id)
  const [earliest, setEarliest] = useState('')
  const [latest, setLatest] = useState('')
  const [source, setSource] = useState('')
  const [comparison, setComparison] = useState<FieldComparison | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const workerRef = useRef<Worker | null>(null)

  useEffect(
    () => () => {
      workerRef.current?.terminate()
      workerRef.current = null
    },
    [],
  )

  function clearRun() {
    workerRef.current?.terminate()
    workerRef.current = null
    setBusy(false)
    setError('')
    setComparison(null)
    onComparison(null)
  }

  function compare(event: FormEvent) {
    event.preventDefault()
    clearRun()
    const from = Number(earliest),
      through = Number(latest)
    if (
      !footprint ||
      !source.trim() ||
      !earliest ||
      !latest ||
      !Number.isInteger(from) ||
      !Number.isInteger(through) ||
      from < 1600 ||
      through > 2250 ||
      from > through
    ) {
      setError('Choose a footprint, enter an ordered range of years from 1600 to 2250, and describe the evidence.')
      return
    }
    try {
      const worker = new Worker(new URL('../forest-patches/field.worker.ts', import.meta.url), { type: 'module' })
      workerRef.current = worker
      setBusy(true)
      function finish() {
        worker.terminate()
        const current = workerRef.current === worker
        if (current) {
          workerRef.current = null
          setBusy(false)
        }
        return current
      }
      worker.onmessage = ({ data }: MessageEvent<{ comparison: FieldComparison } | { error: string }>) => {
        if (!finish()) return
        if ('error' in data) setError(data.error)
        else {
          setComparison(data.comparison)
          onComparison(data.comparison)
        }
      }
      worker.onerror = (e) => {
        if (finish()) setError(e.message || 'The field comparison could not run.')
      }
      worker.postMessage({ project, year, scenario, id, earliest: from, latest: through, source: source.trim() })
    } catch (e) {
      clearRun()
      setError(e instanceof Error ? e.message : 'The field comparison could not start.')
    }
  }

  return (
    <DisclosureCard title="Explain the patch calculation" summary={screenLabel(screen)} defaultOpen>
      <p>
        Class share = young hectares in the class ÷ all young hectares × 100. The merged patch area determines its
        class. Only young forest enters the share.
      </p>
      {selectedClass && (
        <SelectField
          label="Patch size class to explain"
          value={selectedClass.bin}
          onChange={(e) => setSelectedBin(e.target.value)}
        >
          {classes.map((c) => (
            <option key={c.bin} value={c.bin}>
              {c.label}
            </option>
          ))}
        </SelectField>
      )}
      {selectedClass && (
        <p>
          <strong>{selectedClass.label}</strong>
          {' · '}
          {selectedClass.percent === null || totalHa <= 0 ? (
            'Class share unavailable.'
          ) : (
            <>
              {format(selectedClass.ha)} ha ÷ {format(totalHa)} ha × 100 = {format(selectedClass.percent)}%. Target{' '}
              {format(selectedClass.target)}%.
            </>
          )}
        </p>
      )}
      {selectedClass?.movement != null && selectedClass.gapPoints != null && priorClass?.gapPoints != null && (
        <p>
          Distance to target in {year - 5} minus distance in {year} = {points(priorClass.gapPoints)} −{' '}
          {points(selectedClass.gapPoints)} points.{' '}
          {Math.abs(selectedClass.movement) <= 1e-8 ? (
            'The distance held steady.'
          ) : (
            <>
              This class moved {points(selectedClass.movement)} points{' '}
              {selectedClass.movement > 0 ? 'closer to' : 'farther from'} target.
            </>
          )}
        </p>
      )}
      {greatestGap != null && greatestGap !== 0 && (
        <p>
          Largest current gap from target is {points(greatestGap)} percentage points in{' '}
          {widest.map((c) => c.label).join(', ')}.
        </p>
      )}
      {screen === true && worst.length > 0 && (
        <p>
          Since {year - 5}, the largest move farther from target was {points(worstMovement ?? null)} percentage points
          in {worst.map((c) => c.label).join(', ')}.
        </p>
      )}
      {screen === false && (
        <p>
          Every class held its distance or moved closer to target between {year - 5} and {year}.
        </p>
      )}
      {screen === null && (
        <p>
          A trend requires a complete distribution in both {year - 5} and {year}. Check the prior period, its young area
          and unresolved size classes.
        </p>
      )}
      {unclassifiedHa > 0 && (
        <p>{format(unclassifiedHa)} ha have an unresolved patch size. These hectares remain in the denominator.</p>
      )}
      <DisclosureRow title="Mapped patches contributing to this class" defaultOpen>
        {patches.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <caption className="text-left text-muted-foreground">
                Largest {Math.min(5, patches.length)} of {patches.length} mapped patches in {selectedClass?.label},
                ranked by young hectares.
              </caption>
              <thead>
                <tr>
                  {['Mapped patch', 'Young hectares', 'Contribution to class share (points)'].map((h) => (
                    <th scope="col" key={h} className="p-1">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {patches.slice(0, 5).map((p) => (
                  <tr key={p.id} className="border-t">
                    <th scope="row" className="p-1">
                      Patch {p.id}
                      <span className="block text-xs font-normal">{p.footprintIds.join(', ')}</span>
                    </th>
                    <td className="p-1">{format(p.youngHa)}</td>
                    <td className="p-1">{points(p.sharePoints)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No mapped patch contributes to this class in {year}.</p>
        )}
      </DisclosureRow>
      <p>
        The trend comparison uses each class’s previous distance from target minus its current distance, in percentage
        points. A negative change flags review under Objective C. D.5(a) requires a determination about old or
        old-interior forest. D.5(b) requires a determination that the young-patch objective cannot be achieved.
      </p>
      <DisclosureRow title="Test a field measurement" summary="Disturbance year of one footprint" defaultOpen>
        <form className="space-y-3" onSubmit={compare}>
          <p>
            Test the stand-replacing disturbance year across a VRI estimate or field-supported range. Enter the same
            year twice for a single observation. The original inventory stays available for comparison.
          </p>
          {missingDates.length > 0 && (
            <p>
              {missingDates.length} {missingDates.length === 1 ? 'footprint uses' : 'footprints use'} the editor date
              because the imported disturbance year was missing. Check the harvest or fire record, or use field evidence
              to bound the date of the stand-replacing disturbance.
            </p>
          )}
          <SelectField
            label="Footprint to check"
            value={id}
            onChange={(e) => {
              clearRun()
              setId(e.target.value)
            }}
          >
            <option value="">Select a footprint</option>
            {footprints.map((f) => (
              <option key={f.properties.id} value={f.properties.id}>
                {f.properties.id}
                {f.properties.yearBasis === 'editor-default' ? ' · missing source year' : ''}
              </option>
            ))}
          </SelectField>
          {footprint && (
            <p>
              Inventory disturbance year {footprint.properties.year} · {disturbanceBasis(footprint)} ·{' '}
              {footprint.properties.source ?? project.source}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <FormField label="Earliest disturbance year">
              <input
                className={FORM_INPUT_CLASS}
                type="number"
                min="1600"
                max="2250"
                step="1"
                required
                value={earliest}
                onChange={(e) => {
                  clearRun()
                  setEarliest(e.target.value)
                }}
              />
            </FormField>
            <FormField label="Latest disturbance year">
              <input
                className={FORM_INPUT_CLASS}
                type="number"
                min="1600"
                max="2250"
                step="1"
                required
                value={latest}
                onChange={(e) => {
                  clearRun()
                  setLatest(e.target.value)
                }}
              />
            </FormField>
          </div>
          <FormField label="Measurement source or assumption">
            <input
              className={FORM_INPUT_CLASS}
              required
              value={source}
              onChange={(e) => {
                clearRun()
                setSource(e.target.value)
              }}
            />
          </FormField>
          <Button type="submit" variant="outline" disabled={busy || !footprints.length}>
            Compare disturbance years
          </Button>
          {busy && <span role="status"> Calculating patch geometry…</span>}
          {error && <p role="alert">{error}</p>}
        </form>
        {comparison && (
          <div className="space-y-2" aria-live="polite">
            <p>
              <strong>{comparison.id}</strong> · {comparison.source}. Inventory year {comparison.baselineYear}. Original
              trend screen · {screenLabel(comparison.baselineScreen)}.
            </p>
            {comparison.canFlip && (
              <p>
                A tested disturbance year reverses the original trend screen.
                {comparison.minFlipYears !== null && (
                  <>
                    {' '}
                    The smallest tested change that does this is {comparison.minFlipYears}{' '}
                    {comparison.minFlipYears === 1 ? 'year' : 'years'} from the inventory date.
                  </>
                )}
              </p>
            )}
            {comparison.baselineScreen === null && comparison.cases.some((c) => c.screen !== null) && (
              <p>A tested disturbance year supplies enough modelled young area for a trend comparison.</p>
            )}
            {comparison.canLoseEvidence && (
              <p>A tested disturbance year leaves insufficient evidence to compare both periods.</p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <caption className="text-left text-muted-foreground">
                  Tested disturbance years and their effect on the {year} distribution.
                </caption>
                <thead>
                  <tr>
                    {[
                      'Disturbance year',
                      'Trend screen',
                      'Largest class shift from inventory (points)',
                      'Most affected class in selected year',
                      'Largest change in movement over the interval (points)',
                    ].map((h) => (
                      <th scope="col" key={h} className="p-1">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparison.cases.map((c) => (
                    <tr className="border-t" key={c.from}>
                      <th scope="row" className="p-1">
                        {c.from === c.through ? c.from : c.from + '–' + c.through}
                      </th>
                      <td className="p-1">{screenLabel(c.screen)}</td>
                      <td className="p-1">{points(c.maxClassShift)}</td>
                      <td className="p-1">{c.mostAffected ?? '—'}</td>
                      <td className="p-1">{points(c.maxTrendShift)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DisclosureRow>
    </DisclosureCard>
  )
}
