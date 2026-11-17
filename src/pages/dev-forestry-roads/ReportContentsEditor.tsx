import { useEffect, useRef } from 'react'
import { CheckboxField } from '@/components/ui/form-field'
import { InfoTip } from '@/components/ui/info-tip'
import { SelectField } from '@/components/ui/form-field'
import { SelectAllActions } from '@/components/ui/text-button'
import { ALWAYS_PRINTED_SECTIONS, REPORT_SECTIONS, toggleReportSection, type ReportSectionId } from './reportContents'
import { createRoadReportSettings, parseRoadReportSettings, type RoadReportSettings } from './reportSettings'

/**
 * The report's contents: a checkbox per optional section, saved with the project's report settings.
 * `focus` brings one section's checkbox into view and focuses it, e.g. after its heading was clicked
 * in the preview.
 */
export function ReportContentsEditor({
  value,
  onChange,
  focus,
  baselineRoads,
}: {
  /** Roads that may hold the issued design for the record of changes; none hides the choice. */
  baselineRoads?: { id: string; name: string }[]
  value?: RoadReportSettings
  onChange: (settings: RoadReportSettings) => void
  focus?: ReportSectionId
}) {
  const settings = value ?? createRoadReportSettings()
  const omitted = settings.omittedSections ?? []
  const set = (omittedSections: ReportSectionId[]) => {
    const next: RoadReportSettings = { ...settings, omittedSections }
    if (!omittedSections.length) delete next.omittedSections
    onChange(parseRoadReportSettings(next))
  }
  const focused = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!focus) return
    focused.current?.scrollIntoView?.({ block: 'nearest' })
    focused.current?.focus?.({ preventScroll: true })
  }, [focus])
  const heading = 'text-3xs font-semibold uppercase tracking-wide text-muted-foreground'
  return (
    <div className="space-y-3 text-xs" data-testid="road-report-contents">
      <div className="flex items-center gap-2">
        <h4 className={heading}>Sections to print</h4>
        <InfoTip label="About the report contents">
          Saved with the project and used by the HTML and PDF report. A print that leaves sections out lists them under
          its status line. Always printed: {ALWAYS_PRINTED_SECTIONS.join('; ')}.
        </InfoTip>
        <SelectAllActions
          className="ml-auto"
          onAll={() => set([])}
          onNone={() => set(REPORT_SECTIONS.map((section) => section.id))}
          allSelected={!omitted.length}
          noneSelected={omitted.length === REPORT_SECTIONS.length}
        />
      </div>
      <div className="grid gap-x-3 gap-y-1.5 sm:grid-cols-2">
        {REPORT_SECTIONS.map((section) => (
          <CheckboxField
            key={section.id}
            ref={section.id === focus ? focused : undefined}
            label={section.label}
            checked={!omitted.includes(section.id)}
            onCheckedChange={(checked) => set(toggleReportSection(omitted, section.id, checked))}
            className={section.id === focus ? 'rounded-sm ring-2 ring-primary/40' : undefined}
          />
        ))}
      </div>
      {baselineRoads && baselineRoads.length > 0 && (
        <SelectField
          label="Issued design for the record of changes"
          hint="Keep the design as issued as a copy of the road (Duplicate road), edit the road to the field record, then choose the copy here."
          value={
            settings.recordBaselineId && baselineRoads.some((road) => road.id === settings.recordBaselineId)
              ? settings.recordBaselineId
              : ''
          }
          onChange={(event) => {
            const id = event.target.value
            const next: RoadReportSettings = { ...settings, recordBaselineId: id }
            if (!id) delete next.recordBaselineId
            onChange(parseRoadReportSettings(next))
          }}
        >
          <option value="">None: no comparison</option>
          {baselineRoads.map((road) => (
            <option key={road.id} value={road.id}>
              {road.name}
            </option>
          ))}
        </SelectField>
      )}
      <p className="text-muted-foreground">
        {omitted.length
          ? `${REPORT_SECTIONS.length - omitted.length} of ${REPORT_SECTIONS.length} sections print.`
          : 'Every section prints.'}
      </p>
    </div>
  )
}
