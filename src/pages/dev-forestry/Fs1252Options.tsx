import { useState } from 'react'
import { ChevronDown, Eye } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CheckboxField, FORM_INPUT_CLASS, FormField, StyledSelect } from '@/components/ui/form-field'
import { insetBox } from '@/components/ui/inset-box'
import { InlineAlert } from '@/components/ui/map-panels'
import { ResultRow, ResultRowDetail } from '@/components/ui/result-list'
import { TextButton } from '@/components/ui/text-button'
import { ToolDisclosure } from '@/components/ui/tool-section'
import { cn } from '@/lib/utils'

import { formatKm, formatPct } from './measureFormat'
import type { FormMetadata, FormReview } from './pdf/fs1252'
import type { AnalysisResult } from './types'

/** The FS1252's office fields, in the form's order. */
export const FS1252_OFFICE_FIELDS: ReadonlyArray<[keyof FormMetadata, string]> = [
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

const DESIGN_LABELS = [
  'Response to visual force lines',
  'Borrows from natural character',
  'Edge treatments incorporated',
  'Distance from viewpoint',
  'Position on landform',
]

/** The stations the form carries and each one's optional reviewer inputs, kept while the run stands. */
export type Fs1252Choice = { selected: number[]; reviews: Record<number, FormReview> }

export const stationLabel = (result: AnalysisResult, index: number) =>
  `Station ${index + 1} · ${formatKm(result.stations[index].distanceAlongMeters)}`

/**
 * Handbook 4.0's FS1252 draft in Save & export: which stations get a form, the reviewer's optional
 * inputs for each, the run's diagnostics, and the office fields (kept on the scene).
 */
export function Fs1252Options({
  result,
  choice,
  onChoice,
  currentStation,
  viaReview,
  metadata,
  onMetadata,
}: {
  result: AnalysisResult | null
  choice: Fs1252Choice
  onChoice: (choice: Fs1252Choice) => void
  /** The road view's station, for *Add current road-view station*. */
  currentStation: number
  /** The step 4 record, used for the assessment station unless set here. */
  viaReview: FormReview | null
  metadata: FormMetadata
  onMetadata: (metadata: FormMetadata) => void
}) {
  const [pick, setPick] = useState<number | null>(null)
  const [openStation, setOpenStation] = useState<number | null>(null)
  const { selected, reviews } = choice
  const add = (index: number) =>
    onChoice({ ...choice, selected: selected.includes(index) ? selected : [...selected, index].sort((a, b) => a - b) })
  const changeReview = (index: number, patch: Partial<FormReview>) =>
    onChoice({ ...choice, reviews: { ...reviews, [index]: { ...reviews[index], ...patch } } })
  const picked = pick ?? result?.assessmentStationIndex ?? 0

  return (
    <section className="space-y-3 text-xs" aria-label="FS1252 options">
      {result && (
        <>
          <InlineAlert tone={result.quality?.numericalReady ? 'success' : 'warning'}>
            {result.quality?.numericalReady
              ? 'Numerical fields go into the PDF'
              : 'Numerical fields are withheld from the PDF: the run is provisional'}
          </InlineAlert>
          <div className="space-y-1.5">
            <p className="text-2xs font-medium text-muted-foreground">
              Stations in the PDF ({selected.length}) · one form per station, then the reference pages and a scenario
              appendix
            </p>
            <div className="flex flex-wrap gap-2">
              <StyledSelect
                className="min-w-0 flex-1 rounded-md border bg-background p-1"
                aria-label="Report viewpoint"
                value={picked}
                onChange={(e) => setPick(Number(e.target.value))}
              >
                {result.stations.map((s, i) => (
                  <option value={i} key={i}>
                    Station {i + 1} · {formatKm(s.distanceAlongMeters)}
                    {result.assessmentStationIndex === i ? ' · highest estimated ratio' : ''}
                  </option>
                ))}
              </StyledSelect>
              <Button variant="outline" size="sm" onClick={() => add(picked)}>
                Add
              </Button>
              <Button variant="outline" size="sm" onClick={() => add(currentStation)}>
                Add current road-view station
              </Button>
            </div>
            {selected.length > 0 && (
              <ul
                className={cn(insetBox({ padding: 'none' }), 'divide-y overflow-hidden')}
                aria-label="Viewpoints in the PDF"
              >
                {selected.map((index) => {
                  const open = openStation === index
                  return (
                    <li key={index}>
                      {/* A row opens the station's optional reviewer inputs under it. */}
                      <ResultRow
                        className="py-2"
                        title={stationLabel(result, index)}
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
                          {DESIGN_LABELS.map((label, i) => (
                            <label className="flex items-center justify-between gap-2" key={label}>
                              <span>{label}</span>
                              <StyledSelect
                                className="rounded-md border bg-background"
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
                              </StyledSelect>
                            </label>
                          ))}
                          <label className="flex justify-between">
                            Roads/sidecast within openings
                            <StyledSelect
                              className="rounded-md border bg-background"
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
                            </StyledSelect>
                          </label>
                          <label className="flex justify-between">
                            Dispersed retention
                            <StyledSelect
                              className="rounded-md border bg-background"
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
                            </StyledSelect>
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
                              onChoice({ ...choice, selected: selected.filter((i) => i !== index) })
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
          </div>
          <ToolDisclosure label="Run diagnostics" toggleProps={{ 'data-forestry-disclosure': 'run-diagnostics' }}>
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
          </ToolDisclosure>
        </>
      )}
      <ToolDisclosure label="FS1252 office information" toggleProps={{ 'data-forestry-disclosure': 'office-fields' }}>
        <p className="text-muted-foreground">
          Unknown fields stay blank. Export time is not a field-evaluation date. The signature and final EE decision are
          never auto-filled.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {FS1252_OFFICE_FIELDS.map(([key, label]) => (
            <FormField label={label} key={key}>
              <input
                maxLength={2000}
                value={metadata[key] ?? ''}
                onChange={(e) => onMetadata({ ...metadata, [key]: e.target.value })}
              />
            </FormField>
          ))}
        </div>
      </ToolDisclosure>
    </section>
  )
}
