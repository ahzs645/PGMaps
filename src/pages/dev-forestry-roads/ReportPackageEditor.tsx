import { useId } from 'react'
import { CheckboxField } from '@/components/ui/form-field'
import { EstimateAllowances } from './EstimateSettingsEditor'
import { InfoTip } from '@/components/ui/info-tip'
import { StyledSelect } from '@/components/ui/styled-select'
import { TextButton } from '@/components/ui/text-button'
import {
  FRONT_LABELS,
  PACKAGE_FRONTS,
  PACKAGE_GROUP_LABELS,
  PACKAGE_PARTS,
  PACKAGE_PLACEMENTS,
  PACKAGE_PRESETS,
  PLACEMENT_LABELS,
  PRESET_LABELS,
  SLOPE_SHEET_MODES,
  SLOPE_SHEET_MODE_LABELS,
  SUMMARY_SECTIONS,
  SUMMARY_SECTION_LABELS,
  defaultPlacement,
  includesContingency,
  isDefaultPackage,
  packageFront,
  packagePlan,
  packagePreset,
  placementOf,
  presetSettings,
  slopeSheetMode,
  summaryShows,
  withPlacement,
  withSummary,
  type PackageFront,
  type PackagePart,
  type PackagePlacement,
  type PackagePreset,
  type ReportPackageSettings,
  type SlopeSheetMode,
} from './reportPackage'
import {
  CHART_INTERVALS,
  CHART_INTERVAL_LINES,
  CHART_INTERVAL_STYLES,
  CHART_PANELS,
  CHART_STATION_TICKS,
  createReportChapter,
  chartsOptions,
  createRoadReportSettings,
  parseRoadReportSettings,
  INTERVAL_LINES_LABELS,
  INTERVAL_STYLE_LABELS,
  type ChartIntervalLines,
  type ChartIntervalStyle,
  type ChartPanel,
  type ChartsOptions,
  type RoadReportSettings,
} from './reportSettings'

const PANEL_LABELS: Record<ChartPanel, string> = { profile: 'Profile', grade: 'Grade', mass: 'Mass haul' }

const GROUPS: PackagePart['group'][] = ['report', 'plotbook', 'sheet']

/**
 * What the report package holds: every report section, plot-book chapter and block sheet is in the
 * package, in an appendix PDF of its own, or left out. Saved with the project's report settings.
 */
export function ReportPackageEditor({
  value,
  onChange,
  slopeSheet = false,
}: {
  value?: RoadReportSettings
  onChange: (settings: RoadReportSettings) => void
  /** The project has an imported slope sheet, so the summary can set it beside each estimate. */
  slopeSheet?: boolean
}) {
  const settings = value ?? createRoadReportSettings()
  const id = useId()
  const save = (pkg: ReportPackageSettings | undefined) => {
    const next: RoadReportSettings = { ...settings, package: pkg }
    if (isDefaultPackage(pkg)) delete next.package
    onChange(parseRoadReportSettings(next))
  }
  const set = (part: PackagePart, placement: PackagePlacement) =>
    save(withPlacement(settings.package, part.id, placement))
  const reset = () => save(undefined)
  // The package's charts: the plot book's own charts chapter (or its defaults) under the package's choices.
  const charts: ChartsOptions = {
    ...chartsOptions(
      settings.chapters.find((chapter) => chapter.kind === 'charts') ?? createReportChapter('charts', 'charts'),
    ),
    ...settings.package?.charts,
  }
  const setCharts = (changes: Partial<ChartsOptions>) => save(withSummary(settings.package, { charts: changes }))
  const preset = packagePreset(settings.package)
  const front = packageFront(settings.package)
  const plan = packagePlan(settings.package, 'road')
  const changed = !isDefaultPackage(settings.package)
  const heading = 'text-3xs font-semibold uppercase tracking-wide text-muted-foreground'
  return (
    <div className="space-y-4 text-xs" data-testid="road-report-package">
      <div className="flex items-center gap-2">
        <h4 className={heading}>What the package holds</h4>
        <InfoTip label="About the report package">
          Each part is in the package, in an appendix PDF of its own, or left out. Report sections and plot-book
          chapters print for every road in the package; a block sheet prints once. Plot-book chapters use the plot
          book&apos;s Sheet setup for that kind of chapter when it has one. The main PDF opens with a cover whose
          contents give the page each part starts on, or with a summary of the roads; each appendix opens with a cover.
          More than one PDF downloads as a zip. Simplified prints the summary and each road&apos;s profile, grade and
          mass-haul sheet: one or two pages for one road.
        </InfoTip>
        {changed && (
          <TextButton className="ml-auto" onClick={reset}>
            Reset to defaults
          </TextButton>
        )}
      </div>
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <div className="grid gap-1">
          <label htmlFor={`${id}-preset`} className="font-medium">
            Preset
          </label>
          <StyledSelect
            id={`${id}-preset`}
            value={preset}
            onChange={(event) =>
              save(
                presetSettings(
                  event.target.value as PackagePreset,
                  includesContingency(settings.package),
                  slopeSheetMode(settings.package),
                  settings.package?.range,
                ),
              )
            }
          >
            {PACKAGE_PRESETS.map((option) => (
              <option key={option} value={option}>
                {PRESET_LABELS[option]}
              </option>
            ))}
            {preset === 'custom' && (
              <option value="custom" disabled>
                {PRESET_LABELS.custom}
              </option>
            )}
          </StyledSelect>
        </div>
        <div className="grid gap-1">
          <label htmlFor={`${id}-front`} className="font-medium">
            Front page
          </label>
          <StyledSelect
            id={`${id}-front`}
            value={front}
            onChange={(event) => save(withSummary(settings.package, { front: event.target.value as PackageFront }))}
          >
            {PACKAGE_FRONTS.map((option) => (
              <option key={option} value={option}>
                {FRONT_LABELS[option]}
              </option>
            ))}
          </StyledSelect>
        </div>
      </div>
      {placementOf(settings.package, 'plotbook:charts') !== 'omit' && (
        <section className="space-y-1.5" data-testid="road-report-package-charts">
          <h5 className={heading}>Profile, grade &amp; mass haul in the package</h5>
          <div className="grid gap-x-3 gap-y-1.5 sm:grid-cols-3">
            {CHART_PANELS.map((panel) => (
              <CheckboxField
                key={panel}
                label={PANEL_LABELS[panel]}
                checked={charts.panels.includes(panel)}
                disabled={charts.panels.length === 1 && charts.panels.includes(panel)}
                onCheckedChange={(checked) =>
                  setCharts({ panels: CHART_PANELS.filter((p) => (p === panel ? checked : charts.panels.includes(p))) })
                }
              />
            ))}
          </div>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            <div className="grid gap-1">
              <label htmlFor={`${id}-ticks`} className="font-medium">
                Station axis every
              </label>
              <StyledSelect
                id={`${id}-ticks`}
                value={charts.stationTickM === null ? 'auto' : String(charts.stationTickM)}
                onChange={(event) =>
                  setCharts({ stationTickM: event.target.value === 'auto' ? null : Number(event.target.value) })
                }
              >
                <option value="auto">Automatic</option>
                {CHART_STATION_TICKS.map((tick) => (
                  <option key={tick} value={String(tick)}>
                    {tick} m
                  </option>
                ))}
              </StyledSelect>
            </div>
            <div className="grid gap-1">
              <label htmlFor={`${id}-interval`} className="font-medium">
                Statistics every
              </label>
              <StyledSelect
                id={`${id}-interval`}
                value={charts.intervalM ? String(charts.intervalM) : 'off'}
                onChange={(event) =>
                  setCharts({ intervalM: event.target.value === 'off' ? null : Number(event.target.value) })
                }
              >
                <option value="off">Off</option>
                {CHART_INTERVALS.map((interval) => (
                  <option key={interval} value={String(interval)}>
                    {interval} m
                  </option>
                ))}
              </StyledSelect>
            </div>
            <div className="grid gap-1">
              <label htmlFor={`${id}-interval-style`} className="font-medium">
                Statistics shown as
              </label>
              <StyledSelect
                id={`${id}-interval-style`}
                value={charts.intervalStyle ?? 'band'}
                disabled={!charts.intervalM}
                onChange={(event) => setCharts({ intervalStyle: event.target.value as ChartIntervalStyle })}
              >
                {CHART_INTERVAL_STYLES.map((style) => (
                  <option key={style} value={style}>
                    {INTERVAL_STYLE_LABELS[style]}
                  </option>
                ))}
              </StyledSelect>
            </div>
            <div className="grid gap-1">
              <label htmlFor={`${id}-interval-lines`} className="font-medium">
                Statistics for
              </label>
              <StyledSelect
                id={`${id}-interval-lines`}
                value={charts.intervalLines ?? 'design'}
                disabled={!charts.intervalM || (charts.intervalStyle ?? 'band') === 'band'}
                onChange={(event) => setCharts({ intervalLines: event.target.value as ChartIntervalLines })}
              >
                {CHART_INTERVAL_LINES.map((lines) => (
                  <option key={lines} value={lines}>
                    {INTERVAL_LINES_LABELS[lines]}
                  </option>
                ))}
              </StyledSelect>
            </div>
          </div>
        </section>
      )}
      {front === 'summary' && (
        <section className="space-y-1.5" data-testid="road-report-package-summary">
          <h5 className={heading}>On the summary page</h5>
          <div className="grid gap-x-3 gap-y-1.5 sm:grid-cols-2">
            {SUMMARY_SECTIONS.map((section) => (
              <CheckboxField
                key={section}
                label={SUMMARY_SECTION_LABELS[section]}
                checked={summaryShows(settings.package, section)}
                onCheckedChange={(checked) => save(withSummary(settings.package, { section: [section, checked] }))}
              />
            ))}
            <CheckboxField
              label="Include contingency in estimates and totals"
              checked={includesContingency(settings.package)}
              onCheckedChange={(contingency) => save(withSummary(settings.package, { contingency }))}
            />
          </div>
          <div className="grid gap-1.5 pt-1" data-testid="road-report-package-range">
            <div className="flex items-center gap-1.5">
              <CheckboxField
                label="Low, medium and high estimates"
                checked={!!settings.package?.range}
                onCheckedChange={(on) => save(withSummary(settings.package, { range: on }))}
              />
              <InfoTip label="About the estimate range">
                Each road priced three ways on copies of it, the estimate itself unchanged. Low: 1:1 fill wherever it
                closes a section, and the longer reach that closes the rest. Medium: each stretch&apos;s leading fix in
                Review (full bench on ground of 60% or more, else the 1:1 fill, else the reach). High: every fill
                stretch full-benched, and the stretches a slope sheet shows steeper. Medium and high add the
                cross-drains at your spacing and price; every level prices the surplus cut at your end-haul rate where a
                road has no haul rates of its own. A figure left blank is counted and named, never guessed.
              </InfoTip>
            </div>
            {settings.package?.range && <EstimateAllowances value={settings} onChange={onChange} />}
          </div>
          {slopeSheet && (
            <div className="grid gap-1 pt-1">
              <div className="flex items-center gap-1.5">
                <label htmlFor={`${id}-slope`} className="font-medium">
                  Slope sheet
                </label>
                <InfoTip label="About the slope sheet check">
                  The imported slope sheet set beside each road&apos;s estimate: the share of a ±20 m strip it prints at
                  60%+ against the share the estimate&apos;s ground shows, and the stretches where the sheet shows 15
                  points more steep ground. The high case prices those stretches full-benched on a copy of each road; it
                  is printed beside the estimate and never changes it. End haul is priced only where a road has haul
                  rates. The check is also a Review row in each road&apos;s report.
                </InfoTip>
              </div>
              <StyledSelect
                id={`${id}-slope`}
                value={slopeSheetMode(settings.package)}
                onChange={(event) =>
                  save(withSummary(settings.package, { slopeSheet: event.target.value as SlopeSheetMode }))
                }
              >
                {SLOPE_SHEET_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {SLOPE_SHEET_MODE_LABELS[mode]}
                  </option>
                ))}
              </StyledSelect>
            </div>
          )}
        </section>
      )}
      {GROUPS.map((group) => (
        <section key={group} className="space-y-1.5">
          <h5 className={heading}>{PACKAGE_GROUP_LABELS[group]}</h5>
          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {PACKAGE_PARTS.filter((part) => part.group === group).map((part) => {
              const placement = placementOf(settings.package, part.id)
              return (
                <div key={part.id} className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <label htmlFor={`${id}-${part.id}`} className="truncate" title={part.label}>
                    {part.label}
                  </label>
                  <StyledSelect
                    id={`${id}-${part.id}`}
                    value={placement}
                    onChange={(event) => set(part, event.target.value as PackagePlacement)}
                    aria-label={`${part.label}: where it goes`}
                  >
                    {PACKAGE_PLACEMENTS.map((option) => (
                      <option key={option} value={option}>
                        {PLACEMENT_LABELS[option]}
                        {option === defaultPlacement(part.id) ? ' (default)' : ''}
                      </option>
                    ))}
                  </StyledSelect>
                </div>
              )
            })}
          </div>
        </section>
      ))}
      <p className="text-muted-foreground">
        {plan.appendices.length
          ? `The package and ${plan.appendices.length} appendix PDF${plan.appendices.length === 1 ? '' : 's'}; ${plan.omitted.length} part${plan.omitted.length === 1 ? '' : 's'} left out.`
          : `One PDF; ${plan.omitted.length} part${plan.omitted.length === 1 ? '' : 's'} left out.`}
      </p>
    </div>
  )
}
