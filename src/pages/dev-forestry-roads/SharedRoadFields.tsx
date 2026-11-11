import type { ReactNode } from 'react'
import type { RoadWorkspace } from './useRoadWorkspace'
import type { DrainageSettings } from './drainageRun'
import { DesignStandardField } from './DesignStandardsFields'
import { CurveDesignField } from './CurveTools'
import { jobStandardsOf, withJobStandards } from './jobStandards'
import type { PointCloudChoice, SidebarProps } from './DesignSidebarBody'
import { Field, NumberField, RoadSelect, roadFieldClass } from './Controls'
import { inputMessage } from './inputErrors'
import { ditchWidthRange } from './templates'
import {
  TEMPLATE_FIELDS,
  STANDARD_LABELS,
  DRAINAGE_FIELDS,
  CURVE_LABELS,
  fieldIds,
  ribbonFieldLabels,
  type DrainageFieldId,
  type TerrainFieldId,
  RATES,
  SAMPLING,
  type TemplateFieldId,
  type ProjectFieldId,
  type RibbonFieldId,
} from './roadFieldDefinitions'

export function TemplateField({ field, workspace }: { field: TemplateFieldId; workspace: RoadWorkspace }) {
  const [, label, min, max] = TEMPLATE_FIELDS.find(([key]) => key === field)!
  const { alignment, analysis, updateAlignment } = workspace
  const lower = ditchWidthRange(alignment.template, field)?.min
  return (
    <NumberField
      label={label}
      value={alignment.template[field] ?? 0}
      min={lower ?? min}
      max={max}
      hint={
        field === 'ditchWidth' && (lower ?? 0) > 0
          ? 'No narrower than the ditch bottom width set under Template components. Reduce the bottom width first.'
          : undefined
      }
      error={inputMessage(analysis.invalidInput, 'template', undefined, field)}
      onChange={(value) => updateAlignment((a) => ({ ...a, template: { ...a.template, [field]: value } }))}
    />
  )
}

export function ProjectSettingField({ field, workspace }: { field: ProjectFieldId; workspace: RoadWorkspace }) {
  const sampling = SAMPLING.find(([key]) => key === field)
  const rate = RATES.find(([key]) => key === field)
  const factor = field === 'shrinkFactor'
  return (
    <NumberField
      label={sampling?.[1] ?? rate![1]}
      value={workspace.project.settings[field]}
      hint={
        sampling?.[4] ??
        (field === 'surfacingRate'
          ? 'Base surfacing rate. An enabled aggregate source supplies its entered capacity at its delivered rate; only the remainder uses this base rate.'
          : undefined)
      }
      min={sampling?.[2] ?? (factor ? 0.1 : 0)}
      max={sampling?.[3] ?? (factor ? 2 : 10000)}
      step={sampling ? 1 : undefined}
      onChange={(value) => workspace.update((p) => ({ ...p, settings: { ...p.settings, [field]: value } }))}
    />
  )
}

export function RoadNameField({ workspace }: { workspace: RoadWorkspace }) {
  return (
    <Field label="Road name">
      <input
        className={roadFieldClass}
        maxLength={200}
        value={workspace.alignment.name}
        onChange={(e) => workspace.updateAlignment((a) => ({ ...a, name: e.target.value }))}
      />
    </Field>
  )
}
export const SURFACES: Record<PointCloudChoice['surface'], string> = {
  mean: 'Ground cell mean',
  tin: 'TIN with breaklines',
}
const CLASSIFY: Record<string, string> = {
  auto: "Use the file's; classify if none",
  true: 'Re-classify here',
  false: "Use the file's only",
}

type TerrainProps = Pick<SidebarProps, 'verticalReference' | 'onVerticalReference' | 'pointCloud' | 'onPointCloud'>
export function TerrainImportField(p: TerrainProps & { field: TerrainFieldId; compact?: boolean }) {
  if (p.field === 'importDatum')
    return (
      <Field label={p.compact ? 'Vertical datum' : 'Imported DEM vertical datum (metres)'}>
        <input
          className={roadFieldClass}
          aria-label="Imported DEM vertical datum (metres)"
          value={p.verticalReference}
          placeholder="e.g. CGVD2013 / EPSG:6647"
          onChange={(e) => p.onVerticalReference(e.target.value)}
        />
      </Field>
    )
  if (p.field === 'preserveCorridorM')
    return (
      <NumberField
        label={p.compact ? ribbonFieldLabels[p.field] : 'Preserve road corridor each side (m; 0 disables)'}
        hint="Points inside the active road corridor keep full density. Outside it, thinning respects the worker's point budget. Enter 0 to disable corridor preservation."
        value={p.pointCloud.preserveCorridorM ?? 0}
        min={0}
        max={1000}
        onChange={(preserveCorridorM) => p.onPointCloud({ ...p.pointCloud, preserveCorridorM })}
      />
    )
  if (p.field === 'retainTin')
    return (
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          className="shrink-0"
          checked={p.pointCloud.retainTin ?? false}
          onChange={(e) => p.onPointCloud({ ...p.pointCloud, retainTin: e.target.checked })}
        />
        {p.compact ? ribbonFieldLabels[p.field] : 'Retain source TIN for LandXML (250,000 vertices)'}
      </label>
    )
  if (p.field === 'cloudSurface')
    return (
      <Field label="Point-cloud surface">
        <RoadSelect
          ariaLabel="Point-cloud surface"
          className={roadFieldClass}
          value={p.pointCloud.surface}
          onValueChange={(value) => p.onPointCloud({ ...p.pointCloud, surface: value as PointCloudChoice['surface'] })}
        >
          {Object.entries(SURFACES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </RoadSelect>
      </Field>
    )
  return (
    <Field
      label="Ground classification"
      hint="Unclassified clouds are classified in the browser with WhiteboxTools' ground point filter."
    >
      <RoadSelect
        ariaLabel="Ground classification"
        className={roadFieldClass}
        value={String(p.pointCloud.classify)}
        onValueChange={(value) =>
          p.onPointCloud({
            ...p.pointCloud,
            classify: value === 'auto' ? 'auto' : value === 'true',
          })
        }
      >
        {Object.entries(CLASSIFY).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </RoadSelect>
    </Field>
  )
}

type DrainageProps = {
  settings: DrainageSettings
  onSettings: (next: DrainageSettings) => void
}

export function DrainageSettingField({ field, settings, onSettings }: DrainageProps & { field: DrainageFieldId }) {
  return (
    <NumberField
      {...DRAINAGE_FIELDS[field]}
      value={settings[field]}
      onChange={(next) => onSettings({ ...settings, [field]: next })}
    />
  )
}

/** The compact strip and detailed editors bind to the same form components. */
export function ribbonFields(
  workspace: RoadWorkspace,
  terrain: TerrainProps,
  roadAvailable: boolean,
  investigation: boolean,
  drainage?: DrainageProps,
) {
  const fields: Partial<Record<RibbonFieldId, ReactNode>> = {}
  if (investigation) return fields
  for (const field of ['importDatum', 'cloudSurface', 'cloudClass', 'preserveCorridorM'] as const)
    fields[field] = <TerrainImportField {...terrain} field={field} compact />
  if (terrain.pointCloud.surface === 'tin')
    fields.retainTin = <TerrainImportField {...terrain} field="retainTin" compact />
  const standards = jobStandardsOf(workspace.project)
  for (const field of fieldIds(STANDARD_LABELS)) {
    if (field === 'adverseGradePercent' && !standards.standards.loadedDirection) continue
    fields[field] = (
      <DesignStandardField
        field={field}
        value={standards}
        onChange={(next) => workspace.update((project) => withJobStandards(project, next))}
      />
    )
  }
  if (drainage && roadAvailable)
    for (const field of fieldIds(DRAINAGE_FIELDS)) fields[field] = <DrainageSettingField {...drainage} field={field} />
  for (const [field] of [...SAMPLING, ...RATES])
    fields[field] = <ProjectSettingField workspace={workspace} field={field} />
  if (roadAvailable) {
    for (const field of fieldIds(CURVE_LABELS)) {
      if (field === 'curveDesignSpeedKmh' || workspace.alignment.curveDesign)
        fields[field] = <CurveDesignField field={field} workspace={workspace} compact />
    }
    fields.roadName = <RoadNameField workspace={workspace} />
    for (const [field] of TEMPLATE_FIELDS) fields[field] = <TemplateField workspace={workspace} field={field} />
  }
  return fields
}
