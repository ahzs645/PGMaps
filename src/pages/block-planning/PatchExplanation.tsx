import { CalculationFormula, CalculationTable } from '@/components/ui/calculation-results'
import { useWorkerCalculation } from '@/hooks/useWorkerCalculation'
import { createFieldWorker } from '../forest-patches/fieldWorker'
import type { FieldInput } from '../forest-patches/fieldComparison'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DisclosureCard, DisclosureRow } from '@/components/ui/disclosure'
import { FORM_INPUT_CLASS, FormField, SelectField } from '@/components/ui/form-field'
import type { explainPatches, FieldComparison } from '../forest-patches/explanation'
import { disturbanceBasis, type Project, type Scenario } from '../forest-patches/project'

type Props = {
  project: Project
  explanation: ReturnType<typeof explainPatches>
  year: number
  scenario: Scenario
  onComparison: (comparison: FieldComparison | null) => void
}

const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 })
const points = (value: number | null) =>
  value === null ? 'Unknown' : Math.abs(value) > 0 && Math.abs(value) < 0.005 ? '<0.01' : format(Math.abs(value))
const screenLabel = (value: boolean | null) =>
  value === null ? 'Missing evidence' : value ? 'One or more classes moved farther' : 'No class moved farther'

export function PatchExplanation({ project, explanation, year, scenario, onComparison }: Props) {
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
  const footprints = project.features.filter(
    (f) => f.properties.scenario === 'reference' || f.properties.scenario === scenario,
  )
  const missingDates = footprints.filter((f) => f.properties.yearBasis === 'editor-default')
  const [id, setId] = useState('')
  const footprint = footprints.find((f) => f.properties.id === id)
  const [earliest, setEarliest] = useState('')
  const [latest, setLatest] = useState('')
  const [source, setSource] = useState('')
  const {
    result: comparison,
    busy,
    error,
    clear: clearRun,
    run,
  } = useWorkerCalculation<FieldInput, FieldComparison>(createFieldWorker, onComparison)

  function compare(event: FormEvent) {
    event.preventDefault()
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
      clearRun('Choose a footprint, enter an ordered range of years from 1600 to 2250, and describe the evidence.')
      return
    }
    run({ project, year, scenario, id, earliest: from, latest: through, source: source.trim() })
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
      {selectedClass &&
        (selectedClass.percent === null || totalHa <= 0 ? (
          <p>{selectedClass.label} · Class share unavailable.</p>
        ) : (
          <CalculationFormula
            expression={
              selectedClass.label +
              ' · ' +
              format(selectedClass.ha) +
              ' ha ÷ ' +
              format(totalHa) +
              ' ha × 100 = ' +
              format(selectedClass.percent) +
              '%. Target ' +
              format(selectedClass.target) +
              '%.'
            }
          />
        ))}
      {selectedClass?.movement != null && selectedClass.gapPoints != null && selectedClass.priorGapPoints != null && (
        <p>
          Distance to target in {year - 5} minus distance in {year} = {points(selectedClass.priorGapPoints)} −{' '}
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
          <CalculationTable
            caption={`Largest ${Math.min(5, patches.length)} of ${patches.length} mapped patches in ${selectedClass?.label}, ranked by young hectares.`}
            rows={patches.slice(0, 5)}
            rowKey={(p) => p.id}
            columns={[
              {
                label: 'Mapped patch',
                render: (p) => (
                  <>
                    Patch {p.id}
                    <span className="block text-xs font-normal">{p.footprintIds.join(', ')}</span>
                  </>
                ),
              },
              { label: 'Young hectares', render: (p) => format(p.youngHa) },
              { label: 'Contribution to class share (points)', render: (p) => points(p.sharePoints) },
            ]}
          />
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
            <CalculationTable
              caption={`Tested disturbance years and their effect on the ${year} distribution.`}
              rows={comparison.cases}
              rowKey={(c) => c.from}
              columns={[
                {
                  label: 'Disturbance year',
                  render: (c) => (c.from === c.through ? c.from : c.from + '–' + c.through),
                },
                { label: 'Trend screen', render: (c) => screenLabel(c.screen) },
                { label: 'Largest class shift from inventory (points)', render: (c) => points(c.maxClassShift) },
                { label: 'Most affected class in selected year', render: (c) => c.mostAffected ?? '—' },
                {
                  label: 'Largest change in movement over the interval (points)',
                  render: (c) => points(c.maxTrendShift),
                },
              ]}
            />
          </div>
        )}
      </DisclosureRow>
    </DisclosureCard>
  )
}
