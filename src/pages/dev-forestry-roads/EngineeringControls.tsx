import { StationValue, useStationReader } from './roadStation'
import { RoadSection } from './SidebarParts'
import { RoadSettingsDialog } from './RoadSettingsDialog'
import { useRef, useState } from 'react'
import { ArrowRight, Copy, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { crossingsWithoutStructure } from './costReadiness'
import { TabBar } from '@/components/ui/tab-bar'
import { Field, NumberField, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import { createEngineeringDesign } from './engineeringTypes'
import { createMaterialVolumeFactorProvenance, materialCompactionFactorPatch } from './materialFactors'
import { downloadText } from '@/lib/download'
import { importRoadLibrary, serializeRoadLibrary } from './project'
import { TemplateSandbox } from './TemplateSandbox'
import { SectionAssemblyEditor } from './SectionAssemblyEditor'
import { SitePreparationEditor } from './SitePreparationEditor'
import { RockCutFields, rockCutSummary } from './RockCutFields'
import { GravelSourcesPanel } from './GravelSourcesPanel'
import { MaterialAllocationControls } from './MaterialAllocationControls'
import { surfacingSupplyCost } from './gravel'
import { ReferenceSelect } from './CostReferenceControls'
import { EntryProblem } from './InputProblem'
import { freeStationRange, inputMessage, invalidInputMessages, type EngineeringInputList } from './inputErrors'
import { horizonReplacements, MAX_HORIZON_DEPTH_M, nextHorizon } from './groundHorizons'
import { culvertFallPercent, culvertScreeningCapacity, invertsForFall } from './culvertGrade'
import { DEFAULT_DRAINAGE_SETTINGS } from './drainageRun'
import { nearestStation } from './engine'
import {
  copyTemplateSide,
  ditchWidthRange,
  keyedRockFillTemplate,
  templateFromStarter,
  validateTemplate,
  type TemplateStarter,
} from './templates'
import { formatRoadStation } from './Charts'
import type { RoadWorkspace } from './useRoadWorkspace'
import type {
  AlignmentEngineering,
  Culvert,
  GroundMaterial,
  MaterialVolumeFactorConvention,
  MaterialVolumeFactorProvenance,
  HaulSettings,
  HaulSite,
  RoadTemplate,
  StratumAssignment,
  TemplateAssignment,
} from './types'

const uid = () => crypto.randomUUID()
type NumericField<T> = { key: keyof T; label: string; min?: number; max?: number; step?: number; hint?: string }
function Fields<T extends object>({
  value,
  fields,
  onChange,
  errorFor,
}: {
  value: T
  fields: NumericField<T>[]
  onChange: (patch: Partial<T>) => void
  /** The validation message for one of these fields, shown under it. */
  errorFor?: (field: string) => string | undefined
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {fields.map((field) => (
        <NumberField
          key={String(field.key)}
          label={field.label}
          value={typeof value[field.key] === 'number' ? (value[field.key] as number) : 0}
          min={field.min}
          max={field.max}
          step={field.step}
          hint={field.hint}
          error={errorFor?.(String(field.key))}
          onChange={(number) => onChange({ [field.key]: number } as Partial<T>)}
        />
      ))}
    </div>
  )
}

function MaterialFactorEditor({
  material,
  onChange,
}: {
  material: GroundMaterial
  onChange: (patch: Partial<GroundMaterial>) => void
}) {
  const [convention, setConvention] = useState<MaterialVolumeFactorConvention>(
    material.volumeFactorProvenance?.convention ?? 'compacted-per-bank',
  )
  const [entered, setEntered] = useState(
    String(material.volumeFactorProvenance?.enteredFactor ?? material.compactionFactor),
  )
  const [source, setSource] = useState(material.volumeFactorProvenance?.source ?? '')
  // An edit to the factor itself (or an undo) replaces what the converter was showing.
  const [seenFactor, setSeenFactor] = useState(material.compactionFactor)
  if (seenFactor !== material.compactionFactor) {
    setSeenFactor(material.compactionFactor)
    const recorded = material.volumeFactorProvenance
    setEntered(String(recorded?.enteredFactor ?? material.compactionFactor))
    setConvention(recorded?.convention ?? 'compacted-per-bank')
  }
  let preview: MaterialVolumeFactorProvenance | undefined
  let error: string | undefined
  try {
    preview = createMaterialVolumeFactorProvenance(Number(entered), convention, source)
  } catch (cause) {
    error = cause instanceof Error ? cause.message : 'Enter a valid volume factor.'
  }
  const recorded = material.volumeFactorProvenance
  return (
    <>
      <NumberField
        label={`${material.name} compacted / bank factor`}
        value={material.compactionFactor}
        min={0.1}
        max={2}
        step={0.05}
        hint="Compacted fill volume per reusable bank volume: below 1 the material shrinks when placed, above 1 it swells. Usable compacted cut equals bank cut × reusable fraction × this factor. A source that states bank volume per compacted volume, as a RoadEng fill expansion factor does, goes through the factor conversion below. Editing this value clears a recorded conversion when the factor changes."
        onChange={(factor) => onChange(materialCompactionFactorPatch(material, factor))}
      />
      <RoadSection
        title={`${material.name} factor conversion`}
        summary={recorded ? `${recorded.enteredFactor} → ${recorded.canonicalFactor.toPrecision(8)}` : 'Optional'}
        toggleTestId={`material-factor-converter-${material.id}`}
        help="Choose the ratio your source states, then apply. Bank / compacted is inverted before it is applied: 1.05 becomes 0.952. A RoadEng fill expansion factor is bank / compacted when that ground type's cut factor is 1; with another cut factor, work out compacted per bank volume yourself and enter it as Compacted / bank. Reusable fraction stays separate. Source notes are entered evidence, not verification."
      >
        <Field label={`${material.name} factor convention`}>
          <RoadSelect
            ariaLabel={`${material.name} factor convention`}
            className={roadFieldClass}
            value={convention}
            onValueChange={(value) => setConvention(value as MaterialVolumeFactorConvention)}
          >
            <option value="compacted-per-bank">Compacted / bank</option>
            <option value="bank-per-compacted">Bank / compacted</option>
          </RoadSelect>
        </Field>
        <Field label={`${material.name} entered volume factor`}>
          <input
            className={roadFieldClass}
            inputMode="decimal"
            value={entered}
            onChange={(event) => setEntered(event.target.value)}
          />
        </Field>
        <Field
          label={`${material.name} factor source (optional)`}
          hint="Record the document, page, test result or assumption that states the entered ratio. This note travels with the material in project and road-library JSON."
        >
          <input
            className={roadFieldClass}
            maxLength={500}
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
        </Field>
        <output aria-label={`${material.name} canonical factor preview`} className="block text-xs tabular-nums">
          {preview ? `${preview.canonicalFactor.toPrecision(12)} compacted / bank` : 'No valid conversion'}
        </output>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <Button
          size="sm"
          variant="outline"
          aria-label={`Apply ${material.name} factor conversion`}
          disabled={!preview}
          onClick={() => {
            if (preview) onChange({ compactionFactor: preview.canonicalFactor, volumeFactorProvenance: preview })
          }}
        >
          Apply factor conversion
        </Button>
        {recorded && (
          <Field label={`${material.name} recorded conversion`} hint={recorded.source ?? 'No source note entered.'}>
            <span className="text-xs tabular-nums" data-testid={`material-factor-record-${material.id}`}>
              {recorded.enteredFactor}{' '}
              {recorded.convention === 'bank-per-compacted' ? 'bank / compacted' : 'compacted / bank'}
              {' = '}
              {recorded.canonicalFactor.toPrecision(12)} compacted / bank
            </span>
          </Field>
        )}
      </RoadSection>
    </>
  )
}

function Name({
  value,
  label,
  onChange,
  onDelete,
}: {
  value: string
  label: string
  onChange: (name: string) => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        aria-label={label}
        maxLength={200}
        className={roadFieldClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label={`Remove ${value}`} onClick={onDelete}>
        <Trash2 className="size-3" />
      </Button>
    </div>
  )
}
const templateFields: NumericField<RoadTemplate>[] = [
  { key: 'leftWidth', label: 'Template left width (m)', min: 0.1, max: 50 },
  { key: 'rightWidth', label: 'Template right width (m)', min: 0.1, max: 50 },
  { key: 'crossfallPercent', label: 'Template crown (%)', max: 20 },
  { key: 'surfaceDepth', label: 'Template surface depth (m)', max: 2 },
  { key: 'cutSlope', label: 'Template cut H:V', min: 0.1, max: 10 },
  { key: 'fillSlope', label: 'Template fill H:V', min: 0.1, max: 10 },
  { key: 'ditchWidth', label: 'Template ditch width (m)', max: 10 },
  { key: 'ditchDepth', label: 'Template ditch depth (m)', max: 5 },
  { key: 'ditchBottomWidth', label: 'Ditch bottom width (m, 0 = V)', max: 10 },
]
const sideFields: NumericField<RoadTemplate>[] = [
  { key: 'leftCrossfallPercent', label: 'Left crossfall (%)', min: -20, max: 20 },
  { key: 'rightCrossfallPercent', label: 'Right crossfall (%)', min: -20, max: 20 },
  { key: 'leftCutSlope', label: 'Left cut H:V', min: 0.1, max: 10 },
  { key: 'rightCutSlope', label: 'Right cut H:V', min: 0.1, max: 10 },
  { key: 'leftFillSlope', label: 'Left fill H:V', min: 0.1, max: 10 },
  { key: 'rightFillSlope', label: 'Right fill H:V', min: 0.1, max: 10 },
  { key: 'leftDitchWidth', label: 'Left ditch width (m)', max: 10 },
  { key: 'rightDitchWidth', label: 'Right ditch width (m)', max: 10 },
  { key: 'leftDitchDepth', label: 'Left ditch depth (m)', max: 5 },
  { key: 'rightDitchDepth', label: 'Right ditch depth (m)', max: 5 },
  { key: 'leftDitchBottomWidth', label: 'Left ditch bottom width (m, 0 = V)', max: 10 },
  { key: 'rightDitchBottomWidth', label: 'Right ditch bottom width (m, 0 = V)', max: 10 },
  { key: 'leftSurfaceDepth', label: 'Left surface depth (m)', max: 2 },
  { key: 'rightSurfaceDepth', label: 'Right surface depth (m)', max: 2 },
]
type TemplateCandidate = {
  alignmentId: string
  templateId: string | undefined
  saved: RoadTemplate | undefined
  source: RoadWorkspace['source']
  value: RoadTemplate | undefined
  epoch: number
}

export function EngineeringControls({
  workspace: w,
  onPreviewTemplate,
  onClosePreview,
  onQuantities,
  previewActive = false,
  aggregateOpen = false,
  onAggregateOpenChange,
  culvertRequest,
  templateRequest,
  inputsRequest,
  onShowDrainage,
}: {
  workspace: RoadWorkspace
  onPreviewTemplate: (template: RoadTemplate, name: string) => void
  onClosePreview?: () => void
  onQuantities: () => void
  previewActive?: boolean
  aggregateOpen?: boolean
  onAggregateOpenChange?: (open: boolean) => void
  culvertRequest?: number
  /** Opens the Templates tab on this library template; a new sequence repeats the request. */
  templateRequest?: { id: string; sequence: number }
  /** Brings one input tab forward, e.g. from a Review check; a new `sequence` asks again. */
  inputsRequest?: { tab: 'templates' | 'materials' | 'haul'; sequence: number }
  /** Opens the drainage check (streams, ponds, catchments) beside the culvert inputs. */
  onShowDrainage?: () => void
}) {
  // The sidebar is memoized: a click reads the station as it is now (see roadStation.tsx).
  const readStation = useStationReader(w)
  const [tab, setTab] = useState<'templates' | 'materials' | 'culverts' | 'haul'>('templates')
  // The sidebar closes the aggregate view itself when it makes either request: calling its setter
  // here, during this component's render, is a React error.
  const [seenInputsRequest, setSeenInputsRequest] = useState(inputsRequest?.sequence)
  if (inputsRequest?.sequence !== seenInputsRequest) {
    setSeenInputsRequest(inputsRequest?.sequence)
    if (inputsRequest) setTab(inputsRequest.tab)
  }
  const [seenCulvertRequest, setSeenCulvertRequest] = useState(culvertRequest)
  if (culvertRequest !== seenCulvertRequest) {
    setSeenCulvertRequest(culvertRequest)
    if (culvertRequest) setTab('culverts')
  }
  const [haulOpen, setHaulOpen] = useState(false)
  // Which invert a typed culvert fall keeps; the other one follows.
  const [fallHolds, setFallHolds] = useState<Record<string, 'inlet' | 'outlet'>>({})
  const activeTab = aggregateOpen ? 'haul' : tab
  const changeHaulOpen = (open: boolean) => {
    setHaulOpen(open)
    onAggregateOpenChange?.(open)
    setTab('haul')
  }
  const [templateId, setTemplateId] = useState('')
  const [seenTemplateRequest, setSeenTemplateRequest] = useState(templateRequest?.sequence)
  if (templateRequest && templateRequest.sequence !== seenTemplateRequest) {
    setSeenTemplateRequest(templateRequest.sequence)
    setTab('templates')
    setTemplateId(templateRequest.id)
  }
  const [preset, setPreset] = useState<TemplateStarter | 'rockfill'>('current')
  const [libraryMode, setLibraryMode] = useState<'merge' | 'replace'>('merge')
  const libraryInput = useRef<HTMLInputElement>(null)
  const { alignment, analysis, project } = w
  const design = alignment.engineering ?? createEngineeringDesign()
  // An invalid edit keeps the last valid results; its message goes beside the entry that caused it.
  const problem = analysis.invalidInput
  const errorsFor = (list: EngineeringInputList, id?: string) => (field: string) =>
    inputMessage(problem, list, id, field)
  const replacedHorizons = horizonReplacements(design.strata)
  // The pipe roughness the drainage run uses, so the capacity shown here is the one it will check.
  const manningN = project.drainage?.settings?.manningN ?? DEFAULT_DRAINAGE_SETTINGS.manningN
  const constrainedAllocation = !!(
    design.fillRequirements?.length ||
    design.haul.directionRanges?.length ||
    design.haul.sidecastRanges?.length ||
    analysis.engineering?.materialLayerVolumeM3 ||
    analysis.engineering?.movements.some(
      (m) => m.kind === 'cut-to-fill' && m.demandLayer && m.demandLayer !== 'subgrade',
    )
  )
  const aggregate = surfacingSupplyCost(
    analysis.surfaceVolumeM3,
    project.settings.surfacingRate,
    design.surfacingSupply,
  )
  const selected = design.templates.find((t) => t.id === templateId) ?? design.templates[0]
  const [templateCandidate, setTemplateCandidate] = useState<TemplateCandidate>(() => ({
    alignmentId: alignment.id,
    templateId: selected?.id,
    saved: selected?.template,
    source: w.source,
    value: selected ? { ...selected.template } : undefined,
    epoch: 0,
  }))
  const candidateCurrent =
    templateCandidate.alignmentId === alignment.id &&
    templateCandidate.templateId === selected?.id &&
    templateCandidate.saved === selected?.template &&
    templateCandidate.source === w.source
  // Reset before children render so a restored/changed template or terrain can
  // never display or commit a candidate from the previous editing context.
  if (!candidateCurrent) {
    setTemplateCandidate({
      alignmentId: alignment.id,
      templateId: selected?.id,
      saved: selected?.template,
      source: w.source,
      value: selected ? { ...selected.template } : undefined,
      epoch: templateCandidate.epoch + 1,
    })
  }
  const candidate = candidateCurrent ? templateCandidate.value : selected?.template
  const templateDirty =
    !!selected &&
    !!candidate &&
    ([...templateFields, ...sideFields].some(({ key }) => candidate[key] !== selected.template[key]) ||
      JSON.stringify(candidate.components) !== JSON.stringify(selected.template.components) ||
      JSON.stringify(candidate.layers) !== JSON.stringify(selected.template.layers) ||
      JSON.stringify(candidate.rockCut) !== JSON.stringify(selected.template.rockCut))
  const edit = (change: (e: AlignmentEngineering) => AlignmentEngineering) =>
    w.updateAlignment((a) => ({ ...a, engineering: change(a.engineering ?? createEngineeringDesign()) }))
  const patch = <K extends 'assignments' | 'materials' | 'strata' | 'culverts' | 'sites'>(
    key: K,
    id: string,
    changes: Partial<AlignmentEngineering[K][number]>,
  ) => edit((e) => ({ ...e, [key]: e[key].map((x) => (x.id === id ? { ...x, ...changes } : x)) }))
  const remove = (key: 'assignments' | 'materials' | 'strata' | 'culverts' | 'sites', id: string) => {
    if (key !== 'materials') {
      edit((e) => ({ ...e, [key]: e[key].filter((x) => x.id !== id) }))
      return
    }
    const usesMaterial = (t: RoadTemplate) =>
      !!(
        t.layers?.some((layer) => layer.materialId === id) ||
        t.components?.some((component) => component.materialId === id)
      )
    const e = design
    const referenced =
      e.strata.some((s) => s.materialId === id) ||
      e.sitePreparation?.some((s) => s.materialId === id || s.removeToMaterialId === id) ||
      e.fillRequirements?.some((r) => r.materialId === id) ||
      e.sites.some((site) => site.materialId === id) ||
      e.haul.sidecastRanges?.some((range) => range.materialIds?.includes(id)) ||
      project.totalCostPlanning?.sources.some((source) => source.materialIds?.includes(id)) ||
      usesMaterial(alignment.template) ||
      e.templates.some((definition) => usesMaterial(definition.template))
    if (referenced) {
      w.setError(
        'This material is referenced by a section, horizon, preparation, fill requirement, site, quoted source or sidecast rule. Reassign or remove those references before deleting the material. No work was changed.',
      )
      return
    }
    edit((value) => ({ ...value, materials: value.materials.filter((material) => material.id !== id) }))
    w.setError('')
  }
  const updateTemplate = (changes: Partial<RoadTemplate>) => {
    if (!selected || !candidate) return
    const next = { ...candidate, ...changes }
    setTemplateCandidate((previous) => ({
      ...previous,
      value: next,
    }))
    if (previewActive) {
      try {
        validateTemplate(next)
        onPreviewTemplate(next, `${selected.name} · unsaved candidate`)
      } catch {
        // Keep the last valid preview while an interdependent width/depth edit is incomplete.
      }
    }
  }
  const saveTemplate = () => {
    if (!selected || !candidate) return
    try {
      validateTemplate(candidate)
      edit((e) => ({
        ...e,
        templates: e.templates.map((t) => (t.id === selected.id ? { ...t, template: { ...candidate } } : t)),
      }))
      onClosePreview?.()
      w.setError('')
      w.setNotice(`Saved ${selected.name}. Assigned road sections now use these parameters.`)
    } catch (error) {
      w.setError(error instanceof Error ? error.message : 'Could not save template.')
    }
  }
  const discardTemplate = () => {
    if (!selected) return
    setTemplateCandidate((previous) => ({
      ...previous,
      value: { ...selected.template },
      epoch: previous.epoch + 1,
    }))
    onClosePreview?.()
  }
  const newCulvert = (
    chainage = readStation(),
    name = `Culvert ${design.culverts.length + 1}`,
    sourceFeatureId?: string,
  ) => {
    const station = nearestStation(analysis.stations, chainage)
    const culvert: Culvert = {
      id: uid(),
      name,
      kind: sourceFeatureId ? 'stream' : 'cross-drain',
      ...(sourceFeatureId ? { sourceFeatureId } : {}),
      chainage,
      skewDegrees: 0,
      lengthM: Math.max(12, (station?.leftWidth ?? 3) + (station?.rightWidth ?? 3) + 4),
      diameterM: 0.8,
      inletInvertM: null,
      outletInvertM: null,
      minCoverM: 0.6,
      unitCost: 0,
      fixedCost: 0,
    }
    edit((e) => ({ ...e, culverts: [...e.culverts, culvert] }))
    w.setStation(chainage)
  }
  return (
    <div data-testid="road-engineering-controls">
      <div className="space-y-2 border-b p-3">
        <TabBar
          label="Engineering inputs"
          value={activeTab}
          onChange={setTab}
          stretch
          className="grid grid-cols-2"
          options={[
            { value: 'templates', label: 'Templates' },
            { value: 'materials', label: 'Ground' },
            { value: 'culverts', label: 'Drainage' },
            { value: 'haul', label: 'Haul' },
          ]}
        />
        <Button size="sm" variant="ghost" className="h-7 w-full justify-between px-2 text-xs" onClick={onQuantities}>
          Show quantities & cost breakdown
          <ArrowRight className="size-3" />
        </Button>
        {problem && (
          <div data-testid="road-engineering-problem">
            <InlineAlert
              tone="error"
              title={analysis.stations.length ? 'Left out of the results' : 'Not calculated yet'}
            >
              {invalidInputMessages(problem).join(' ')}
              {analysis.stations.length > 0 &&
                (problem.leftOut === 'all'
                  ? ' The results leave out every section and engineering edit made since the inputs were last valid.'
                  : ' The results use the last valid value; every other edit is included.')}
            </InlineAlert>
          </div>
        )}
        {/* Culverts are entered here; the hydrology that sizes and places them is a view of its own. */}
        {activeTab === 'culverts' && onShowDrainage && (
          <Button
            size="sm"
            variant="ghost"
            className="h-auto min-h-7 w-full justify-between whitespace-normal px-2 text-left text-xs"
            data-testid="road-open-drainage-check"
            onClick={onShowDrainage}
          >
            Drainage check: streams, ponds, catchments
            <ArrowRight className="size-3 shrink-0" />
          </Button>
        )}
      </div>
      {activeTab === 'templates' && (
        <>
          <RoadSection
            title="Named template library"
            help="Road, landing and asymmetric sections can be reused by station range. Presets are editable starting dimensions. Optional side values override the symmetric section. Positive crossfall falls away from the crown; negative rises."
          >
            <input
              ref={libraryInput}
              data-testid="road-library-input"
              className="hidden"
              type="file"
              accept=".json"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                try {
                  if (file.size > 2000000) throw Error('Template libraries must be at most 2 MB.')
                  const text = await file.text()
                  w.update((current) => {
                    if (!current.alignments.some((a) => a.id === alignment.id))
                      throw Error('The road receiving this library is no longer open.')
                    return {
                      ...current,
                      alignments: current.alignments.map((a) =>
                        a.id === alignment.id
                          ? importRoadLibrary(a, text, libraryMode, {
                              retainedMaterialIds: current.totalCostPlanning?.sources.flatMap(
                                (source) => source.materialIds ?? [],
                              ),
                            })
                          : a,
                      ),
                    }
                  })
                  onClosePreview?.()
                  w.setError('')
                  w.setNotice(
                    libraryMode === 'merge'
                      ? 'Merged template and material definitions; existing assignments retained.'
                      : 'Replaced library and cleared template/material assignments. Undo restores the previous library.',
                  )
                } catch (error) {
                  w.setError(error instanceof Error ? error.message : 'Could not import library.')
                }
                e.target.value = ''
              }}
            />
            <div className="mb-2 flex gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  try {
                    downloadText(serializeRoadLibrary(alignment), 'road-template-library.json', 'application/json')
                  } catch (error) {
                    w.setError(error instanceof Error ? error.message : 'Could not export library.')
                  }
                }}
              >
                Export library
              </Button>
              <Button size="sm" variant="outline" onClick={() => libraryInput.current?.click()}>
                Import library
              </Button>
            </div>
            <Field label="Library import mode">
              <RoadSelect
                ariaLabel="Library import mode"
                className={roadFieldClass}
                value={libraryMode}
                onValueChange={(value) => setLibraryMode(value as typeof libraryMode)}
              >
                <option value="merge">Merge definitions</option>
                <option value="replace">Replace library & clear assignments</option>
              </RoadSelect>
            </Field>
            <Field label="Template starting point">
              <RoadSelect
                ariaLabel="Template starting point"
                className={roadFieldClass}
                value={preset}
                onValueChange={(value) => setPreset(value as typeof preset)}
              >
                <option value="current">Current road section</option>
                <option value="single">Forest single lane</option>
                <option value="double">Forest double lane</option>
                <option value="landing">Wide landing</option>
                <option value="urban">Crowned road</option>
                <option value="rockfill">Keyed rock fill</option>
              </RoadSelect>
            </Field>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 w-full"
              disabled={design.templates.length >= 50}
              onClick={() => {
                const names: Record<typeof preset, string> = {
                  current: 'Road section',
                  single: 'Forest single lane',
                  double: 'Forest double lane',
                  landing: 'Wide landing',
                  urban: 'Crowned road',
                  rockfill: 'Keyed rock fill',
                }
                let template: RoadTemplate
                try {
                  // A rock fill keeps the road's section and adds a key under each fill-side toe.
                  template =
                    preset === 'rockfill'
                      ? keyedRockFillTemplate(alignment.template, uid)
                      : templateFromStarter(alignment.template, preset)
                } catch (error) {
                  w.setError(error instanceof Error ? error.message : 'Could not create template.')
                  return
                }
                const id = uid()
                edit((e) => ({
                  ...e,
                  templates: [...e.templates, { id, name: `${names[preset]} ${e.templates.length + 1}`, template }],
                }))
                setTemplateId(id)
                onClosePreview?.()
              }}
            >
              <Plus className="mr-1 size-3" />
              Add named template
            </Button>
            {selected && candidate && (
              <div key={`${alignment.id}-${selected.id}-${templateCandidate.epoch}`} className="mt-3 space-y-2">
                <Field label="Library template">
                  <RoadSelect
                    ariaLabel="Library template"
                    className={roadFieldClass}
                    value={selected.id}
                    onValueChange={(value) => {
                      setTemplateId(value)
                      onClosePreview?.()
                    }}
                  >
                    {design.templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </RoadSelect>
                </Field>
                <Name
                  value={selected.name}
                  label="Template name"
                  onChange={(name) =>
                    edit((e) => ({
                      ...e,
                      templates: e.templates.map((t) => (t.id === selected.id ? { ...t, name } : t)),
                    }))
                  }
                  onDelete={() => {
                    const dependent = design.assignments.filter((a) => a.templateId === selected.id).length
                    if (dependent) {
                      w.setError(
                        `Reassign or remove ${dependent} template assignment${dependent === 1 ? '' : 's'} first. No work was changed.`,
                      )
                      return
                    }
                    const removedIds = new Set(
                      [...(selected.template.components ?? []), ...(selected.template.layers ?? [])].map((c) => c.id),
                    )
                    const availableIds = new Set(
                      [
                        ...(alignment.template.components ?? []),
                        ...(alignment.template.layers ?? []),
                        ...design.templates
                          .filter((t) => t.id !== selected.id)
                          .flatMap((t) => [...(t.template.components ?? []), ...(t.template.layers ?? [])]),
                      ].map((c) => c.id),
                    )
                    const requirements =
                      design.fillRequirements?.filter((r) => removedIds.has(r.layer) && !availableIds.has(r.layer))
                        .length ?? 0
                    if (requirements) {
                      w.setError(
                        `Reassign or remove ${requirements} fill requirement${requirements === 1 ? '' : 's'} first. This template supplies its demand-layer definition. No work was changed.`,
                      )
                      return
                    }
                    edit((e) => ({
                      ...e,
                      templates: e.templates.filter((t) => t.id !== selected.id),
                    }))
                    onClosePreview?.()
                  }}
                />
                <p
                  className={`text-2xs leading-4 ${templateDirty ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}
                  data-testid="template-candidate-status"
                  role="status"
                >
                  {templateDirty
                    ? 'Unsaved template changes. Preview the candidate, then save to update assigned road sections and library exports.'
                    : 'Saved template parameters. Edits can be previewed before saving.'}
                </p>
                <Fields
                  value={candidate}
                  fields={templateFields.map((field) => ({ ...field, ...ditchWidthRange(candidate, field.key) }))}
                  onChange={updateTemplate}
                />
                <SectionAssemblyEditor
                  template={candidate}
                  materials={design.materials}
                  features={project.context}
                  surfaces={project.terrain.referenceSurfaces}
                  onChange={(value) => updateTemplate(value)}
                />
                <details className="rounded border p-2">
                  <summary className="cursor-pointer text-xs">Rock cut · {rockCutSummary(candidate)}</summary>
                  <div className="pt-2">
                    <RockCutFields
                      template={candidate}
                      list="templates"
                      id={selected.id}
                      problem={problem}
                      onChange={(rockCut) => updateTemplate({ rockCut })}
                    />
                  </div>
                </details>
                <details className="rounded border p-2">
                  <summary className="cursor-pointer text-xs">Independent left / right components</summary>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1 pt-2">
                      {(['left', 'right'] as const).map((from) => (
                        <Button
                          key={from}
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const copy = copyTemplateSide(candidate, from, uid)
                            // Keys the copy removed must be passed as undefined to clear them.
                            updateTemplate({
                              ...Object.fromEntries(sideFields.map((field) => [field.key, copy[field.key]])),
                              leftWidth: copy.leftWidth,
                              rightWidth: copy.rightWidth,
                              components: copy.components,
                              layers: copy.layers,
                            })
                          }}
                        >
                          Copy {from} side to {from === 'left' ? 'right' : 'left'}
                        </Button>
                      ))}
                    </div>
                    {sideFields.map((field) => (
                      <div key={String(field.key)} className="flex items-end gap-1">
                        <div className="min-w-0 flex-1">
                          <NumberField
                            label={field.label}
                            min={field.min}
                            max={field.max}
                            step={field.step}
                            hint={field.hint}
                            {...ditchWidthRange(candidate, field.key)}
                            value={
                              (candidate[field.key] ??
                                candidate[
                                  field.key
                                    .replace(/^(left|right)/, '')
                                    .replace(/^./, (c) => c.toLowerCase()) as keyof RoadTemplate
                                ] ??
                                0) as number
                            }
                            onChange={(value) => updateTemplate({ [field.key]: value })}
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8"
                          disabled={candidate[field.key] === undefined}
                          onClick={() => updateTemplate({ [field.key]: undefined })}
                        >
                          Inherit
                        </Button>
                      </div>
                    ))}
                  </div>
                </details>
                <div className="grid grid-cols-2 gap-1">
                  <Button size="sm" disabled={!templateDirty} onClick={saveTemplate}>
                    Save template
                  </Button>
                  <Button size="sm" variant="outline" disabled={!templateDirty} onClick={discardTemplate}>
                    Discard changes
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onPreviewTemplate(candidate, `${selected.name}${templateDirty ? ' · unsaved candidate' : ''}`)
                    }
                  >
                    Preview at station
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={design.templates.length >= 50}
                    title="Create a saved copy of the current candidate"
                    onClick={() => {
                      try {
                        validateTemplate(candidate)
                        const id = uid(),
                          name = `${selected.name} copy`
                        edit((e) => ({
                          ...e,
                          templates: [...e.templates, { id, name, template: { ...candidate } }],
                        }))
                        setTemplateId(id)
                        onClosePreview?.()
                        w.setError('')
                        w.setNotice(`Created ${name} from the current template candidate.`)
                      } catch (error) {
                        w.setError(error instanceof Error ? error.message : 'Could not duplicate template.')
                      }
                    }}
                  >
                    <Copy className="mr-1 size-3" />
                    Duplicate
                  </Button>
                </div>
                <TemplateSandbox
                  template={candidate}
                  materials={design.materials}
                  name={`${selected.name}${templateDirty ? ' · unsaved candidate' : ''}`}
                />
              </div>
            )}
          </RoadSection>
          <RoadSection
            title="Template station assignments"
            help="Ranges on the same side must not overlap. Transitions blend from the base section within each end of the range. Landings/turnouts remain additional width overrides."
          >
            <StationValue workspace={w}>
              {(station) => {
                // A new range takes road that no assignment covers yet, from the selected station where that is free.
                const assignmentRange = freeStationRange(design.assignments, analysis.length, station, 100)
                return (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!selected || templateDirty || design.assignments.length >= 200 || !assignmentRange}
                      onClick={() =>
                        selected &&
                        assignmentRange &&
                        edit((e) => ({
                          ...e,
                          assignments: [
                            ...e.assignments,
                            { id: uid(), ...assignmentRange, templateId: selected.id, side: 'both', transitionM: 0 },
                          ],
                        }))
                      }
                    >
                      Assign selected template
                    </Button>
                    {selected && !templateDirty && !assignmentRange && (
                      <p className="mt-2 text-2xs text-muted-foreground">
                        Every station already has a template range. Shorten one, or change its side, to add another.
                      </p>
                    )}
                  </>
                )
              }}
            </StationValue>
            {templateDirty && (
              <p className="mt-2 text-2xs text-muted-foreground">
                Save or discard template changes before adding a station assignment.
              </p>
            )}
            {design.assignments.map((a, index) => (
              <div key={a.id} className="mt-2 space-y-2 rounded border p-2">
                <div className="flex items-center justify-between">
                  <button
                    className="text-xs underline"
                    onClick={() => {
                      w.setFeatureSelection({ alignmentId: alignment.id, kind: 'assignment', id: a.id })
                      w.setStation((a.start + a.end) / 2)
                    }}
                  >
                    Range {index + 1} · {formatRoadStation(a.start)}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={`Remove template assignment ${index + 1}`}
                    onClick={() => remove('assignments', a.id)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
                <Field label={`Assignment ${index + 1} template`}>
                  <RoadSelect
                    ariaLabel={`Assignment ${index + 1} template`}
                    className={roadFieldClass}
                    value={a.templateId}
                    onValueChange={(value) => patch('assignments', a.id, { templateId: value })}
                  >
                    {design.templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </RoadSelect>
                </Field>
                <Field label={`Assignment ${index + 1} side`}>
                  <RoadSelect
                    ariaLabel={`Assignment ${index + 1} side`}
                    className={roadFieldClass}
                    value={a.side}
                    onValueChange={(value) => patch('assignments', a.id, { side: value as TemplateAssignment['side'] })}
                  >
                    {['both', 'left', 'right'].map((side) => (
                      <option key={side}>{side}</option>
                    ))}
                  </RoadSelect>
                </Field>
                <Fields<TemplateAssignment>
                  value={a}
                  fields={[
                    { key: 'start', label: `Assignment ${index + 1} start (m)` },
                    { key: 'end', label: `Assignment ${index + 1} end (m)` },
                    { key: 'transitionM', label: `Assignment ${index + 1} transition (m)`, max: 1000 },
                  ]}
                  errorFor={errorsFor('assignments', a.id)}
                  onChange={(p) => patch('assignments', a.id, p)}
                />
                <EntryProblem
                  problem={problem}
                  list="assignments"
                  id={a.id}
                  inlineFields={['start', 'end', 'transitionM']}
                />
              </div>
            ))}
          </RoadSection>
        </>
      )}
      {activeTab === 'materials' && (
        <>
          <RoadSection
            title="Ground material definitions"
            help="Enter measured or assumed ground layers. Terrain elevations alone do not identify soil or rock. Unassigned excavation stays explicitly unclassified."
          >
            <Button
              size="sm"
              variant="outline"
              disabled={design.materials.length >= 32}
              onClick={() =>
                edit((e) => ({
                  ...e,
                  materials: [
                    ...e.materials,
                    {
                      id: uid(),
                      name: `Material ${e.materials.length + 1}`,
                      color: ['#a16207', '#6b7280', '#d97706', '#7c3aed'][e.materials.length % 4],
                      cutRate: project.settings.cutRate,
                      reusableFraction: 1,
                      compactionFactor: project.settings.shrinkFactor,
                      purpose: 'earthwork',
                    },
                  ],
                }))
              }
            >
              Add ground material
            </Button>
            {design.materials.map((m) => (
              <div key={m.id} className="mt-2 space-y-2 rounded border p-2">
                <Name
                  value={m.name}
                  label="Ground material name"
                  onChange={(name) => patch('materials', m.id, { name })}
                  onDelete={() => remove('materials', m.id)}
                />
                <div className="flex gap-2">
                  <Field label="Material color">
                    <input
                      aria-label={`${m.name} color`}
                      type="color"
                      value={m.color}
                      onChange={(e) => patch('materials', m.id, { color: e.target.value })}
                    />
                  </Field>
                  <Field label="Excavated material type">
                    <RoadSelect
                      ariaLabel="Excavated material type"
                      className={roadFieldClass}
                      value={m.rock ? 'rock' : (m.purpose ?? 'earthwork')}
                      onValueChange={(value) =>
                        patch('materials', m.id, {
                          purpose: value === 'stripping' ? 'stripping' : 'earthwork',
                          rock: value === 'rock' ? true : undefined,
                          ...(value === 'stripping' ? { reusableFraction: 0 } : {}),
                        })
                      }
                    >
                      <option value="earthwork">Earthwork</option>
                      <option value="rock">Rock</option>
                      <option value="stripping">Excavated stripping</option>
                    </RoadSelect>
                  </Field>
                </div>
                <Fields<GroundMaterial>
                  value={m}
                  fields={[
                    { key: 'cutRate', label: `${m.name} excavation ($/bank m³)`, max: 10000 },
                    {
                      key: 'reusableFraction',
                      label: `${m.name} reusable fraction`,
                      max: m.purpose === 'stripping' ? 0 : 1,
                      step: 0.05,
                    },
                  ]}
                  errorFor={errorsFor('materials', m.id)}
                  onChange={(p) => patch('materials', m.id, p)}
                />
                <EntryProblem
                  problem={problem}
                  list="materials"
                  id={m.id}
                  inlineFields={['cutRate', 'reusableFraction']}
                />
                <MaterialFactorEditor material={m} onChange={(p) => patch('materials', m.id, p)} />
                <div className="grid grid-cols-2 gap-2">
                  <OptionalNumberField
                    label={`${m.name} quality (0–100)`}
                    value={m.quality ?? null}
                    min={0}
                    max={100}
                    placeholder="unknown"
                    hint="A quality class you define, from 0 (poorest) to 100 (best), so a fill requirement can ask for a minimum. Number your own classes in order, for example 20, 40, 60 and 80 for four classes."
                    description={
                      m.quality === undefined ? 'Blank is unknown: it cannot meet a quality rule.' : undefined
                    }
                    onChange={(quality) => patch('materials', m.id, { quality: quality ?? undefined })}
                  />
                  <OptionalNumberField
                    label={`${m.name} cut batter (H:V)`}
                    value={m.cutSlope ?? null}
                    min={0.1}
                    max={10}
                    placeholder="template slope"
                    onChange={(cutSlope) => patch('materials', m.id, { cutSlope: cutSlope ?? undefined })}
                  />
                  <OptionalNumberField
                    label={`${m.name} fill batter (H:V)`}
                    value={m.fillSlope ?? null}
                    min={0.1}
                    max={10}
                    placeholder="template slope"
                    onChange={(fillSlope) => patch('materials', m.id, { fillSlope: fillSlope ?? undefined })}
                  />
                </div>
                {m.rock && (
                  <div className="grid grid-cols-2 gap-2" data-testid="road-rock-material-rates">
                    <OptionalNumberField
                      label={`${m.name} shallow rock ($/bank m³)`}
                      value={m.shallowCutRate ?? null}
                      min={0}
                      max={10000}
                      placeholder="excavation rate"
                      hint="Rock cut no thicker than the template's shallow depth, often ripped rather than drilled and blasted. Blank prices it at the excavation rate."
                      error={inputMessage(problem, 'materials', m.id, 'shallowCutRate')}
                      onChange={(value) => patch('materials', m.id, { shallowCutRate: value ?? undefined })}
                    />
                    <OptionalNumberField
                      label={`${m.name} overbreak ($/bank m³)`}
                      value={m.overbreakRate ?? null}
                      min={0}
                      max={10000}
                      placeholder="excavation rate"
                      hint="Rock blasted below the subgrade to the template's blasting level and refilled in place. Blank prices it at the excavation rate."
                      error={inputMessage(problem, 'materials', m.id, 'overbreakRate')}
                      onChange={(value) => patch('materials', m.id, { overbreakRate: value ?? undefined })}
                    />
                  </div>
                )}
                {m.purpose !== 'stripping' && (
                  <p className="text-2xs text-muted-foreground" data-testid="road-material-placement-rate">
                    Placed as fill at ${project.settings.fillRate.toFixed(2)}/m³, the one fill placement rate for every
                    material. Edit it in the cost breakdown.
                  </p>
                )}
              </div>
            ))}
          </RoadSection>
          <StationValue workspace={w}>
            {(station) => (
              <SitePreparationEditor
                design={design}
                length={analysis.length}
                station={station}
                problem={problem}
                onChange={(value) => edit(() => value)}
              />
            )}
          </StationValue>
          <RoadSection
            title="Station ranges & ground horizons"
            help="Depths are vertical below original ground. Where two horizons overlap in station and depth, the later one in this list replaces the earlier, so a whole-road layer can be entered first and a local one after it. Excavated stripping is reported separately and never reused. Use pre-construction stripping to remove ground beneath fills."
          >
            <Button
              size="sm"
              variant="outline"
              disabled={!design.materials.length || design.strata.length >= 200}
              onClick={() =>
                edit((e) => ({
                  ...e,
                  strata: [
                    ...e.strata,
                    nextHorizon(e.strata, analysis.length, e.materials[e.materials.length - 1].id, uid()),
                  ],
                }))
              }
            >
              Add material horizon
            </Button>
            {design.strata.map((s, index) => (
              <div key={s.id} className="mt-2 space-y-2 rounded border p-2">
                <div className="flex items-center justify-between">
                  <button
                    className="text-xs underline"
                    onClick={() => {
                      w.setFeatureSelection({ alignmentId: alignment.id, kind: 'stratum', id: s.id })
                      w.setStation((s.start + s.end) / 2)
                    }}
                  >
                    Horizon {index + 1}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={`Remove horizon ${index + 1}`}
                    onClick={() => remove('strata', s.id)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
                <Field label={`Horizon ${index + 1} material`}>
                  <RoadSelect
                    ariaLabel={`Horizon ${index + 1} material`}
                    className={roadFieldClass}
                    value={s.materialId}
                    onValueChange={(value) => patch('strata', s.id, { materialId: value })}
                  >
                    {design.materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </RoadSelect>
                </Field>
                <Fields<StratumAssignment>
                  value={s}
                  fields={[
                    { key: 'start', label: `Horizon ${index + 1} start (m)` },
                    { key: 'end', label: `Horizon ${index + 1} end (m)` },
                    { key: 'topDepthM', label: `Horizon ${index + 1} top depth (m)`, max: MAX_HORIZON_DEPTH_M },
                    ...(s.bottomDepthM === null
                      ? []
                      : [
                          {
                            key: 'bottomDepthM' as const,
                            label: `Horizon ${index + 1} bottom depth (m)`,
                            max: MAX_HORIZON_DEPTH_M,
                          },
                        ]),
                  ]}
                  errorFor={errorsFor('strata', s.id)}
                  onChange={(p) => patch('strata', s.id, p)}
                />
                <EntryProblem
                  problem={problem}
                  list="strata"
                  id={s.id}
                  inlineFields={['start', 'end', 'topDepthM', ...(s.bottomDepthM === null ? [] : ['bottomDepthM'])]}
                />
                {replacedHorizons.has(s.id) && (
                  <p className="text-2xs text-muted-foreground" data-testid="road-horizon-replaces">
                    Replaces{' '}
                    {replacedHorizons
                      .get(s.id)!
                      .map((id) => `Horizon ${design.strata.findIndex((x) => x.id === id) + 1}`)
                      .join(', ')}{' '}
                    where they overlap.
                  </p>
                )}
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={s.bottomDepthM === null}
                    onChange={(e) => patch('strata', s.id, { bottomDepthM: e.target.checked ? null : s.topDepthM + 1 })}
                  />
                  Extends below all finite horizons
                </label>
              </div>
            ))}
          </RoadSection>
        </>
      )}
      {activeTab === 'culverts' && (
        <RoadSection
          title="Culvert inventory & geometry"
          help="Place structures by road station. Skew, dimensions and entered inverts drive plan geometry, cover checks and installed cost. Invert initialization is a draft at the requested centre cover, not a survey. Dimensions and cover do not establish hydraulic capacity or fish passage."
        >
          <Button size="sm" variant="outline" disabled={design.culverts.length >= 100} onClick={() => newCulvert()}>
            Add culvert at station
          </Button>
          <div className="my-2 space-y-1">
            {crossingsWithoutStructure(analysis, design).map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant="ghost"
                className="h-auto w-full justify-start whitespace-normal text-left"
                disabled={design.culverts.length >= 100}
                onClick={() => newCulvert(c.chainage, c.name, c.featureId)}
              >
                Add culvert at {c.name} · {formatRoadStation(c.chainage)}
              </Button>
            ))}
          </div>
          {design.culverts.map((c, index) => {
            const result = analysis.engineering?.culverts.find((x) => x.id === c.id)
            return (
              <div key={c.id} className="mt-3 space-y-2 rounded border p-2">
                <Name
                  value={c.name}
                  label={`Culvert ${index + 1} name`}
                  onChange={(name) => patch('culverts', c.id, { name })}
                  onDelete={() => remove('culverts', c.id)}
                />
                <Button size="sm" variant="ghost" onClick={() => w.setStation(c.chainage)}>
                  Select {formatRoadStation(c.chainage)} in all views
                </Button>
                <Field label="Culvert purpose">
                  <RoadSelect
                    ariaLabel="Culvert purpose"
                    className={roadFieldClass}
                    value={c.kind ?? 'cross-drain'}
                    onValueChange={(value) => patch('culverts', c.id, { kind: value as Culvert['kind'] })}
                  >
                    <option value="cross-drain">Road cross-drain</option>
                    <option value="stream">Natural stream</option>
                  </RoadSelect>
                </Field>
                <Fields<Culvert>
                  value={c}
                  fields={[
                    { key: 'chainage', label: `Culvert ${index + 1} station (m)` },
                    {
                      key: 'skewDegrees',
                      label: `Culvert ${index + 1} skew from square (°)`,
                      min: -80,
                      max: 80,
                      hint: 'Skew is measured from square to the road: 0° crosses square, and a pipe 75° from the centreline is 15° here. Positive turns the right-hand (outlet) end toward lower stations, negative toward higher ones.',
                    },
                    { key: 'lengthM', label: `Culvert ${index + 1} horizontal barrel span (m)`, min: 0.2, max: 500 },
                    { key: 'diameterM', label: `Culvert ${index + 1} diameter (m)`, min: 0.1, max: 20 },
                    { key: 'minCoverM', label: `Culvert ${index + 1} required cover (m)`, max: 100 },
                    { key: 'unitCost', label: `Culvert ${index + 1} installed $/m`, max: 1000000 },
                    { key: 'fixedCost', label: `Culvert ${index + 1} fixed cost ($)`, max: 1e9 },
                  ]}
                  errorFor={errorsFor('culverts', c.id)}
                  onChange={(p) => patch('culverts', c.id, p)}
                />
                <EntryProblem
                  problem={problem}
                  list="culverts"
                  id={c.id}
                  inlineFields={[
                    'chainage',
                    'skewDegrees',
                    'lengthM',
                    'diameterM',
                    'minCoverM',
                    'unitCost',
                    'fixedCost',
                  ]}
                />
                <OptionalNumberField
                  label={`Culvert ${index + 1} ditch dip to inlet (%)`}
                  placeholder="no dip"
                  value={c.ditchDipPercent ?? null}
                  min={0.1}
                  max={50}
                  onChange={(dip) =>
                    edit((e) => ({
                      ...e,
                      culverts: e.culverts.map((x) => {
                        if (x.id !== c.id) return x
                        const { ditchDipPercent: _old, ...rest } = x
                        void _old
                        return dip === null ? rest : { ...rest, ditchDipPercent: dip }
                      }),
                    }))
                  }
                />
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={c.inletInvertM !== null && c.outletInvertM !== null}
                    onChange={(e) => {
                      const station = nearestStation(analysis.stations, c.chainage)
                      const level = station?.designElevation
                      patch('culverts', c.id, {
                        inletInvertM:
                          e.target.checked && level !== null && level !== undefined
                            ? level - c.diameterM - c.minCoverM
                            : null,
                        outletInvertM:
                          e.target.checked && level !== null && level !== undefined
                            ? level - c.diameterM - c.minCoverM
                            : null,
                      })
                    }}
                  />
                  Enter provisional inverts
                </label>
                {c.inletInvertM !== null && c.outletInvertM !== null && (
                  <>
                    <Fields<Culvert>
                      value={c}
                      fields={[
                        {
                          key: 'inletInvertM',
                          label: `Culvert ${index + 1} left inlet invert (m)`,
                          min: -12000,
                          max: 12000,
                        },
                        {
                          key: 'outletInvertM',
                          label: `Culvert ${index + 1} right outlet invert (m)`,
                          min: -12000,
                          max: 12000,
                        },
                      ]}
                      errorFor={errorsFor('culverts', c.id)}
                      onChange={(p) => patch('culverts', c.id, p)}
                    />
                    {/* The same two inverts, entered as a gradient: one end is held and the other follows. */}
                    <div className="grid grid-cols-2 gap-2">
                      <NumberField
                        label={`Culvert ${index + 1} fall, inlet to outlet (%)`}
                        value={Number((culvertFallPercent(c) ?? 0).toFixed(3))}
                        min={-50}
                        max={50}
                        step={0.5}
                        hint="The pipe gradient over its horizontal span. Entering it moves one invert and keeps the other; a positive fall puts the outlet below the inlet."
                        onChange={(fall) => {
                          const inverts = invertsForFall(c, fall, fallHolds[c.id] ?? 'inlet')
                          if (inverts) patch('culverts', c.id, inverts)
                        }}
                      />
                      <Field label={`Culvert ${index + 1} fall keeps`}>
                        <RoadSelect
                          ariaLabel={`Culvert ${index + 1} fall keeps`}
                          className={roadFieldClass}
                          value={fallHolds[c.id] ?? 'inlet'}
                          onValueChange={(value) =>
                            setFallHolds((previous) => ({ ...previous, [c.id]: value as 'inlet' | 'outlet' }))
                          }
                        >
                          <option value="inlet">Inlet invert, sets the outlet</option>
                          <option value="outlet">Outlet invert, sets the inlet</option>
                        </RoadSelect>
                      </Field>
                    </div>
                  </>
                )}
                <p className="text-2xs leading-4 text-muted-foreground" data-testid="road-culvert-capacity">
                  {(() => {
                    const pipe = culvertScreeningCapacity(c, manningN)
                    return `Full-pipe capacity ${pipe.capacityM3s.toFixed(3)} m³/s at ${(pipe.slope * 100).toFixed(2)} %${pipe.slopeAssumed ? ', assumed until the outlet is below the inlet' : ''} (Manning n ${manningN}). The peak flow it must carry needs a drainage run.`
                  })()}
                </p>
                {result && (
                  <p className="text-2xs leading-4">
                    Grade {result.gradePercent?.toFixed(2) ?? '—'}% · minimum formation cover{' '}
                    {result.coverM?.toFixed(2) ?? '—'} m · required span {result.requiredLengthM?.toFixed(1) ?? '—'} m
                    {' · '}inclined barrel {result.barrelLengthM?.toFixed(2) ?? 'unknown'} m
                    {result.warnings.map((warning) => (
                      <span key={warning} className="mt-1 block text-amber-700 dark:text-amber-400">
                        {warning}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            )
          })}
        </RoadSection>
      )}
      {activeTab === 'haul' && (
        <>
          <div className="p-3">
            <div className="space-y-1.5 rounded border bg-muted/20 p-2" data-testid="road-aggregate-summary">
              <p className="text-2xs text-muted-foreground">
                {design.surfacingSupply?.enabled ? (
                  <>
                    Aggregate: <span className="font-medium text-foreground">{design.surfacingSupply.name}</span> ·{' '}
                    {aggregate.suppliedM3.toFixed(1)} m³ at ${aggregate.rate.toFixed(2)}/m³ ·{' '}
                    {aggregate.fallbackM3.toFixed(1)} m³ at the base rate.
                  </>
                ) : (
                  <>Aggregate uses the base surfacing rate (${project.settings.surfacingRate.toFixed(2)}/m³).</>
                )}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setTab('haul')
                  setHaulOpen(true)
                }}
              >
                Aggregate source
              </Button>
            </div>
          </div>
          <div className="m-3 space-y-2 rounded-lg border p-3">
            <label className="mb-3 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={design.haul.enabled}
                onChange={(e) => {
                  edit((d) => ({ ...d, haul: { ...d.haul, enabled: e.target.checked } }))
                  if (e.target.checked) setHaulOpen(true)
                }}
              />
              Calculate material haul allocations
            </label>
            <Button variant="outline" size="sm" onClick={() => setHaulOpen(true)}>
              Haul & cost settings
            </Button>
            <p className="text-xs text-muted-foreground">
              {design.sites.length} borrow / waste sites ·{' '}
              {design.haul.enabled ? 'Allocations enabled' : 'Allocations disabled'}
            </p>
          </div>
          <RoadSettingsDialog
            title="Haul & cost settings"
            open={haulOpen || aggregateOpen}
            onOpenChange={changeHaulOpen}
            busy={!!w.busy}
          >
            <GravelSourcesPanel
              road={alignment.points.map((point) => point.coordinate)}
              source={design.surfacingSupply}
              volumeM3={analysis.surfaceVolumeM3}
              baseRate={project.settings.surfacingRate}
              onChange={(surfacingSupply) => edit((e) => ({ ...e, surfacingSupply }))}
            />
            <RoadSection
              title="Haul & cost assumptions"
              help="Nearest mode retains the original chainage-order scenario. Economic mode solves a bounded mixed-integer material flow including capacities and fixed site openings. Quality/direction/sidecast rules use economic mode. Haul follows chainage plus site access."
            >
              <ReferenceSelect
                label="Material allocation method"
                value={constrainedAllocation ? 'economic' : (design.haul.allocation ?? 'nearest')}
                options={[
                  ...(constrainedAllocation ? [] : [{ value: 'nearest', label: 'Nearest-source scenario' }]),
                  { value: 'economic', label: 'Economic material flow' },
                ]}
                onChange={(allocation) =>
                  edit((e) => ({ ...e, haul: { ...e.haul, allocation: allocation as HaulSettings['allocation'] } }))
                }
              />
              <ReferenceSelect
                label="Borrow / waste site selection"
                value={design.haul.siteSelection ?? 'nearest'}
                options={[
                  { value: 'nearest', label: 'Nearest source' },
                  { value: 'delivered-cost', label: 'Lowest delivered batch cost' },
                ]}
                onChange={(siteSelection) =>
                  edit((e) => ({
                    ...e,
                    haul: { ...e.haul, siteSelection: siteSelection as HaulSettings['siteSelection'] },
                  }))
                }
              />
              <Fields<HaulSettings>
                value={design.haul}
                fields={[
                  { key: 'freeHaulDistanceM', label: 'Free-haul distance (m)' },
                  { key: 'overhaulDistanceM', label: 'Overhaul distance limit (m)' },
                  { key: 'freeHaulRate', label: 'Free haul ($/m³·km)' },
                  { key: 'overhaulRate', label: 'Overhaul ($/m³·km)' },
                  { key: 'endHaulRate', label: 'End haul ($/m³·km)' },
                  { key: 'freeHaulLoadingRate', label: 'Free-haul loading ($/m³)' },
                  { key: 'overhaulLoadingRate', label: 'Overhaul loading ($/m³)' },
                  { key: 'endHaulLoadingRate', label: 'End-haul loading ($/m³)' },
                  { key: 'borrowRate', label: 'Default borrow ($/compacted m³)' },
                  { key: 'wasteRate', label: 'Default waste ($/bank m³)' },
                  { key: 'mobilizationCost', label: 'Mobilization ($)', max: 1e9 },
                  { key: 'contingencyPercent', label: 'Contingency (%)', max: 100 },
                ]}
                errorFor={errorsFor('haul')}
                onChange={(p) => edit((e) => ({ ...e, haul: { ...e.haul, ...p } }))}
              />
            </RoadSection>
            <RoadSection
              title="Borrow pits & waste sites"
              help="Limited sites leave any unallocated borrow or waste visible. Borrow uses compacted volume; waste uses bank volume. Site rates replace the matching default procurement/disposal rate."
            >
              <div className="flex gap-1">
                {(['borrow', 'waste'] as const).map((kind) => (
                  <Button
                    key={kind}
                    size="sm"
                    variant="outline"
                    disabled={design.sites.length >= 100}
                    onClick={() =>
                      edit((e) => ({
                        ...e,
                        sites: [
                          ...e.sites,
                          {
                            id: uid(),
                            name: `${kind === 'borrow' ? 'Borrow pit' : 'Waste site'} ${e.sites.length + 1}`,
                            kind,
                            chainage: readStation(),
                            accessDistanceM: 0,
                            capacityM3: null,
                            unitRate: kind === 'borrow' ? e.haul.borrowRate : e.haul.wasteRate,
                            fixedCost: 0,
                          },
                        ],
                      }))
                    }
                  >
                    + {kind === 'borrow' ? 'Borrow' : 'Waste'}
                  </Button>
                ))}
              </div>
              {design.sites.map((s, index) => (
                <div key={s.id} className="mt-2 space-y-2 rounded border p-2">
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={s.enabled !== false}
                      onChange={(event) => patch('sites', s.id, { enabled: event.target.checked })}
                    />
                    Include {s.name} in allocations
                  </label>
                  <Name
                    value={s.name}
                    label="Haul site name"
                    onChange={(name) => patch('sites', s.id, { name })}
                    onDelete={() => remove('sites', s.id)}
                  />
                  <button
                    className="text-xs underline"
                    onClick={() => {
                      w.setFeatureSelection({ alignmentId: alignment.id, kind: 'site', id: s.id })
                      w.setStation(s.chainage)
                      changeHaulOpen(false)
                    }}
                  >
                    {s.kind} · select {formatRoadStation(s.chainage)}
                  </button>
                  <Fields<HaulSite>
                    value={s}
                    fields={[
                      { key: 'chainage', label: `Site ${index + 1} station (m)` },
                      { key: 'accessDistanceM', label: `Site ${index + 1} access distance (m)`, max: 100000 },
                      {
                        key: 'unitRate',
                        label: `Site ${index + 1} unit rate ($/${s.kind === 'borrow' ? 'compacted' : 'bank'} m³)`,
                      },
                      { key: 'fixedCost', label: `Site ${index + 1} fixed cost ($)`, max: 1e9 },
                      ...(s.capacityM3 === null
                        ? []
                        : [
                            {
                              key: 'capacityM3' as const,
                              label: `Site ${index + 1} capacity (${s.kind === 'borrow' ? 'compacted' : 'bank'} m³)`,
                              max: 1e12,
                            },
                          ]),
                    ]}
                    errorFor={errorsFor('sites', s.id)}
                    onChange={(p) => patch('sites', s.id, p)}
                  />
                  <EntryProblem
                    problem={problem}
                    list="sites"
                    id={s.id}
                    inlineFields={[
                      'chainage',
                      'accessDistanceM',
                      'unitRate',
                      'fixedCost',
                      ...(s.capacityM3 === null ? [] : ['capacityM3']),
                    ]}
                  />
                  <Field label={`Site ${index + 1} material`}>
                    <RoadSelect
                      ariaLabel={`Site ${index + 1} material`}
                      className={roadFieldClass}
                      value={s.materialId ?? ''}
                      onValueChange={(value) => patch('sites', s.id, { materialId: value || undefined })}
                    >
                      <option value="">
                        {s.kind === 'borrow' ? 'Unknown material (cannot meet quality rules)' : 'Accept all materials'}
                      </option>
                      {design.materials
                        .filter((m) => s.kind === 'waste' || m.purpose !== 'stripping')
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                    </RoadSelect>
                  </Field>
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={s.capacityM3 === null}
                      onChange={(e) => patch('sites', s.id, { capacityM3: e.target.checked ? null : 1000 })}
                    />
                    Unbounded scenario capacity
                  </label>
                  <Field label={`Site ${index + 1} source / access notes`}>
                    <textarea
                      className={roadFieldClass}
                      rows={2}
                      maxLength={2000}
                      value={s.sourceNotes ?? ''}
                      onChange={(event) => patch('sites', s.id, { sourceNotes: event.target.value })}
                    />
                  </Field>
                  {s.kind === 'borrow' && (
                    <Button size="sm" variant="outline" onClick={() => patch('sites', s.id, { unitRate: 0 })}>
                      Set borrow acquisition price to $0
                    </Button>
                  )}
                </div>
              ))}
            </RoadSection>
            <MaterialAllocationControls
              design={design}
              length={analysis.length}
              layerIds={[
                ...new Set(
                  analysis.stations.flatMap((s) => [
                    ...(s.layerAreas ?? []).map((layer) => layer.id),
                    ...(s.componentAreas ?? []).map((component) => component.id),
                  ]),
                ),
              ]}
              problem={problem}
              onChange={(value) => edit(() => value)}
            />
          </RoadSettingsDialog>
        </>
      )}
    </div>
  )
}
