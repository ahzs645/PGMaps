import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DisclosureCard } from '@/components/ui/disclosure'
import { FormField, FORM_INPUT_CLASS } from '@/components/ui/form-field'
import type { FieldPriorities as Results } from '../forest-patches/fieldComparison'
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
  const [result, setResult] = useState<Results | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const active = useRef<Worker | null>(null)
  useEffect(() => () => active.current?.terminate(), [])
  const run = () => {
    const years = Number(tolerance)
    if (!tolerance.trim() || !Number.isInteger(years) || years < 0 || years > 650) {
      setError('Enter a whole number of years from 0 to 650.')
      return
    }
    setBusy(true)
    setError('')
    const worker = new Worker(new URL('../forest-patches/field.worker.ts', import.meta.url), { type: 'module' })
    active.current = worker
    const finish = (data?: Results, message = '') => {
      setBusy(false)
      setError(message)
      setResult(data ?? null)
      onResult(data ?? null)
      worker.terminate()
      active.current = null
    }
    worker.onmessage = (e) => finish(e.data.priorities, e.data.error)
    worker.onerror = (e) => finish(undefined, e.message || 'Field comparison failed.')
    worker.postMessage({ project, year, scenario, tolerance: years })
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
            setResult(null)
            setError('')
            onResult(null)
          }}
        />
      </FormField>
      <Button variant="outline" disabled={busy || !project.features.length} onClick={run}>
        Compare footprint dates
      </Button>
      {busy && <p role="status">Comparing footprints across both periods…</p>}
      {busy && (
        <Button
          variant="ghost"
          onClick={() => {
            active.current?.terminate()
            active.current = null
            setBusy(false)
          }}
        >
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
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {[
                    'Footprint',
                    'Mapped year and source',
                    'Effect on trend flag',
                    'Largest change in movement (points)',
                    'Largest class shift (points)',
                  ].map((h) => (
                    <th key={h} scope="col" className="p-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <th scope="row" className="p-2">
                      {r.id}
                    </th>
                    <td className="p-2">
                      {r.year} · {r.basis} · {r.source}
                    </td>
                    <td className="p-2">
                      {[
                        r.canFlip && 'Can reverse at ' + r.minFlipYears + ' yr correction',
                        r.canResolve && 'Can become measurable',
                        r.canLoseEvidence && 'Can become unknown',
                      ]
                        .filter(Boolean)
                        .join(' · ') ||
                        (result.baselineScreen === null ? 'Remains unknown' : 'Unchanged across tested dates')}
                    </td>
                    <td className="p-2">
                      {r.maxTrendShift === null
                        ? 'Unknown'
                        : r.maxTrendShift.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                    </td>
                    <td className="p-2">
                      {r.maxClassShift === null
                        ? 'Unknown'
                        : r.maxClassShift.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </DisclosureCard>
  )
}
