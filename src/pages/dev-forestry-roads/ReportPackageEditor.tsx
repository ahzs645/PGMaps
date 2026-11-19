import { useId, useState, type ReactNode } from 'react'
import { DocumentContents } from '@/components/ui/document-contents'
import { CheckboxField } from '@/components/ui/form-field'
import { useSavedContents } from '@/components/ui/use-saved-contents'
import type { ContentsChoice, ContentsGroup, ContentsPart } from '@/lib/documentContents/contents'
import { applySavedContents, matchingSavedContents, savedContentsPresets } from '@/lib/documentContents/savedContents'
import { EstimateAllowances } from './EstimateSettingsEditor'
import { InfoTip } from '@/components/ui/info-tip'
import { StyledSelect } from '@/components/ui/styled-select'
import { withSectionSequence } from './reportContents'
import {
  FRONT_LABELS,
  PACKAGE_FRONTS,
  PACKAGE_GROUP_LABELS,
  PACKAGE_PLACEMENTS,
  PACKAGE_PRESETS,
  PLACEMENT_LABELS,
  PRESET_LABELS,
  SLOPE_SHEET_MODES,
  SLOPE_SHEET_MODE_LABELS,
  SUMMARY_SECTIONS,
  SUMMARY_SECTION_LABELS,
  includesContingency,
  isDefaultPackage,
  orderedPackageParts,
  packageFront,
  packagePlan,
  packagePreset,
  placementOf,
  presetSettings,
  slopeSheetMode,
  summaryShows,
  withPackageOrder,
  withPlacement,
  withSummary,
  type PackageFront,
  type PackagePart,
  type PackagePartId,
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
const CONTENTS_GROUPS: readonly ContentsGroup[] = GROUPS.map((group) => ({
  id: group,
  title: PACKAGE_GROUP_LABELS[group],
}))
const CHOICES: readonly ContentsChoice[] = PACKAGE_PLACEMENTS.map((placement) => ({
  value: placement,
  label: PLACEMENT_LABELS[placement],
  included: placement !== 'omit',
}))
/** The browser's saved presets for the package's placements (`useSavedContents`). */
const PACKAGE_LIST_ID = 'road-report-package'

/**
 * What the report package holds (`DocumentContents`): every report section, plot-book chapter and
 * block sheet is in the package, in an appendix PDF of its own, or left out, listed in package order.
 * The report sections follow the report's own order (`sectionOrder`); the plot-book chapters and
 * block sheets keep the package's (`package.order`). Presets are Full and Simplified or the person's
 * own placements, kept in this browser. The front page, summary and chart options are the package's
 * own controls under the list. Saved with the project's report settings.
 */
export function ReportPackageEditor({
  value,
  onChange,
  slopeSheet = false,
  preview,
}: {
  value?: RoadReportSettings
  onChange: (settings: RoadReportSettings) => void
  /** The project has an imported slope sheet, so the summary can set it beside each estimate. */
  slopeSheet?: boolean
  /** The package's preview, drawn beside the list. */
  preview?: ReactNode
}) {
  const settings = value ?? createRoadReportSettings()
  const id = useId()
  const store = useSavedContents(PACKAGE_LIST_ID)
  // The preset last chosen here, so a later change reads as "modified" and Reset goes back to it.
  const [chosen, setChosen] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const write = (next: RoadReportSettings) => {
    if (!next.package || isDefaultPackage(next.package)) delete next.package
    if (!next.sectionOrder) delete next.sectionOrder
    onChange(parseRoadReportSettings(next))
  }
  const save = (pkg: ReportPackageSettings | undefined) => write({ ...settings, package: pkg })
  // The package's charts: the plot book's own charts chapter (or its defaults) under the package's choices.
  const charts: ChartsOptions = {
    ...chartsOptions(
      settings.chapters.find((chapter) => chapter.kind === 'charts') ?? createReportChapter('charts', 'charts'),
    ),
    ...settings.package?.charts,
  }
  const setCharts = (changes: Partial<ChartsOptions>) => save(withSummary(settings.package, { charts: changes }))
  const front = packageFront(settings.package)
  const plan = packagePlan(settings.package, 'road', settings.sectionOrder)
  const parts: ContentsPart[] = orderedPackageParts(settings.package, settings.sectionOrder).map((part) => ({
    key: part.id,
    label: part.label,
    group: part.group,
    state: placementOf(settings.package, part.id),
  }))
  const builtIn = PACKAGE_PRESETS.map((preset) => ({ id: preset, label: PRESET_LABELS[preset] }))
  const savedPresets = savedContentsPresets(store.saved)
  const ownPreset = packagePreset(settings.package)
  const match = ownPreset !== 'custom' ? ownPreset : matchingSavedContents(store.saved, parts, CHOICES)
  const chosenExists = !!chosen && [...builtIn, ...savedPresets].some((preset) => preset.id === chosen)
  const apply = (presetId: string) => {
    if ((PACKAGE_PRESETS as readonly string[]).includes(presetId)) {
      setNote(null)
      save(
        presetSettings(
          presetId as PackagePreset,
          includesContingency(settings.package),
          slopeSheetMode(settings.package),
          settings.package?.range,
          settings.package?.order,
        ),
      )
      return
    }
    const saved = store.saved.find((preset) => preset.id === presetId)
    if (!saved) return
    const applied = applySavedContents(saved, parts, CHOICES)
    setNote(
      applied.unknown.length
        ? `This preset names ${applied.unknown.length === 1 ? 'a part' : `${applied.unknown.length} parts`} this version does not have (${applied.unknown.join(', ')}); left as they are.`
        : null,
    )
    let pkg = settings.package
    for (const [key, placement] of Object.entries(applied.states))
      pkg = withPlacement(pkg, key as PackagePartId, placement as PackagePlacement)
    save(pkg)
  }
  const heading = 'text-3xs font-semibold uppercase tracking-wide text-muted-foreground'
  const frontField = (
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
  )
  const summaryOptions = front === 'summary' && (
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
            Each road priced three ways on copies of it, the estimate itself unchanged. Low: 1:1 fill wherever it closes
            a section, and the longer reach that closes the rest. Medium: each stretch&apos;s leading fix in Review
            (full bench on ground of 60% or more, else the 1:1 fill, else the reach). High: every fill stretch
            full-benched, and the stretches a slope sheet shows steeper. Medium and high add the cross-drains at your
            spacing and price; every level prices the surplus cut at your end-haul rate where a road has no haul rates
            of its own. A figure left blank is counted and named, never guessed.
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
              60%+ against the share the estimate&apos;s ground shows, and the stretches where the sheet shows 15 points
              more steep ground. The high case prices those stretches full-benched on a copy of each road; it is printed
              beside the estimate and never changes it. End haul is priced only where a road has haul rates. The check
              is also a Review row in each road&apos;s report.
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
  )
  const chartOptions = placementOf(settings.package, 'plotbook:charts') !== 'omit' && (
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
  )
  return (
    <DocumentContents
      data-testid="road-report-package"
      subject="the package"
      className="h-full"
      parts={parts}
      groups={CONTENTS_GROUPS}
      choices={CHOICES}
      stateLabel="where it goes"
      onState={(key, placement) =>
        save(withPlacement(settings.package, key as PackagePartId, placement as PackagePlacement))
      }
      onMove={(key, _to, order) =>
        key.startsWith('report:')
          ? write({
              ...settings,
              sectionOrder: withSectionSequence(
                settings.sectionOrder,
                order.filter((part) => part.startsWith('report:')).map((part) => part.slice('report:'.length)),
              ),
            })
          : save(withPackageOrder(settings.package, order))
      }
      presets={{
        options: [...builtIn, ...savedPresets],
        value: match ?? (chosenExists ? chosen : null),
        modified: !match && chosenExists,
        onChoose: (presetId) => {
          setChosen(presetId)
          apply(presetId)
        },
        onReset: () => {
          if (chosenExists) apply(chosen!)
          else {
            setNote(null)
            save(undefined)
          }
        },
        onSaveAs: (name) => {
          const result = store.save(name, Object.fromEntries(parts.map((part) => [part.key, part.state])))
          if ('error' in result) setNote(result.error)
          else {
            setNote(null)
            setChosen(result.preset.id)
          }
        },
        onDelete: (presetId) => {
          store.remove(presetId)
          if (chosen === presetId) setChosen(null)
        },
      }}
      preview={preview}
      previewLabel="Whole package"
      summary={
        plan.appendices.length
          ? `The package and ${plan.appendices.length} appendix PDF${plan.appendices.length === 1 ? '' : 's'}; ${plan.omitted.length} part${plan.omitted.length === 1 ? '' : 's'} left out.`
          : `One PDF; ${plan.omitted.length} part${plan.omitted.length === 1 ? '' : 's'} left out.`
      }
      help={
        <>
          Each part is in the package, in an appendix PDF of its own, or left out. Report sections and plot-book
          chapters print for every road in the package; a block sheet prints once. Report sections print in the
          report&apos;s order, and moving one here moves it in the report too. Plot-book chapters use the plot
          book&apos;s Sheet setup for that kind of chapter when it has one. The main PDF opens with a cover whose
          contents give the page each part starts on, or with a summary of the roads; each appendix opens with a cover.
          More than one PDF downloads as a zip. Simplified prints the summary and each road&apos;s profile, grade and
          mass-haul sheet: one or two pages for one road. Reset goes back to the chosen preset, or to every default.
          Your own presets keep the placements only and are kept in this browser.
        </>
      }
      beside={
        <div className="space-y-4">
          {(note ?? store.writeError) && <p className="text-2xs text-warning">{note ?? store.writeError}</p>}
          {frontField}
          {summaryOptions}
          {chartOptions}
        </div>
      }
    />
  )
}
