import { FormField, NullableNumberField, NativeSelect } from '@/components/ui/form-field'
import type { ReactNode } from 'react'
import { FilterChipGroup, InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ToggleRow } from '@/components/ui/toggle-row'
import { FIELD_CLASS } from './InputsPanel'
import { slopeClassLabel } from './slope'
import type { AvastSettings } from './types'

const LABEL_CLASS = 'block min-w-0 text-xs font-medium text-muted-foreground'
const toggle = (values: string[], value: string) => (values.includes(value) ? values.filter((item) => item !== value) : [...values, value])

function NumberField({ label, value, onChange, min, max, step = 1, suffix, placeholder, hint }: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  placeholder?: string
  hint?: ReactNode
}) {
  return <NullableNumberField label={label} value={value} onValueChange={onChange} min={min} max={max}
    step={step} suffix={suffix} placeholder={placeholder} hint={hint} clampOn="never" invalidValue="null"
    inputMode="decimal" inputClassName={FIELD_CLASS.replace('mt-1 ', '')} contentClassName="block"
    labelClassName={LABEL_CLASS} rowClassName="mt-1" descriptionClassName="font-normal leading-4" />
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <FormField label={label} contentClassName="block" labelClassName={LABEL_CLASS}>
    <input type="text" className={FIELD_CLASS} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
  </FormField>
}

export function SettingsPanel({ settings, onChange, operatingAreas, lidarAvailable, stale }: {
  settings: AvastSettings
  onChange: (patch: Partial<AvastSettings>) => void
  operatingAreas: string[]
  lidarAvailable: boolean
  stale: boolean
}) {
  const breaks = settings.slopeBreaks
  const setNumber = (key: keyof AvastSettings, fallback: number) => (value: number | null) => onChange({ [key]: value ?? fallback } as Partial<AvastSettings>)
  return (
    <>
      {stale && <div className="px-4 pt-3"><InlineAlert tone="warning">Slope or geometry settings changed since the last run. Run again to apply them.</InlineAlert></div>}
      <SidebarSection title="Project" className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Project name" value={settings.projectName} onChange={(projectName) => onChange({ projectName })} placeholder="Dunkley" />
          <TextField label="Source type" value={settings.sourceType} onChange={(sourceType) => onChange({ sourceType })} placeholder="Dunkley Proposed Block" />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">The name prefixes the workbook titles and the geodatabase layers ({settings.projectName || 'Project'}_AVAST_Volume_Intersect, …). Source type fills Source_Type where the blocks carry none.</p>
      </SidebarSection>

      <SidebarSection title="Area and coverage" className="space-y-3">
        <SegmentedControl label="Merch / gross area" value={settings.grossArea} onChange={(grossArea) => onChange({ grossArea })} options={[
          { value: 'field', label: 'Attribute field' },
          { value: 'geometry', label: 'Polygon area' },
        ]} />
        <p className="text-xs leading-5 text-muted-foreground">Column C and the coverage denominator. With the attribute, blank or zero values fall back to the polygon's BC Albers area.</p>
        <div className="grid grid-cols-3 gap-2">
          <NumberField label="Good ≥" value={settings.coverageGoodPct} onChange={setNumber('coverageGoodPct', 90)} min={0} max={100} suffix="%" />
          <NumberField label="Moderate ≥" value={settings.coverageModeratePct} onChange={setNumber('coverageModeratePct', 70)} min={0} max={100} suffix="%" />
          <NumberField label="Low ≥" value={settings.coverageLowPct} onChange={setNumber('coverageLowPct', 5)} min={0} max={100} suffix="%" />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">AVAST coverage classes for the planning notes. Below “Low” a block reads “Little/no AVAST coverage”.</p>
      </SidebarSection>

      <SidebarSection title="LiDAR adjustment (Part 2)" className="space-y-3">
        <SegmentedControl label="LiDAR adjustment" value={settings.lidarMode} onChange={(lidarMode) => onChange({ lidarMode })} options={[
          { value: 'none', label: 'AVAST raw' },
          { value: 'factor', label: 'Known factor' },
          { value: 'calibrate', label: 'Derive', disabled: !lidarAvailable, title: lidarAvailable ? undefined : 'Add a LiDAR volume layer first' },
        ]} />
        {settings.lidarMode === 'factor' && (
          <div className="grid grid-cols-1 gap-2">
            <NumberField label="LiDAR adjustment factor (LiDAR ÷ AVAST)" value={settings.lidarFactor} step={0.0001} min={0}
              onChange={setNumber('lidarFactor', 1)} hint={`${(settings.lidarFactor * 100).toFixed(2)}% of the raw AVAST volume.`} />
            <TextField label="Where the factor comes from" value={settings.lidarFactorNote} onChange={(lidarFactorNote) => onChange({ lidarFactorNote })} />
          </div>
        )}
        {settings.lidarMode === 'calibrate' && (
          <div className="space-y-2">
            <NumberField label="Calibration blocks need common AVAST + LiDAR coverage of" value={settings.calibrationMinCoveragePct} min={0} max={100} suffix="%"
              onChange={setNumber('calibrationMinCoveragePct', 95)} />
            {operatingAreas.length > 0 && (
              <div>
                <p className={LABEL_CLASS}>Calibration operating areas (none selected = all)</p>
                <FilterChipGroup variant="filled" className="mt-1"
                  items={operatingAreas.map((area) => ({ value: area, label: area }))}
                  selectedValues={settings.calibrationOperatingAreas}
                  onToggle={(area) => onChange({ calibrationOperatingAreas: toggle(settings.calibrationOperatingAreas, area) })} />
              </div>
            )}
          </div>
        )}
        {settings.lidarMode !== 'none' && lidarAvailable && (
          <NumberField label="Use LiDAR directly where it covers at least" value={settings.directLidarMinCoveragePct} min={0} max={100} suffix="%"
            onChange={setNumber('directLidarMinCoveragePct', 90)} hint="Those blocks report LiDAR volume and are never multiplied by the factor." />
        )}
        <p className="text-xs leading-5 text-muted-foreground">The factor scales volume only — never area — and is project-specific. A derived factor is total LiDAR ÷ total AVAST over the same footprint, not an average of block ratios.</p>
      </SidebarSection>

      <SidebarSection title="Slope classes (Part 3)" className="space-y-3">
        <SegmentedControl label="Slope source" value={settings.slopeSource} onChange={(slopeSource) => onChange({ slopeSource })} options={[
          { value: 'dem', label: 'DEM' },
          { value: 'attribute', label: 'AVAST Avg_Slope' },
          { value: 'none', label: 'Off' },
        ]} />
        <p className="text-xs leading-5 text-muted-foreground">
          {settings.slopeSource === 'dem'
            ? 'Percent rise from terrain tiles, resampled to a BC Albers grid, reclassified and intersected with every piece — the procedure’s Slope → Reclassify → Raster to Polygon → Intersect.'
            : settings.slopeSource === 'attribute'
              ? 'Each AVAST polygon’s own average slope classifies its whole piece. Fast, but coarser than a DEM.'
              : 'No slope split; only total volume is reported.'}
        </p>
        {settings.slopeSource !== 'none' && (
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Break 1" value={breaks[0]} min={0} max={200} suffix="%" onChange={(value) => onChange({ slopeBreaks: [value ?? 35, breaks[1]] })} />
            <NumberField label="Break 2" value={breaks[1]} min={0} max={200} suffix="%" onChange={(value) => onChange({ slopeBreaks: [breaks[0], value ?? 45] })} />
          </div>
        )}
        {settings.slopeSource !== 'none' && (
          <p className="text-xs text-muted-foreground">{slopeClassLabel(1, breaks)} · {slopeClassLabel(2, breaks)} (both ends inclusive) · {slopeClassLabel(3, breaks)}</p>
        )}
        {settings.slopeSource === 'dem' && (
          <div className="grid grid-cols-2 gap-2">
            <label className={LABEL_CLASS}>
              DEM detail
              <NativeSelect className={FIELD_CLASS} value={settings.demZoom} onChange={(event) => onChange({ demZoom: Number(event.target.value) })}>
                <option value={12}>Overview (~19 m)</option>
                <option value={13}>Standard (~10 m)</option>
                <option value={14}>Fine (~5 m)</option>
              </NativeSelect>
            </label>
            <NumberField label="Slope cell" value={settings.slopeCellMeters} min={5} max={100} suffix="m" onChange={setNumber('slopeCellMeters', 20)} />
          </div>
        )}
      </SidebarSection>

      <SidebarSection title="Reported volume" className="space-y-3">
        <SegmentedControl label="Reported volume" value={settings.volumeBasis} onChange={(volumeBasis) => onChange({ volumeBasis })} options={[
          { value: 'total', label: 'Total' },
          { value: 'class1', label: slopeClassLabel(1, breaks), disabled: settings.slopeSource === 'none' },
          { value: 'class12', label: `≤${breaks[1]}%`, disabled: settings.slopeSource === 'none' },
        ]} />
        <p className="text-xs leading-5 text-muted-foreground">What goes into Direct Est. Vol (F) and the Management Summary. The full split is always on the Slope Volume Summary sheet.</p>
        <div className="grid grid-cols-2 gap-2">
          <label className={LABEL_CLASS}>
            Preferred VPH decimals
            <NativeSelect className={FIELD_CLASS} value={settings.vphDecimals} onChange={(event) => onChange({ vphDecimals: Number(event.target.value) })}>
              <option value={0}>Whole m³/ha</option>
              <option value={1}>1 decimal</option>
              <option value={2}>2 decimals</option>
            </NativeSelect>
          </label>
          <NumberField label="Reference target" value={settings.referenceTargetM3} min={0} suffix="m³" placeholder="Optional"
            onChange={(referenceTargetM3) => onChange({ referenceTargetM3 })} />
        </div>
        <ToggleRow active={settings.notesIncludeSlope} onClick={() => onChange({ notesIncludeSlope: !settings.notesIncludeSlope })}
          label="Add the slope split to planning notes" description="Appends “Slope: 78% of volume <35%, …” to column I."
          title="Add the slope split to planning notes — appends “Slope: 78% of volume <35%, …” to column I." />
        <SegmentedControl label="Duplicate Block IDs" value={settings.duplicates} onChange={(duplicates) => onChange({ duplicates })} options={[
          { value: 'flag', label: 'Keep, flag DUPLICATE' },
          { value: 'drop', label: 'Drop repeats' },
        ]} />
        {operatingAreas.length > 0 && (
          <div>
            <p className={LABEL_CLASS}>Leave operating areas out of the report</p>
            <FilterChipGroup variant="filled" className="mt-1"
              items={operatingAreas.map((area) => ({ value: area, label: area }))}
              selectedValues={settings.excludedOperatingAreas}
              onToggle={(area) => onChange({ excludedOperatingAreas: toggle(settings.excludedOperatingAreas, area) })} />
          </div>
        )}
      </SidebarSection>
    </>
  )
}
