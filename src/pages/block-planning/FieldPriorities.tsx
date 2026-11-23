import { CalculationTable } from '@/components/ui/calculation-results'
import { useWorkerCalculation } from '@/hooks/useWorkerCalculation'
import { createFieldWorker } from '../forest-patches/fieldWorker'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { DisclosureCard } from '@/components/ui/disclosure'
import { FormField, FORM_INPUT_CLASS } from '@/components/ui/form-field'
import type { FieldPriorities as Results, PriorityInput } from '../forest-patches/fieldComparison'
import type { Project, Scenario } from '../forest-patches/project'

export function FieldPriorities({
  project,
  year,
  scenario,
  onResult,
}: {
  project: Project
  year: number
  scenario: Scenario
  onResult: (r: Results | null) => void
}) {
  const [tolerance, setTolerance] = useState('')
  const { result, busy, error, clear, run } = useWorkerCalculation<PriorityInput, Results>(createFieldWorker, onResult)
  function compare() {
    const years = Number(tolerance)
    if (!tolerance.trim() || !Number.isInteger(years) || years < 0 || years > 650) {
      clear('Enter a whole number of years from 0 to 650.')
      return
    }
    run({ project, year, scenario, tolerance: years })
  }
  return (
    <DisclosureCard
      title="Prioritize field measurements"
      help="Changes to a disturbance date affect the young-forest calculation when a footprint enters or leaves the 0–20 year age window."
    >
      <p>
        Test each footprint independently. Enter the number of years its mapped disturbance date could be early or late.
        Use inventory metadata or field knowledge to choose the range.
      </p>
      <FormField label="Test disturbance dates within ± years">
        <input
          type="number"
          min="0"
          max="650"
          step="1"
          className={FORM_INPUT_CLASS}
          value={tolerance}
          disabled={busy}
          onChange={(e) => {
            setTolerance(e.target.value)
            clear()
          }}
        />
      </FormField>
      <Button variant="outline" disabled={busy || !project.features.length} onClick={compare}>
        Compare footprint dates
      </Button>
      {busy && <p role="status">Comparing footprints across both periods…</p>}
      {busy && (
        <Button variant="ghost" onClick={() => clear()}>
          Cancel comparison
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
          <p>
            Footprints that can reverse the trend flag come first, with the smallest date correction first. Other
            footprints are ranked by whether a trend can be measured, then by the change in movement and in current
            class share. Consider the reliability of each source when assigning field work.
          </p>
          <CalculationTable
            caption={`Footprint priorities for ${year}, tested at ±${result.tolerance} yr`}
            rows={result.rows}
            rowKey={(r) => r.id}
            columns={[
              { label: 'Footprint', render: (r) => r.id },
              { label: 'Mapped year and source', render: (r) => r.year + ' · ' + r.basis + ' · ' + r.source },
              {
                label: 'Effect on trend flag',
                render: (r) =>
                  [
                    r.canFlip && 'Can reverse at ' + r.minFlipYears + ' yr correction',
                    r.canResolve && 'Can become measurable',
                    r.canLoseEvidence && 'Can become unknown',
                  ]
                    .filter(Boolean)
                    .join(' · ') ||
                  (result.baselineScreen === null ? 'Remains unknown' : 'Unchanged across tested dates'),
              },
              {
                label: 'Largest change in movement (points)',
                render: (r) => r.maxTrendShift?.toLocaleString(undefined, { maximumFractionDigits: 3 }),
              },
              {
                label: 'Largest class shift (points)',
                render: (r) => r.maxClassShift?.toLocaleString(undefined, { maximumFractionDigits: 3 }),
              },
            ]}
          />
        </>
      )}
    </DisclosureCard>
  )
}
