import { Frame, type Catalog } from './Frame'
import { freshPlan, readPlan, storePlan, type Plan } from './document'
import { blockAreaHa } from '@/lib/forestry/blockSheet/blockFacts'
import LegalWorkbench, { emptyReview } from '../legal-workbench/Workspace'
import { installPacks } from '../legal-workbench/registry'
import { releaseKey } from '../../../packages/legal-rules/src/contract'
import riparian from '../../../packages/legal-rules/spatial/riparian-analysis.json'
import patch from '../../../packages/legal-rules/spatial/patch-analysis.json'
import type { Measurement } from '../../../packages/legal-rules/engine/spatialFacts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Position } from 'geojson'
import { Button } from '@/components/ui/button'
import { FormField, SelectField, FORM_INPUT_CLASS } from '@/components/ui/form-field'
import { downloadText } from '@/lib/download'
import { patchFacts } from '../forest-patches/legalEvidence'
import { PatchMap } from '../forest-patches/PatchMap'
import type { Analysis } from '../forest-patches/analysis'
import {
  movementTowardTarget,
  districts,
  exampleProject,
  emptyProject,
  order,
  parseProject,
  periodYears,
  scenarios,
  table,
  type Footprint,
  importLayer,
  type Scenario,
} from '../forest-patches/project'

const names = { reference: 'Shared baseline', proposed: 'Proposed harvest', alternative: 'Alternative harvest' }
const empty = { type: 'FeatureCollection' as const, features: [] }
const format = (n: number | null) => (n === null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 2 }))
function withoutBlockReviews(plan: Plan, id: string) {
  return Object.fromEntries(Object.entries(plan.reviews).filter(([key]) => JSON.parse(key)[0] !== id))
}
function save(value: unknown, name: string) {
  downloadText(JSON.stringify(value, null, 2), name, 'application/json')
}
function message(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to read project.'
}
export default function Workspace({
  initialPlan,
  warning,
  ...catalog
}: Catalog & { initialPlan: Plan; warning: string }) {
  const [plan, setPlan] = useState(initialPlan)
  const [saving, setSaving] = useState(!warning)
  const [saveError, setSaveError] = useState(warning)
  const project = plan.project
  const setProject = (next: typeof project) => setPlan((current) => ({ ...current, project: next }))
  const [selectedId, setSelectedId] = useState(initialPlan.view?.selectedId ?? '')
  const [blockName, setBlockName] = useState('')
  const [replacing, setReplacing] = useState<Footprint | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [scenario, setScenario] = useState<Scenario>(initialPlan.view?.scenario ?? 'proposed')
  const [year, setYear] = useState(initialPlan.view?.year ?? project.startYear)
  const savedPlan = useMemo(
    () => ({ ...plan, view: { selectedId, scenario, year } }),
    [plan, selectedId, scenario, year],
  )
  useEffect(() => {
    if (!saving) return
    let current = true
    // Keep the last readable draft while an input is temporarily incomplete.
    try {
      parseProject(savedPlan.project)
    } catch {
      setSaveError('Complete the landscape inputs to save this draft.')
      return
    }
    storePlan(savedPlan)
      .then(() => {
        if (current) setSaveError('')
      })
      .catch(() => {
        if (current) setSaveError('Local save failed. Use Save plan to keep a copy.')
      })
    return () => {
      current = false
    }
  }, [savedPlan, saving])
  const [fit, setFit] = useState(project)
  const [eventYear, setEventYear] = useState(String(project.startYear))
  const [loadingFile, setLoadingFile] = useState(false)
  const [vertices, setVertices] = useState<Position[] | null>(null)
  const [notice, setNotice] = useState('')
  const rationale = project.rationale ?? ''
  const [answer, setAnswer] = useState<{ request: object; result?: Analysis; error?: string }>()
  const regional = Boolean(project.district && project.ndu)
  const request = useMemo(() => ({ project, year, scenario }), [project, year, scenario])
  useEffect(() => {
    if (!regional) return
    const worker = new Worker(new URL('../forest-patches/patch.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => setAnswer({ ...e.data, request })
    worker.onerror = (e) => setAnswer({ request, error: e.message || 'The analysis worker could not start.' })
    worker.postMessage([request.project, request.year, request.scenario])
    return () => worker.terminate()
  }, [request, regional])
  const result = answer?.request === request ? answer.result : undefined
  const error = answer?.request === request ? answer.error : undefined
  const periods = periodYears(project.startYear)
  const selected = result?.timeline.find((row) => row.year === year && row.scenario === scenario)
  const previous = result?.timeline.find((row) => row.scenario === scenario && row.year === year - 5)
  const reference = result?.timeline.find((row) => row.year === year && row.scenario === 'reference')
  const add = useCallback((p: Position) => setVertices((v) => (v ? [...v, p] : null)), [])
  const displayed = project.features.filter(
    (f) => f.properties.scenario === 'reference' || f.properties.scenario === scenario,
  )
  async function finish() {
    if (!vertices || vertices.length < 3) return
    setLoadingFile(true)
    try {
      const feature: Footprint = {
        type: 'Feature',
        properties: replacing?.properties ?? {
          id: blockName.trim() || crypto.randomUUID(),
          scenario,
          year: Number(eventYear),
        },
        geometry: { type: 'Polygon', coordinates: [[...vertices, vertices[0]]] },
      }
      const updated = parseProject({
        ...project,
        features: replacing
          ? project.features.map((f) => (f.properties.id === replacing.properties.id ? feature : f))
          : [...project.features, feature],
      })
      const { prepareFootprints } = await import('../forest-patches/analysis')
      prepareFootprints({ ...updated, features: [feature] })
      if (replacing) {
        setPlan((current) => ({
          ...current,
          project: updated,
          reviews: withoutBlockReviews(current, replacing.properties.id),
        }))
      } else setProject(updated)
      setReplacing(null)
      setSelectedId(feature.properties.id)
      setBlockName('')
      setVertices(null)
      setNotice('')
    } catch (e) {
      setNotice(message(e))
    } finally {
      setLoadingFile(false)
    }
  }
  async function open(file: File, append = false) {
    setLoadingFile(true)
    try {
      const data: unknown = JSON.parse(await file.text())
      const opened = append ? undefined : await readPlan(data)
      const loaded = opened?.project ?? importLayer(project, data, file.name, Number(eventYear), scenario)
      const { prepareFootprints } = await import('../forest-patches/analysis')
      prepareFootprints(loaded)
      if (opened) {
        if (opened.packs.length) await installPacks(opened.packs)
        setPlan(opened)
        setSaving(true)
        setSelectedId(opened.view?.selectedId ?? '')
        setScenario(opened.view?.scenario ?? 'proposed')
      } else setProject(loaded)
      setFit(loaded)
      setYear(append ? year : (opened?.view?.year ?? loaded.startYear))
      setEventYear(String(loaded.startYear))
      setVertices(null)

      setNotice('')
    } catch (e) {
      setNotice(message(e))
    } finally {
      setLoadingFile(false)
    }
  }
  const selectedBlock = displayed.find((f) => f.properties.id === selectedId) ?? displayed[0]
  const subject = (selectedBlock?.properties.id ?? 'Landscape') + ' · ' + names[scenario] + ' · ' + year
  const reviewKey = JSON.stringify([
    selectedBlock?.properties.id ?? null,
    scenario,
    year,
    project.district,
    project.ndu,
  ])
  const [overlay, setOverlay] = useState<{ input: object; ha?: number | null; error?: string }>()
  const overlayInput = useMemo(
    () => ({ geometry: selectedBlock?.geometry, zones: plan.zones }),
    [selectedBlock?.geometry, plan.zones],
  )
  useEffect(() => {
    if (!overlayInput.geometry || !overlayInput.zones) return
    const worker = new Worker(new URL('./riparian.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event) => setOverlay({ ...event.data, input: overlayInput })
    worker.onerror = (e) => setOverlay({ error: e.message, input: overlayInput })
    worker.postMessage(overlayInput)
    return () => worker.terminate()
  }, [overlayInput])
  const overlap = overlay?.input === overlayInput ? (overlay.ha ?? null) : null
  const measuredTrend = result && patchFacts(project, result, year, scenario)
  const measurements: Measurement[] = [
    {
      operation: riparian.id,
      output: 'overlap-ha',
      value: overlap,
      evidence: plan.zones?.source ?? 'No zone layer supplied.',
    },
    {
      operation: patch.id,
      output: 'patch-class-away',
      value: measuredTrend?.facts[0].value ?? null,
      evidence: measuredTrend
        ? measuredTrend.source + ' · ' + measuredTrend.facts[0].evidence
        : 'Projection unavailable.',
    },
  ]
  async function loadZones(file: File) {
    setLoadingFile(true)
    try {
      const zones = (await import('./riparian')).readZones(JSON.parse(await file.text()), file.name)
      setPlan((current) => ({ ...current, zones }))
      setNotice('')
    } catch (e) {
      setNotice(message(e))
    } finally {
      setLoadingFile(false)
    }
  }
  function exportAssessment() {
    if (!result) return
    save(
      {
        format: 'pgmaps-patch-assessment-v1',
        bindingDecision: false,
        applicability: 'unverified',
        method: 'pg-2005-buffer-v1',
        legalSnapshot: order,
        legalFacts: patchFacts(project, result, year, scenario),
        project: { ...project, rationale },
        displayed: { year, scenario },
        ...result,
        rationaleDraft: rationale,
        limitations: [
          'User-defined reporting unit and land coverage.',
          'Only supplied stand-replacing disturbances are modelled.',
          '2005 guidance implementation has not been validated against the historical GIS.',
        ],
      },
      'patch-assessment.json',
    )
  }
  function replacePlan(next: typeof project) {
    if (
      (project.features.length || Object.keys(plan.reviews).length || plan.zones) &&
      !window.confirm('Replace the current plan on this device? Save plan keeps an independent copy.')
    )
      return
    setPlan(freshPlan(next))
    setSelectedId('')
    setFit(next)
    setYear(next.startYear)
    setEventYear(String(next.startYear))
    setScenario('proposed')
    setVertices(null)
    setReplacing(null)
    setBlockName('')
    setNotice('')
    setSaving(true)
  }
  const landscape = (
    <section className="space-y-4 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">Landscape inputs</h2>
      <FormField label="First projection year">
        <input
          type="number"
          min="1800"
          max="2200"
          className={FORM_INPUT_CLASS}
          key={project.startYear}
          defaultValue={project.startYear}
          onBlur={(e) => {
            const first = e.target.valueAsNumber
            if (Number.isInteger(first) && first >= 1800 && first <= 2200) {
              if (first !== project.startYear) {
                setProject({ ...project, startYear: first })
                setYear(first)
                setEventYear(String(first))
              }
            } else {
              e.target.value = String(project.startYear)
              setNotice('Choose a first projection year from 1800 to 2200.')
            }
          }}
        />
      </FormField>
      <FormField label="Inventory source and coverage">
        <input
          className={FORM_INPUT_CLASS}
          value={project.source}
          onChange={(e) => setProject({ ...project, source: e.target.value })}
        />
      </FormField>
      <SelectField
        label="Historic forest district"
        value={project.district}
        onChange={(e) => setProject({ ...project, district: e.target.value })}
      >
        <option value="">Unassigned</option>
        {districts.map((d) => (
          <option key={d}>{d}</option>
        ))}
      </SelectField>
      <SelectField
        label="Natural disturbance sub-unit"
        value={project.ndu}
        onChange={(e) => setProject({ ...project, ndu: e.target.value })}
      >
        <option value="">Unassigned</option>
        {table.targets.map((t) => (
          <option key={t.ndu}>{t.ndu}</option>
        ))}
      </SelectField>
      <p className="text-sm text-muted-foreground">
        Choose both geographic units to enable the Prince George patch model. Use polygons clipped to that unit. Verify
        inventory coverage, tenure and any later orders.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => replacePlan(emptyProject())}>
          New plan
        </Button>
        <Button variant="outline" onClick={() => replacePlan(exampleProject())}>
          Load Prince George sample
        </Button>
      </div>
    </section>
  )
  const map = (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          aria-label="Schedule"
          label="Schedule"
          value={scenario}
          disabled={vertices !== null}
          onChange={(e) => setScenario(e.target.value as Scenario)}
        >
          {scenarios.map((s) => (
            <option key={s} value={s}>
              {names[s]}
            </option>
          ))}
        </SelectField>
        <SelectField
          aria-label="Map year"
          label="Map year"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {periods.map((y) => (
            <option key={y}>{y}</option>
          ))}
        </SelectField>
        <FormField label="Disturbance year">
          <input
            type="number"
            min="1600"
            max="2250"
            value={eventYear}
            className={FORM_INPUT_CLASS}
            onChange={(e) => setEventYear(e.target.value)}
          />
        </FormField>
      </div>
      <PatchMap
        inputs={{ type: 'FeatureCollection', features: displayed }}
        patches={result?.patchMap ?? empty}
        zones={plan.zones?.layer}
        selected={selectedBlock}
        fit={fit}
        vertices={vertices}
        add={add}
      />
      <p className="text-sm">
        Orange outlines show footprints on this schedule.
        {regional && ' Green outlines show calculated young patches in ' + year + '.'}
      </p>
      {notice && <p role="alert">{notice}</p>}
      {saveError && <p role="alert">{saveError}</p>}
      {regional && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Patch distribution · {year}</h2>
          {error ? (
            <p role="alert">{error}</p>
          ) : !selected ? (
            <p role="status">Calculating patch geometry…</p>
          ) : (
            <>
              <p>
                {selected.patches} {selected.patches === 1 ? 'patch' : 'patches'} · {format(selected.totalHa)} ha young
                forest · {format(selected.unclassifiedHa)} ha with unresolved size class
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      {[
                        'Patch size',
                        'Young ha',
                        'Baseline %',
                        'Selected %',
                        'Target %',
                        'Gap (points)',
                        'Closer since prior period (points)',
                      ].map((h) => (
                        <th className="p-2" key={h}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selected.classes.map((c, i) => (
                      <tr className="border-t" key={c.bin}>
                        <th className="p-2">{table.labels[i]}</th>
                        {[
                          c.ha,
                          reference?.classes[i].percent ?? null,
                          c.percent,
                          c.target,
                          c.gapPoints,
                          selected.unclassifiedHa || previous?.unclassifiedHa
                            ? null
                            : movementTowardTarget(previous?.classes[i].percent ?? null, c.percent, c.target),
                        ].map((n, k) => (
                          <td className="p-2" key={k}>
                            {format(n)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details>
                <summary>Compare all periods and schedules</summary>
                <div className="overflow-x-auto">
                  <table className="mt-2 w-full text-left text-sm">
                    <thead>
                      <tr>
                        {[
                          'Year',
                          'Schedule',
                          'Young ha',
                          ...table.labels.map((l) => l + ' (%)'),
                          'Unclassified ha',
                        ].map((h) => (
                          <th key={h} className="p-1">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {periods.flatMap((y) =>
                        result!.timeline
                          .filter((r) => r.year === y)
                          .map((r) => (
                            <tr key={r.year + r.scenario} className="border-t">
                              <td>{y}</td>
                              <td>{names[r.scenario]}</td>
                              <td>{format(r.totalHa)}</td>
                              {r.classes.map((c) => (
                                <td key={c.bin}>{format(c.percent)}</td>
                              ))}
                              <td>{format(r.unclassifiedHa)}</td>
                            </tr>
                          )),
                      )}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </section>
      )}
    </div>
  )
  const review = (
    <div className="space-y-3">
      {regional && (
        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="text-lg font-semibold">Regulatory review</h2>
          <p className="text-sm">
            Objective C measures a landscape trend. A gap in one year does not establish a D.5 trigger. Approval and
            submission status require separate evidence.
          </p>
          {order.alternativesAndInterpretations
            .filter((a) => a.id.startsWith('D.5'))
            .map((a) => (
              <p key={a.id} className="text-sm">
                <strong>{a.id}</strong> {a.summary}
              </p>
            ))}
          <FormField
            label="Applicable plan, tenure and order evidence"
            description="Record document versions, dates, geographic scope and any superseding order for reviewer verification."
          >
            <textarea
              className={FORM_INPUT_CLASS}
              value={project.applicabilityEvidence ?? ''}
              onChange={(e) => setProject({ ...project, applicabilityEvidence: e.target.value })}
            />
          </FormField>
          <FormField label="Rationale draft">
            <textarea
              value={rationale}
              className={FORM_INPUT_CLASS}
              onChange={(e) => setProject({ ...project, rationale: e.target.value })}
              placeholder="Explain the trend, feasible alternatives, shortest practicable recovery, timber rights and monitoring."
            />
          </FormField>
          <Button disabled={!result} onClick={exportAssessment}>
            Export assessment JSON
          </Button>
          <p className="text-xs text-muted-foreground">
            Planning model using the December 2005 implementation guidance. The 2018 analysis used a revised method.
            Source material derived from the Province of British Columbia. Unofficial transcription.{' '}
            <a className="underline" href={order.source.url}>
              Order and implementation policy
            </a>{' '}
            ·{' '}
            <a className="underline" href="https://www.bclaws.gov.bc.ca/standards/Licence.html">
              King’s Printer Licence
            </a>
          </p>
        </section>
      )}
      <LegalWorkbench
        key={reviewKey}
        plan={{
          subject,
          evidence: () => ({
            plan: savedPlan,
            subject,
            measurements,
            projection: regional ? (result ?? null) : null,
            order: regional ? order : undefined,
          }),
          measurements,
          review: plan.reviews[reviewKey] ?? emptyReview(regional),
          onChange: (next, packs) => {
            setPlan((current) => ({
              ...current,
              reviews: { ...current.reviews, [reviewKey]: next },
              packs: [...new Map([...current.packs, ...packs].map((p) => [releaseKey(p), p])).values()],
            }))
          },
        }}
      />
    </div>
  )
  const blocks = (
    <fieldset disabled={loadingFile} className="space-y-3">
      <h2 className="text-lg font-semibold">Plan blocks</h2>
      {selectedBlock && vertices === null && (
        <Button
          variant="outline"
          onClick={() => {
            setReplacing(selectedBlock)
            setVertices([])
          }}
        >
          Redraw selected block
        </Button>
      )}
      {replacing && vertices !== null && (
        <p>
          Finish the new outline for {replacing.properties.id} to replace its geometry and clear its previous reviews.
        </p>
      )}
      <FormField label="New block name">
        <input className={FORM_INPUT_CLASS} value={blockName} onChange={(e) => setBlockName(e.target.value)} />
      </FormField>
      <div className="flex flex-wrap gap-2">
        {vertices === null ? (
          <Button
            onClick={() => {
              setReplacing(null)
              setVertices([])
            }}
          >
            Draw block
          </Button>
        ) : (
          <>
            <Button disabled={vertices.length < 3} onClick={finish}>
              Finish block
            </Button>
            <Button variant="outline" disabled={!vertices.length} onClick={() => setVertices(vertices.slice(0, -1))}>
              Undo vertex
            </Button>
            <Button variant="outline" onClick={() => setVertices(null)}>
              Cancel drawing
            </Button>
          </>
        )}
        <Button variant="outline" disabled={!project.features.length} onClick={() => setFit({ ...project })}>
          Fit all footprints
        </Button>
      </div>
      {vertices !== null && <p role="status">Click the map to add corners. {vertices.length} vertices drawn.</p>}
      <details>
        <summary>Manage footprints ({displayed.length})</summary>
        <ul className="mt-2 space-y-1">
          {displayed.map((f) => (
            <li key={f.properties.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="break-all">
                {f.properties.id} · {names[f.properties.scenario]} · {f.properties.year}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const newYear = Number(eventYear)
                  try {
                    const features = project.features.map((existing) =>
                      existing === f ? { ...f, properties: { ...f.properties, year: newYear } } : existing,
                    )
                    setProject(parseProject({ ...project, features }))
                    setNotice('')
                  } catch (e) {
                    setNotice(message(e))
                  }
                }}
              >
                Set year to {eventYear}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPlan((current) => ({
                    ...current,
                    project: {
                      ...current.project,
                      features: current.project.features.filter((a) => a.properties.id !== f.properties.id),
                    },
                    reviews: withoutBlockReviews(current, f.properties.id),
                  }))
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </details>

      <Button
        variant="outline"
        disabled={!displayed.length}
        onClick={() => save({ type: 'FeatureCollection', features: displayed }, 'planned-blocks.geojson')}
      >
        Export schedule polygons
      </Button>
      <FormField
        label="Add disturbance GeoJSON"
        description="Append pre-clipped polygons. Features without a year or scenario use the disturbance year and schedule shown here."
      >
        <input
          type="file"
          accept=".geojson,.json,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void open(file, true)
          }}
        />
      </FormField>
      <FormField
        label="Import mapped riparian zones"
        description="Use sourced WGS84 Polygon or MultiPolygon GeoJSON. Overlap is measured against supplied zones."
      >
        <input
          type="file"
          accept=".json,.geojson"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void loadZones(file)
          }}
        />
      </FormField>
      {plan.zones && (
        <>
          <p>{plan.zones.source}</p>
          <Button variant="outline" onClick={() => setPlan((current) => ({ ...current, zones: undefined }))}>
            Remove zone layer
          </Button>
        </>
      )}
      {overlay?.input === overlayInput && overlay.error && <p role="alert">{overlay.error}</p>}
    </fieldset>
  )
  return (
    <Frame
      {...catalog}
      editors={{ blocks, landscape, review }}
      busy={loadingFile}
      onOpen={() => fileRef.current?.click()}
      onSave={() => {
        try {
          parseProject(plan.project)
          save(savedPlan, 'block-plan.json')
        } catch (e) {
          setNotice(message(e))
        }
      }}
    >
      <input
        hidden
        aria-label="Open planning project"
        ref={fileRef}
        type="file"
        accept=".json,.geojson"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void open(file)
        }}
      />
      <div className="mb-3 grid gap-2">
        <SelectField
          label="Selected block"
          value={selectedBlock?.properties.id ?? ''}
          disabled={vertices !== null}
          onValueChange={setSelectedId}
        >
          {!displayed.length && <option value="">No blocks on this schedule</option>}
          {displayed.map((f) => (
            <option key={f.properties.id}>{f.properties.id}</option>
          ))}
        </SelectField>
        {selectedBlock && (
          <p className="text-sm">
            {format(blockAreaHa(selectedBlock.geometry))} ha gross block area ·{' '}
            {overlap === null ? 'Riparian overlap unmeasured' : format(overlap) + ' ha mapped riparian overlap'}
          </p>
        )}
      </div>
      {map}
    </Frame>
  )
}
