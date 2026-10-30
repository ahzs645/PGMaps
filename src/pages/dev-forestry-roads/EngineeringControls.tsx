import { RoadSection } from './SidebarParts'
import { RoadSettingsDialog } from './RoadSettingsDialog'
import { useRef, useState } from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TabBar } from '@/components/ui/tab-bar'
import { Field, NumberField, OptionalNumberField, roadFieldClass } from './Controls'
import { createEngineeringDesign } from './engineeringTypes'
import { downloadText } from '@/lib/download'
import { importRoadLibrary, serializeRoadLibrary } from './project'
import { TemplateSandbox } from './TemplateSandbox'
import { GravelSourcesPanel } from './GravelSourcesPanel'
import { surfacingSupplyCost } from './gravel'
import { ReferenceSelect } from './CostReferenceControls'
import { nearestStation } from './engine'
import { templateFromStarter, validateTemplate, type TemplateStarter } from './templates'
import { formatRoadStation } from './Charts'
import type { RoadWorkspace } from './useRoadWorkspace'
import type {
  AlignmentEngineering,
  Culvert,
  GroundMaterial,
  HaulSettings,
  HaulSite,
  RoadTemplate,
  StratumAssignment,
  TemplateAssignment,
} from './types'

const uid = () => crypto.randomUUID()
type NumericField<T> = { key: keyof T; label: string; min?: number; max?: number; step?: number }
function Fields<T extends object>({
  value,
  fields,
  onChange,
}: {
  value: T
  fields: NumericField<T>[]
  onChange: (patch: Partial<T>) => void
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
          onChange={(number) => onChange({ [field.key]: number } as Partial<T>)}
        />
      ))}
    </div>
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
}: {
  workspace: RoadWorkspace
  onPreviewTemplate: (template: RoadTemplate, name: string) => void
  onClosePreview?: () => void
  onQuantities: () => void
  previewActive?: boolean
  aggregateOpen?: boolean
  onAggregateOpenChange?: (open: boolean) => void
}) {
  const [tab, setTab] = useState<'templates' | 'materials' | 'culverts' | 'haul'>('templates')
  const [haulOpen, setHaulOpen] = useState(false)
  const activeTab = aggregateOpen ? 'haul' : tab
  const changeHaulOpen = (open: boolean) => {
    setHaulOpen(open)
    onAggregateOpenChange?.(open)
    setTab('haul')
  }
  const [templateId, setTemplateId] = useState('')
  const [preset, setPreset] = useState<TemplateStarter>('current')
  const [libraryMode, setLibraryMode] = useState<'merge' | 'replace'>('merge')
  const libraryInput = useRef<HTMLInputElement>(null)
  const { alignment, analysis, project } = w
  const design = alignment.engineering ?? createEngineeringDesign()
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
    [...templateFields, ...sideFields].some(({ key }) => candidate[key] !== selected.template[key])
  const at = nearestStation(analysis.stations, w.station)
  const edit = (change: (e: AlignmentEngineering) => AlignmentEngineering) =>
    w.updateAlignment((a) => ({ ...a, engineering: change(a.engineering ?? createEngineeringDesign()) }))
  const patch = <K extends 'assignments' | 'materials' | 'strata' | 'culverts' | 'sites'>(
    key: K,
    id: string,
    changes: Partial<AlignmentEngineering[K][number]>,
  ) => edit((e) => ({ ...e, [key]: e[key].map((x) => (x.id === id ? { ...x, ...changes } : x)) }))
  const remove = (key: 'assignments' | 'materials' | 'strata' | 'culverts' | 'sites', id: string) =>
    edit((e) => ({
      ...e,
      [key]: e[key].filter((x) => x.id !== id),
      ...(key === 'materials' ? { strata: e.strata.filter((s) => s.materialId !== id) } : {}),
    }))
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
  const assignmentRange = () => {
    const lastEnd = Math.max(w.station, ...design.assignments.map((a) => a.end), 0)
    return { start: lastEnd, end: Math.min(100000, lastEnd + Math.max(1, Math.min(100, analysis.length - lastEnd))) }
  }
  const newCulvert = (
    chainage = w.station,
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
        <div className="space-y-1.5 rounded border bg-muted/20 p-2" data-testid="road-aggregate-summary">
          <p className="text-[11px] text-muted-foreground">
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
        <Button size="sm" variant="outline" className="w-full" onClick={onQuantities}>
          Show quantities & cost breakdown
        </Button>
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
                        a.id === alignment.id ? importRoadLibrary(a, text, libraryMode) : a,
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
              <select
                className={roadFieldClass}
                value={libraryMode}
                onChange={(e) => setLibraryMode(e.target.value as typeof libraryMode)}
              >
                <option value="merge">Merge definitions</option>
                <option value="replace">Replace library & clear assignments</option>
              </select>
            </Field>
            <Field label="Template starting point">
              <select
                aria-label="Template starting point"
                className={roadFieldClass}
                value={preset}
                onChange={(e) => setPreset(e.target.value as TemplateStarter)}
              >
                <option value="current">Current road section</option>
                <option value="single">Forest single lane</option>
                <option value="double">Forest double lane</option>
                <option value="landing">Wide landing</option>
                <option value="urban">Crowned road</option>
              </select>
            </Field>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 w-full"
              disabled={design.templates.length >= 50}
              onClick={() => {
                const names: Record<TemplateStarter, string> = {
                  current: 'Road section',
                  single: 'Forest single lane',
                  double: 'Forest double lane',
                  landing: 'Wide landing',
                  urban: 'Crowned road',
                }
                let template: RoadTemplate
                try {
                  template = templateFromStarter(alignment.template, preset)
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
                  <select
                    className={roadFieldClass}
                    value={selected.id}
                    onChange={(e) => {
                      setTemplateId(e.target.value)
                      onClosePreview?.()
                    }}
                  >
                    {design.templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
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
                    edit((e) => ({
                      ...e,
                      templates: e.templates.filter((t) => t.id !== selected.id),
                      assignments: e.assignments.filter((a) => a.templateId !== selected.id),
                    }))
                    onClosePreview?.()
                  }}
                />
                <p
                  className={`text-[11px] leading-4 ${templateDirty ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}
                  data-testid="template-candidate-status"
                  role="status"
                >
                  {templateDirty
                    ? 'Unsaved template changes. Preview the candidate, then save to update assigned road sections and library exports.'
                    : 'Saved template parameters. Edits can be previewed before saving.'}
                </p>
                <Fields value={candidate} fields={templateFields} onChange={updateTemplate} />
                <details className="rounded border p-2">
                  <summary className="cursor-pointer text-xs">Independent left / right components</summary>
                  <div className="space-y-2">
                    {sideFields.map((field) => (
                      <div key={String(field.key)} className="flex items-end gap-1">
                        <div className="min-w-0 flex-1">
                          <NumberField
                            {...field}
                            label={field.label}
                            value={
                              candidate[field.key] ??
                              candidate[
                                field.key
                                  .replace(/^(left|right)/, '')
                                  .replace(/^./, (c) => c.toLowerCase()) as keyof RoadTemplate
                              ] ??
                              0
                            }
                            onChange={(value) => updateTemplate({ [field.key]: value })}
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
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
                  name={`${selected.name}${templateDirty ? ' · unsaved candidate' : ''}`}
                />
              </div>
            )}
          </RoadSection>
          <RoadSection
            title="Template station assignments"
            help="Ranges on the same side must not overlap. Transitions blend from the base section within each end of the range. Landings/turnouts remain additional width overrides."
          >
            <Button
              variant="outline"
              size="sm"
              disabled={!selected || templateDirty || design.assignments.length >= 200}
              onClick={() =>
                selected &&
                edit((e) => ({
                  ...e,
                  assignments: [
                    ...e.assignments,
                    { id: uid(), ...assignmentRange(), templateId: selected.id, side: 'both', transitionM: 0 },
                  ],
                }))
              }
            >
              Assign selected template
            </Button>
            {templateDirty && (
              <p className="mt-2 text-[11px] text-muted-foreground">
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
                  <select
                    className={roadFieldClass}
                    value={a.templateId}
                    onChange={(e) => patch('assignments', a.id, { templateId: e.target.value })}
                  >
                    {design.templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={`Assignment ${index + 1} side`}>
                  <select
                    className={roadFieldClass}
                    value={a.side}
                    onChange={(e) => patch('assignments', a.id, { side: e.target.value as TemplateAssignment['side'] })}
                  >
                    {['both', 'left', 'right'].map((side) => (
                      <option key={side}>{side}</option>
                    ))}
                  </select>
                </Field>
                <Fields<TemplateAssignment>
                  value={a}
                  fields={[
                    { key: 'start', label: `Assignment ${index + 1} start (m)` },
                    { key: 'end', label: `Assignment ${index + 1} end (m)` },
                    { key: 'transitionM', label: `Assignment ${index + 1} transition (m)`, max: 1000 },
                  ]}
                  onChange={(p) => patch('assignments', a.id, p)}
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
                    <select
                      className={roadFieldClass}
                      value={m.purpose ?? 'earthwork'}
                      onChange={(e) =>
                        patch('materials', m.id, {
                          purpose: e.target.value as GroundMaterial['purpose'],
                          ...(e.target.value === 'stripping' ? { reusableFraction: 0 } : {}),
                        })
                      }
                    >
                      <option value="earthwork">Earthwork</option>
                      <option value="stripping">Excavated stripping</option>
                    </select>
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
                    {
                      key: 'compactionFactor',
                      label: `${m.name} compacted / bank factor`,
                      min: 0.1,
                      max: 2,
                      step: 0.05,
                    },
                  ]}
                  onChange={(p) => patch('materials', m.id, p)}
                />
              </div>
            ))}
          </RoadSection>
          <RoadSection
            title="Station ranges & ground horizons"
            help="Depths are vertical below original ground. Horizons cannot overlap. Excavated stripping is reported separately and never reused; this does not model stripping or undercut beneath fill areas."
          >
            <Button
              size="sm"
              variant="outline"
              disabled={!design.materials.length || design.strata.length >= 200}
              onClick={() => {
                const bottom = Math.max(0, ...design.strata.map((s) => s.bottomDepthM ?? s.topDepthM + 1))
                edit((e) => ({
                  ...e,
                  strata: [
                    ...e.strata,
                    {
                      id: uid(),
                      start: 0,
                      end: Math.max(1, analysis.length),
                      materialId: e.materials[e.materials.length - 1].id,
                      topDepthM: bottom,
                      bottomDepthM: bottom + 1,
                    },
                  ],
                }))
              }}
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
                  <select
                    className={roadFieldClass}
                    value={s.materialId}
                    onChange={(e) => patch('strata', s.id, { materialId: e.target.value })}
                  >
                    {design.materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Fields<StratumAssignment>
                  value={s}
                  fields={[
                    { key: 'start', label: `Horizon ${index + 1} start (m)` },
                    { key: 'end', label: `Horizon ${index + 1} end (m)` },
                    { key: 'topDepthM', label: `Horizon ${index + 1} top depth (m)`, max: 1000 },
                    ...(s.bottomDepthM === null
                      ? []
                      : [{ key: 'bottomDepthM' as const, label: `Horizon ${index + 1} bottom depth (m)`, max: 1000 }]),
                  ]}
                  onChange={(p) => patch('strata', s.id, p)}
                />
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
            {analysis.crossings
              .filter((c) => c.kind === 'stream')
              .map((c) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant="ghost"
                  className="h-auto w-full justify-start whitespace-normal text-left"
                  disabled={design.culverts.length >= 100}
                  onClick={() => newCulvert(c.chainage, c.name, c.featureId)}
                >
                  + {c.name} · {formatRoadStation(c.chainage)}
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
                  <select
                    className={roadFieldClass}
                    value={c.kind ?? 'cross-drain'}
                    onChange={(e) => patch('culverts', c.id, { kind: e.target.value as Culvert['kind'] })}
                  >
                    <option value="cross-drain">Road cross-drain</option>
                    <option value="stream">Natural stream</option>
                  </select>
                </Field>
                <Fields<Culvert>
                  value={c}
                  fields={[
                    { key: 'chainage', label: `Culvert ${index + 1} station (m)` },
                    { key: 'skewDegrees', label: `Culvert ${index + 1} skew (°)`, min: -80, max: 80 },
                    { key: 'lengthM', label: `Culvert ${index + 1} horizontal barrel span (m)`, min: 0.2, max: 500 },
                    { key: 'diameterM', label: `Culvert ${index + 1} diameter (m)`, min: 0.1, max: 20 },
                    { key: 'minCoverM', label: `Culvert ${index + 1} required cover (m)`, max: 100 },
                    { key: 'unitCost', label: `Culvert ${index + 1} installed $/m`, max: 1000000 },
                    { key: 'fixedCost', label: `Culvert ${index + 1} fixed cost ($)`, max: 1e9 },
                  ]}
                  onChange={(p) => patch('culverts', c.id, p)}
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
                    onChange={(p) => patch('culverts', c.id, p)}
                  />
                )}
                {result && (
                  <p className="text-[11px] leading-4">
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
              help="Allocations use a deterministic chainage-order plan within covered intervals. Choose nearest or lowest delivered batch cost. Haul distance follows road chainage plus site access. This is a cost scenario, not a global route or haul optimizer."
            >
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
                            chainage: w.station,
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
                    onChange={(p) => patch('sites', s.id, p)}
                  />
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
          </RoadSettingsDialog>
        </>
      )}
      {at && (
        <p className="px-3 py-2 text-[11px] text-muted-foreground">
          Editing {alignment.name} · selected station {formatRoadStation(at.chainage)}
        </p>
      )}
    </div>
  )
}
