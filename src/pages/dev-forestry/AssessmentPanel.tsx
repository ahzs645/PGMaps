import {
  CheckboxField,
  FORM_INPUT_CLASS,
  FormField,
  NativeSelect,
  NullableNumberField,
  NumberField,
} from '@/components/ui/form-field'
import { useEffect, useState } from 'react'
import { ChevronDown, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { ResultRow, ResultRowDetail } from '@/components/ui/result-list'
import { TextButton } from '@/components/ui/text-button'
import { cn } from '@/lib/utils'
import type { ForestryScene } from './scene'
import type { AnalysisResult } from './types'
import { findSceneLandform } from './sceneInput'
import { resolveThreshold } from './integrity'
import { downloadFs1252, type FormMetadata, type FormReview } from './pdf/fs1252'
import { formatKm, formatPct } from './measureFormat'
/**
 * `scope` is handbook 3.3.2 — which landform the run measures against and what
 * counts as its green area. `report` is 4.0 — the FS1252 draft package.
 * The stale-run notice is the headline's, not this panel's.
 * `viaReview` is the step 4 record for the assessment station; a station's own
 * inputs here override it.
 */
type Props = {
  part: 'scope' | 'report'
  scene: ForestryScene
  onChange: (scene: ForestryScene) => void
  result: AnalysisResult | null
  stale: boolean
  snapshot: ForestryScene | null
  currentStation: number
  viaReview?: FormReview | null
}
const fields: Array<[keyof FormMetadata, string]> = [
  ['district', 'Forest district'],
  ['licensee', 'Licensee'],
  ['licence', 'Licence number'],
  ['cuttingPermit', 'Cutting permit'],
  ['blockIds', 'Block identifiers'],
  ['generalLocation', 'General location'],
  ['resultsOpeningId', 'RESULTS opening ID'],
  ['sampleCode', 'Sample code'],
  ['vliPolygon', 'VLI polygon number'],
  ['vsc', 'Visual sensitivity class'],
  ['evc', 'Existing visual condition'],
  ['recommendedVqc', 'Recommended VQC'],
  ['sourceDocument', 'Objective source document'],
  ['evaluator', 'Prepared/evaluated by (optional)'],
]
/** A label beside its field rather than above it, for short numbers. */
const INLINE_FIELD = 'flex-row items-center justify-between gap-3'
const designLabels = [
  'Response to visual force lines',
  'Borrows from natural character',
  'Edge treatments incorporated',
  'Distance from viewpoint',
  'Position on landform',
]
export function AssessmentPanel({ part, scene, onChange, result, stale, snapshot, currentStation, viaReview }: Props) {
  const [selected, setSelected] = useState<number[]>([]),
    [pick, setPick] = useState(0),
    [openStation, setOpenStation] = useState<number | null>(null)
  const [reviews, setReviews] = useState<Record<number, FormReview>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setSelected(result ? [result.assessmentStationIndex] : [])
    setPick(result?.assessmentStationIndex ?? 0)
    setOpenStation(null)
    setReviews({})
    setError(null)
  }, [result])
  const landform = findSceneLandform(scene),
    forms = scene.targets.filter((t) => t.role === 'landscape')
  const meta = scene.reportMetadata ?? {}
  const changeMeta = (key: keyof FormMetadata, value: string) =>
    onChange({ ...scene, reportMetadata: { ...meta, [key]: value } })
  const changeReview = (index: number, patch: Partial<FormReview>) =>
    setReviews((current) => ({ ...current, [index]: { ...current[index], ...patch } }))
  const exportPdf = async () => {
    if (!result || !snapshot || stale) return
    setBusy(true)
    setError(null)
    const merged = { ...(viaReview ? { [result.assessmentStationIndex]: viaReview } : {}), ...reviews }
    try {
      await downloadFs1252({
        result,
        targets: snapshot.targets,
        viewpointName: snapshot.viewpoint.name,
        stationIndices: selected,
        metadata: meta,
        reviews: merged,
        generatedAt: new Date().toISOString(),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  if (part === 'scope')
    return (
      <section className="space-y-3 text-xs" aria-label="Assessment landform">
        <label className="block">
          Active landform
          <NativeSelect
            aria-label="Active assessment landform"
            className="mt-1 w-full rounded border bg-background p-2"
            value={landform?.id ?? ''}
            onChange={(e) => onChange({ ...scene, activeLandformId: e.target.value || null })}
          >
            <option value="">{forms.length ? 'Select one landform' : 'Draw or adopt a candidate landform'}</option>
            {forms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <p className="text-muted-foreground">
          An inventory sensitivity unit is only a candidate. A landform is what one viewpoint sees as a single hillside,
          and a unit usually holds several; confirm the boundary from the assessment viewpoint. Other landforms are not
          pooled into its denominator.
        </p>
        {/* A cleared year restores the last one on blur rather than writing year 0. */}
        <NumberField
          label="Assessment year"
          contentClassName={INLINE_FIELD}
          inputClassName={cn(FORM_INPUT_CLASS, 'w-24')}
          min={1900}
          max={2200}
          value={scene.assessmentYear ?? new Date().getFullYear()}
          onValueChange={(assessmentYear) => onChange({ ...scene, assessmentYear })}
        />
        <CheckboxField
          label="Treat the entire active landform as assessable green area — an explicit scenario assumption, not a substitute for land-cover review."
          checked={scene.settings.greenAreaConfirmed === true}
          onCheckedChange={(greenAreaConfirmed) =>
            onChange({ ...scene, settings: { ...scene.settings, greenAreaConfirmed } })
          }
        />
        <CheckboxField
          label="The included features represent the existing disturbance for this scenario. Unlisted disturbance is not being inferred from a failed lookup."
          checked={scene.settings.existingDisturbanceConfirmed === true}
          onCheckedChange={(existingDisturbanceConfirmed) =>
            onChange({ ...scene, settings: { ...scene.settings, existingDisturbanceConfirmed } })
          }
        />
        {landform && (
          <p className="text-muted-foreground">
            Planimetric planning allowance:{' '}
            {resolveThreshold(landform.objectiveId, 'planimetric', scene.thresholds, landform.vac).value}%.{' '}
            {resolveThreshold(landform.objectiveId, 'planimetric', scene.thresholds, landform.vac).note}
          </p>
        )}
        <CollapsibleSection
          label="Existing-opening recovery overrides"
          className="rounded-md border"
          contentClassName="space-y-2 px-3 pb-3"
        >
          <p>
            Empty uses the stated green-up-age assumption. A percentage is a supplied recovery estimate, not an
            automatically observed value. An opening 70% greened up still counts 30% of its area (handbook 3.4.2).
          </p>
          {scene.targets
            .filter((t) => t.role === 'harvested' && !t.siteDisturbance)
            .map((t) => (
              <NullableNumberField
                key={t.id}
                label={<span className="truncate">{t.name}</span>}
                aria-label={`Recovery percent for ${t.name}`}
                contentClassName={INLINE_FIELD}
                inputClassName={cn(FORM_INPUT_CLASS, 'w-20')}
                suffix="%"
                placeholder="Age"
                min={0}
                max={100}
                value={t.recoveryPercent ?? null}
                onValueChange={(recoveryPercent) =>
                  onChange({
                    ...scene,
                    targets: scene.targets.map((x) => (x.id === t.id ? { ...x, recoveryPercent } : x)),
                  })
                }
              />
            ))}
        </CollapsibleSection>
      </section>
    )
  // One export action, then what goes into it: the readiness of the run, the
  // viewpoints the PDF carries, and the export itself stay in view; choosing
  // other viewpoints and the office fields are folded under it.
  return (
    <section className="space-y-3 text-xs" aria-label="Assessment integrity and PDF export">
      <h3 className="text-sm font-semibold">FS1252 draft package</h3>
      {result && (
        <>
          <InlineAlert tone={result.quality?.numericalReady ? 'success' : 'warning'}>
            {result.quality?.numericalReady
              ? 'Numerical fields go into the PDF'
              : 'Numerical fields are withheld from the PDF: the run is provisional'}
          </InlineAlert>
          <p>
            <span className="text-muted-foreground">Viewpoints in the PDF: </span>
            {selected.length
              ? selected
                  .map(
                    (index) =>
                      `Station ${index + 1} · ${formatKm(result.stations[index].distanceAlongMeters)}${index === result.assessmentStationIndex ? ' (the assessment station)' : ''}`,
                  )
                  .join('; ')
              : 'none chosen'}
          </p>
          <Button
            size="sm"
            className="w-full touch:h-10"
            disabled={busy || stale || !snapshot || !selected.length || selected.length > 30}
            onClick={() => void exportPdf()}
          >
            Export filled FS1252 PDF
          </Button>
          {busy && <InlineAlert loading>Preparing PDF…</InlineAlert>}
          <p className="text-muted-foreground">
            The PDF takes the ocular class and ratings you recorded in step 4; field photographs, the final decision and
            the signature are still the reviewer's to add.
          </p>
          <CollapsibleSection
            label={`Choose viewpoints for the PDF (${selected.length})`}
            toggleProps={{ 'data-forestry-disclosure': 'report-viewpoints' }}
            className="rounded-md border"
            contentClassName="space-y-2 px-3 pb-3"
          >
            <p>
              FS1252 2008/04 — simulation draft. One form per selected station; original reference pages and a scenario
              appendix follow. The form has five design rows; number, size and spacing stays on the step 4 record.
            </p>
            <div className="flex gap-2">
              <NativeSelect
                className="min-w-0 flex-1 rounded border bg-background p-1"
                aria-label="Report viewpoint"
                value={pick}
                onChange={(e) => setPick(Number(e.target.value))}
              >
                {result.stations.map((s, i) => (
                  <option value={i} key={i}>
                    Station {i + 1} · {formatKm(s.distanceAlongMeters)}
                    {result.assessmentStationIndex === i ? ' · highest estimated ratio' : ''}
                  </option>
                ))}
              </NativeSelect>
              <Button
                variant="outline"
                size="sm"
                className="touch:h-10"
                onClick={() => setSelected((s) => (s.includes(pick) ? s : [...s, pick].sort((a, b) => a - b)))}
              >
                Add
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="touch:h-10"
              onClick={() =>
                setSelected((s) => (s.includes(currentStation) ? s : [...s, currentStation].sort((a, b) => a - b)))
              }
            >
              Add current road-view station
            </Button>
            {selected.length > 0 && (
              <ul className="divide-y overflow-hidden rounded-md border" aria-label="Viewpoints in the PDF">
                {selected.map((index) => {
                  const open = openStation === index
                  return (
                    <li key={index}>
                      {/* A row opens the station's optional reviewer inputs under it. */}
                      <ResultRow
                        className="py-2"
                        title={`Station ${index + 1} · ${formatKm(result.stations[index].distanceAlongMeters)}`}
                        subtitle={
                          index === result.assessmentStationIndex
                            ? 'The assessment station'
                            : reviews[index]
                              ? 'Reviewer inputs set'
                              : 'Reviewer inputs optional'
                        }
                        leading={<Eye className="mt-1 size-3 text-muted-foreground" aria-hidden="true" />}
                        trailing={
                          <ChevronDown
                            aria-hidden="true"
                            className={cn(
                              'mt-1 size-4 text-muted-foreground transition-transform',
                              open && 'rotate-180',
                            )}
                          />
                        }
                        selected={open}
                        aria-expanded={open}
                        onClick={() => setOpenStation(open ? null : index)}
                      />
                      {open && (
                        <ResultRowDetail className="space-y-2">
                          {index === result.assessmentStationIndex && viaReview && !reviews[index] && (
                            <p className="text-muted-foreground">
                              Design, road and retention entries come from step 4 unless you set them below.
                            </p>
                          )}
                          <p className="text-muted-foreground">
                            Optional reviewer-supplied design inputs. These five judgements are not inferred by the
                            model. They are labelled as supplied review inputs, not a field visit.
                          </p>
                          {designLabels.map((label, i) => (
                            <label className="flex items-center justify-between gap-2" key={label}>
                              <span>{label}</span>
                              <NativeSelect
                                className="rounded border bg-background"
                                value={reviews[index]?.design?.[i] ?? ''}
                                onChange={(e) => {
                                  const design = [...(reviews[index]?.design ?? Array(5).fill(null))]
                                  design[i] = e.target.value === '' ? null : Number(e.target.value)
                                  changeReview(index, { design: design as FormReview['design'] })
                                }}
                              >
                                <option value="">Not assessed</option>
                                <option value="-1">Good (-1)</option>
                                <option value="0">Moderate (0)</option>
                                <option value="1">Poor (+1)</option>
                              </NativeSelect>
                            </label>
                          ))}
                          <label className="flex justify-between">
                            Roads/sidecast within openings
                            <NativeSelect
                              className="rounded border bg-background"
                              value={reviews[index]?.roads ?? ''}
                              onChange={(e) =>
                                changeReview(index, {
                                  roads: e.target.value === '' ? null : (Number(e.target.value) as 0 | 1 | 2 | 3),
                                })
                              }
                            >
                              <option value="">Not assessed</option>
                              <option value="0">None (0)</option>
                              <option value="1">Subordinate (+1)</option>
                              <option value="2">Significant (+2)</option>
                              <option value="3">Dominant (+3)</option>
                            </NativeSelect>
                          </label>
                          <label className="flex justify-between">
                            Dispersed retention
                            <NativeSelect
                              className="rounded border bg-background"
                              value={reviews[index]?.retention ?? ''}
                              onChange={(e) =>
                                changeReview(index, {
                                  retention: e.target.value === '' ? null : (Number(e.target.value) as -2 | -1 | 0),
                                })
                              }
                            >
                              <option value="">Not assessed</option>
                              <option value="-2">High, over 22% (-2)</option>
                              <option value="-1">Moderate, 15–22% (-1)</option>
                              <option value="0">Low, under 15% (0)</option>
                            </NativeSelect>
                          </label>
                          <CheckboxField
                            label="Retained patches were already netted from the geometry"
                            checked={reviews[index]?.retentionAlreadyNetted === true}
                            onCheckedChange={(retentionAlreadyNetted) =>
                              changeReview(index, { retentionAlreadyNetted })
                            }
                          />
                          <FormField label={`Review notes for station ${index + 1}`} hideLabel>
                            <textarea
                              className={FORM_INPUT_CLASS}
                              maxLength={4000}
                              placeholder="Reviewer notes and evidence"
                              value={reviews[index]?.notes ?? ''}
                              onChange={(e) => changeReview(index, { notes: e.target.value })}
                            />
                          </FormField>
                          <TextButton
                            tone="danger"
                            onClick={() => {
                              setSelected((s) => s.filter((i) => i !== index))
                              setOpenStation(null)
                            }}
                          >
                            Remove station {index + 1} from the PDF
                          </TextButton>
                        </ResultRowDetail>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </CollapsibleSection>
          <CollapsibleSection
            label="Run diagnostics"
            className="rounded-md border"
            contentClassName="space-y-2 px-3 pb-3"
          >
            <p>
              Largest landform grid cell: {formatPct(result.quality?.largestGroundCellPercent, 2)} of green map area.
              This is a resolution diagnostic, not an error bound.
            </p>
            {result.quality?.warnings.map((message, i) => (
              <p key={i} className="text-muted-foreground">
                {message}
              </p>
            ))}
            <p className="text-muted-foreground">
              Custom planning thresholds do not replace the form’s perspective class ranges.
            </p>
          </CollapsibleSection>
        </>
      )}
      <CollapsibleSection
        label="FS1252 office information"
        className="rounded-md border"
        contentClassName="space-y-2 px-3 pb-3"
      >
        <p>
          Unknown fields stay blank. Export time is not a field-evaluation date. The signature and final EE decision are
          never auto-filled.
        </p>
        {fields.map(([key, label]) => (
          <FormField label={label} key={key}>
            <input maxLength={2000} value={meta[key] ?? ''} onChange={(e) => changeMeta(key, e.target.value)} />
          </FormField>
        ))}
      </CollapsibleSection>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
    </section>
  )
}
