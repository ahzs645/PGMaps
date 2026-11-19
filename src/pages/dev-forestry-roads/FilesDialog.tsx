import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ROAD_TOUR_ANCHORS, roadFilesOutputAnchor } from './tours/roadTour'
import { Download } from 'lucide-react'
import { PreparerProfileHostProvider, PreparerProfilePane, PreparerProfileRow } from '@/branding/PreparerProfile'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { SaveAsButton, type SaveAsButtonProps } from '@/components/ui/save-as-button'
import { ResultRow } from '@/components/ui/result-list'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StyledSelect } from '@/components/ui/styled-select'
import { Field, roadFieldClass } from './Controls'
import {
  EXPORT_GROUP_LABELS,
  EXPORT_ITEMS,
  exportFamilyOf,
  exportStampNote,
  exportUnavailable,
  MULTI_ROAD_EXPORTS,
  STAMPED_EXPORTS,
  type ExportContext,
  type ExportGroup,
  type ExportPreview,
  type RoadExport,
  type RoadScope,
} from './exportCatalog'
import { ExportPreviewView, type PreviewScroll } from './ExportPreview'
import { IssueStampEditor } from './IssueStampEditor'
import { issueLine, issueStamp, type ProjectIssue } from './projectIssue'
import type { RoadReportSettings } from './reportSettings'
import { ReportSettingsEditor } from './ReportSettingsEditor'
import type { BlockSheetSettings } from './blockSheet'
import type { PreviewPick } from './previewPick'
import { reportPartHeadings, type ReportSectionsUnavailable } from './reportContents'
import { ReportContentsEditor } from './ReportContentsEditor'
import { ReportPackageEditor } from './ReportPackageEditor'
import { EstimateSettingsEditor } from './EstimateSettingsEditor'
import { SheetSetupLibrary } from './SheetSetupLibrary'
import { insetBox } from '@/components/ui/inset-box'
import { useElementSize } from '@/hooks/useElementSize'
import { useSizeFold } from '@/hooks/useSizeFold'
import { cn } from '@/lib/utils'

export type { RoadExport } from './exportCatalog'

const GROUPS = Object.keys(EXPORT_GROUP_LABELS) as ExportGroup[]
// Edits in Sheet setup rebuild the plot book; a short pause keeps typing from rebuilding it per key.
const PREVIEW_DELAY_MS = 250
/**
 * Where the output's pane puts its settings beside its preview: from about 900 px, which the dialog has at its
 * widest normal size and at Full screen. The gap keeps a pane dragged across the line from flipping.
 */
const SIDE_BY_SIDE_FOLD = { foldBelow: 860, unfoldFrom: 900 }
/** The dialog at its normal size: wide enough for settings and a preview side by side on a laptop screen. */
const DIALOG_MAX_WIDTH = 'min(80rem, calc(100vw - 2rem))'

/** A road name short enough for a choice chip; the whole name is in the header's road switcher. */
const clipName = (name: string) => (name.length > 30 ? `${name.slice(0, 29)}…` : name)

/** What Save as… needs for one output: the name and type offered, the build, and what to do after. */
export type FilesSaveAs = Pick<SaveAsButtonProps, 'suggestedName' | 'fileType' | 'content' | 'onResult' | 'onError'>

type PreviewResult =
  | { request: object; preview: ExportPreview; error?: undefined }
  | { request: object; preview?: undefined; error: string }

/**
 * Every output in one list, grouped, with the selected one previewed beside it from the same content
 * its download writes. Phones stack the preview under the list.
 */
export function FilesDialog({
  open,
  initialOutput = 'project',
  onOpenChange,
  name,
  onName,
  onSave,
  busy,
  portalContainer,
  reportSettings,
  onReportSettings,
  reportUnavailable,
  slopeSheet,
  issue,
  onIssue,
  today = '',
  roads,
  baselineRoads,
  roadScope = 'active',
  onRoadScope,
  context,
  buildPreview,
  previewVersion,
  setupViews,
  setupLabels,
  outputOptions,
  saveAs,
  blockSheetSettings,
  selected: controlledSelected,
  onSelectedChange,
}: {
  open: boolean
  initialOutput?: RoadExport
  onOpenChange: (open: boolean) => void
  name: string
  onName: (name: string) => void
  onSave: (kind: RoadExport) => void
  busy: boolean
  portalContainer?: HTMLElement | null
  reportSettings?: RoadReportSettings
  onReportSettings?: (settings: RoadReportSettings) => void
  /** Why a report section has nothing to print for the shown road, for the report's contents list. */
  reportUnavailable?: ReportSectionsUnavailable
  /** The project has an imported slope sheet (the report package can check estimates against it). */
  slopeSheet?: boolean
  /** The project's issue stamp, printed on the report, the map PDF and the plot book. */
  issue?: ProjectIssue
  onIssue?: (issue: ProjectIssue) => void
  /** The day the dialog was opened (YYYY-MM-DD), printed while the stamp has no date of its own. */
  today?: string
  /** The project's roads, for outputs that can hold one or all of them. */
  roads?: { count: number; activeName: string }
  /** The other roads, one of which may hold the issued design for the report's record of changes. */
  baselineRoads?: { id: string; name: string }[]
  /** The road scope each output uses: a report package starts with every road. */
  roadScope?: RoadScope | ((kind: RoadExport) => RoadScope)
  onRoadScope?: (scope: RoadScope, kind: RoadExport) => void
  context: ExportContext
  /** Builds one output's preview; `signal` aborts when the selection or project changes. */
  buildPreview: (kind: RoadExport, signal: AbortSignal) => Promise<ExportPreview>
  /** Changes whenever the content would: the project, its results or the shown road. */
  previewVersion: unknown
  /** A Sheet setup view for outputs other than the plot book, e.g. the block map sheet. */
  setupViews?: Partial<Record<RoadExport, ReactNode>>
  /** The setup view's tab caption where it is not "Sheet setup", e.g. "Styles". */
  setupLabels?: Partial<Record<RoadExport, string>>
  /** Choices shown above an output's preview, such as the 3D model's format. */
  outputOptions?: Partial<Record<RoadExport, ReactNode>>
  /**
   * Save as… beside Download for an output, or null where it is offered on Download only. It is
   * hidden where the browser has no save dialog, since it would only repeat Download.
   */
  saveAs?: (kind: RoadExport) => FilesSaveAs | null
  /** The block sheet's settings, so a saved sheet setup can be saved from and applied to it. */
  blockSheetSettings?: { value: BlockSheetSettings; onApply: (settings: BlockSheetSettings) => void }
  /** The output shown, when the page follows it (a live lesson reads it); otherwise the dialog keeps its own. */
  selected?: RoadExport
  onSelectedChange?: (kind: RoadExport) => void
}) {
  const [ownSelected, setOwnSelected] = useState<RoadExport>(initialOutput)
  const selected = controlledSelected ?? ownSelected
  const setSelected = (kind: RoadExport) => {
    setOwnSelected(kind)
    onSelectedChange?.(kind)
  }
  const [view, setView] = useState<'preview' | 'setup' | 'issue'>('preview')
  // The format last chosen in each format family (`EXPORT_FORMAT_FAMILIES`), by the family's name: its row opens on it.
  const [familyChoice, setFamilyChoice] = useState<Record<string, RoadExport>>({})
  // *Your details* are open in place of the output's pane (`PreparerProfilePane`, kept mounted while the dialog is).
  const [detailsOpen, setDetailsOpen] = useState(false)
  // The part of the setup a click on the preview asked for: a plot-book chapter or a report section.
  const [setupFocus, setSetupFocus] = useState<{ chapter?: string; section?: string } | null>(null)
  // The report contents row whose part the preview beside the list shows.
  const [contentsPart, setContentsPart] = useState<string | null>(null)
  // Open on the requested deliverable, including when the previous session used another file.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      // Not `setSelected`: a page that follows the selection sets its own when it opens the dialog.
      setOwnSelected(initialOutput)
      setView('preview')
      setDetailsOpen(false)
    }
  }
  const item = EXPORT_ITEMS.find((entry) => entry.kind === selected) ?? EXPORT_ITEMS[0]
  const family = exportFamilyOf(item.kind)
  /** The output a family's row opens: the format last chosen in it, else its first. */
  const familyShown = (of: NonNullable<ReturnType<typeof exportFamilyOf>>) =>
    of.members.some((member) => member.kind === item.kind) ? item.kind : (familyChoice[of.label] ?? of.members[0].kind)
  const unavailable = exportUnavailable(item.kind, context)
  const stampNote = exportStampNote(item.kind, context)
  const stamped = STAMPED_EXPORTS.includes(item.kind) && !!onIssue
  const setupView = setupViews?.[item.kind]
  const reportContents = item.kind === 'report' || item.kind === 'report-pdf'
  const plotBook = item.kind === 'plotbook' || item.kind === 'plotbook-pdf'
  const reportPackage = item.kind === 'report-package'
  const estimate = item.kind === 'estimate-pdf'
  const setupAvailable =
    ((plotBook || reportContents || reportPackage || estimate) && !!onReportSettings) || !!setupView
  // A view the selected output does not have falls back to its preview.
  const shownView =
    view === 'setup' ? (setupAvailable ? view : 'preview') : view === 'issue' && !stamped ? 'preview' : view
  // Settings beside the file once the pane has room for both (a wide window or Full screen): the setup or the issue
  // stamp on the left, the file's own preview on the right, and no Preview tab. Narrower, they are tabs.
  // The pane mounts with the dialog's content, after this component: measured as an element, not a ref read on mount.
  const pane = useRef<HTMLElement | null>(null)
  const [paneElement, setPaneElement] = useState<HTMLElement | null>(null)
  const { width: paneWidth } = useElementSize(paneElement)
  const narrowPane = useSizeFold(paneWidth, SIDE_BY_SIDE_FOLD, true)
  const sideBySide = !narrowPane && (setupAvailable || stamped)
  // The view of the settings: side by side it is never the preview, which has its own column.
  const formView: 'preview' | 'setup' | 'issue' = !sideBySide
    ? shownView
    : shownView !== 'preview'
      ? shownView
      : setupAvailable
        ? 'setup'
        : 'issue'
  const settingUp = formView !== 'preview'
  const chooseRoads = MULTI_ROAD_EXPORTS.includes(item.kind) && !!onRoadScope && (roads?.count ?? 0) > 1
  const saveAsSpec = saveAs?.(item.kind) ?? null
  // The contents views draw their preview beside the list: the instant HTML report (also for the
  // report PDF, whose own preview takes seconds) or the package's file list. Other setups have none.
  // Side by side the preview column shows the file itself, in the chosen format.
  const contentsPreviewKind: RoadExport | null =
    !sideBySide && formView === 'setup' && onReportSettings
      ? reportContents
        ? 'report'
        : reportPackage
          ? 'report-package'
          : null
      : null
  const previewKind = settingUp && !sideBySide ? contentsPreviewKind : item.kind
  const previewUnavailable = previewKind ? exportUnavailable(previewKind, context) : null
  // A new object per selection or content change: a preview is current only for its own request.
  const [request, setRequest] = useState(() => (previewKind ? { kind: previewKind, version: previewVersion } : null))
  if ((request?.kind ?? null) !== previewKind || (request && request.version !== previewVersion))
    setRequest(previewKind ? { kind: previewKind, version: previewVersion } : null)
  const [result, setResult] = useState<PreviewResult | null>(null)
  const latestBuild = useRef(buildPreview)
  useEffect(() => {
    latestBuild.current = buildPreview
  })
  const stamp = issueStamp(issue, today ? new Date(`${today}T12:00:00`) : undefined)
  useEffect(() => {
    if (!open || !request || previewUnavailable) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      latestBuild
        .current(request.kind, controller.signal)
        .then((preview) => !controller.signal.aborted && setResult({ request, preview }))
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setResult({ request, error: error instanceof Error ? error.message : 'Could not prepare a preview.' })
        })
    }, PREVIEW_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, request, previewUnavailable])
  const current = result?.request === request ? result : null
  const detailsPane = useRef<HTMLElement>(null)
  const openDetails = () => {
    setDetailsOpen(true)
    requestAnimationFrame(() => detailsPane.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }
  // Saved sheet setups sit above the plot book's and the block sheet's own setup.
  const setupLibrary =
    plotBook || item.kind === 'block-sheet-pdf' ? (
      <SheetSetupLibrary plotBook={reportSettings} onPlotBook={onReportSettings} blockSheet={blockSheetSettings} />
    ) : null
  /** A click on a part of the preview opens that part's settings, where the output has them. */
  const pick = (target: PreviewPick) => {
    if (target.view === 'issue' && stamped) setView('issue')
    else if (target.view === 'setup' && setupAvailable) {
      setSetupFocus({ chapter: target.chapter, section: target.section })
      // A report heading selects its row, so the preview beside the contents list stays on that part.
      if (target.section && reportContents) setContentsPart(target.section)
      setView('setup')
    }
  }
  const select = (kind: RoadExport) => {
    setSelected(kind)
    setSetupFocus(null)
    setContentsPart(null)
    setDetailsOpen(false)
    // Stacked on a phone, the preview sits under the list; bring it up. Side by side this does nothing.
    requestAnimationFrame(() => pane.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }
  /** Another format of the same document: the view, the setup's place and the contents row stay as they are. */
  const chooseFormat = (kind: RoadExport) => {
    const of = exportFamilyOf(kind)
    if (of) setFamilyChoice((current) => ({ ...current, [of.label]: kind }))
    setSelected(kind)
  }
  // The live preview beside a contents list, kept on the selected part as it is rebuilt.
  const contentsScroll: PreviewScroll = { headings: contentsPart ? reportPartHeadings(contentsPart) : null }
  const contentsPreview = contentsPreviewKind ? (
    previewUnavailable ? (
      <p className={cn(insetBox({ padding: 'lg' }), 'border-dashed text-xs text-muted-foreground')}>
        {previewUnavailable}
      </p>
    ) : current?.preview ? (
      <ExportPreviewView
        preview={current.preview}
        title={item.label}
        onPick={pick}
        scrollTo={reportContents ? contentsScroll : { headings: null }}
      />
    ) : current?.error ? (
      <p
        role="alert"
        className="rounded-md border border-warning-border bg-warning-surface p-3 text-xs text-warning-foreground"
      >
        {current.error}
      </p>
    ) : (
      <p className="p-4 text-xs text-muted-foreground" aria-live="polite">
        Preparing preview…
      </p>
    )
  ) : undefined
  // The output's settings: its setup, or its issue stamp.
  const form =
    formView === 'issue' && onIssue ? (
      <IssueStampEditor
        value={issue}
        onChange={onIssue}
        today={stamp.date}
        reportSettings={reportSettings}
        onReportSettings={onReportSettings}
      />
    ) : formView === 'setup' && setupView ? (
      <div className="grid gap-3">
        {setupLibrary}
        {setupView}
      </div>
    ) : formView === 'setup' && onReportSettings && estimate ? (
      <EstimateSettingsEditor value={reportSettings} onChange={onReportSettings} />
    ) : formView === 'setup' && onReportSettings && reportPackage ? (
      <ReportPackageEditor
        value={reportSettings}
        onChange={onReportSettings}
        slopeSheet={slopeSheet}
        preview={sideBySide ? undefined : contentsPreview}
      />
    ) : formView === 'setup' && onReportSettings && reportContents ? (
      <ReportContentsEditor
        value={reportSettings}
        baselineRoads={baselineRoads}
        onChange={onReportSettings}
        focus={setupFocus?.section}
        unavailable={reportUnavailable}
        preview={sideBySide ? undefined : contentsPreview}
        selected={contentsPart}
        onSelect={setContentsPart}
      />
    ) : formView === 'setup' && onReportSettings ? (
      <div className="grid gap-3">
        {setupLibrary}
        <ReportSettingsEditor
          key={setupFocus?.chapter ?? ''}
          value={reportSettings}
          onChange={onReportSettings}
          initialChapter={setupFocus?.chapter}
        />
      </div>
    ) : null
  // The file itself, from the same content its download writes.
  const filePreview = unavailable ? (
    <p className={cn(insetBox({ padding: 'lg' }), 'border-dashed text-xs text-muted-foreground')}>{unavailable}</p>
  ) : current?.preview ? (
    <ExportPreviewView
      preview={current.preview}
      title={item.label}
      onPick={setupAvailable ? pick : undefined}
      {...(sideBySide && reportContents ? { scrollTo: contentsScroll } : {})}
    />
  ) : current?.error ? (
    <p
      role="alert"
      className="rounded-md border border-warning-border bg-warning-surface p-3 text-xs text-warning-foreground"
    >
      {current.error}
    </p>
  ) : (
    <p className="p-4 text-xs text-muted-foreground" aria-live="polite">
      Preparing preview…
    </p>
  )
  // The toolkit's `workspace-*` variants are not built for app classes, so the layout uses `sm:`, which
  // matches the dialog's own breakpoint in this workspace. `workspace-sm:p-0` only overrides its padding.
  return (
    <PanelDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Save & export"
      size="xl"
      expandable
      portalContainer={portalContainer}
      className="sm:h-[min(48rem,92dvh)]"
      bodyClassName="p-0 workspace-sm:p-0"
      contentProps={{
        'data-testid': 'road-files-dialog',
        'data-tutorial-id': ROAD_TOUR_ANCHORS.files,
        style: { maxWidth: DIALOG_MAX_WIDTH },
      }}
    >
      {/* The row opens the pane below, not a second modal. */}
      <PreparerProfileHostProvider value={{ open: openDetails, shown: detailsOpen }}>
        <fieldset disabled={busy} className="min-w-0 sm:h-full sm:min-h-0">
          {/* A floor on the side-by-side layout: on a short screen the dialog body scrolls instead of the
            pane shrinking until its controls are clipped. Stacked on a phone the one column is held to
            the dialog's width: an implicit column grew to a list row's untruncated subtitle. */}
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] sm:h-full sm:min-h-[24rem] sm:grid-cols-[15rem_minmax(0,1fr)]">
            <nav
              aria-label="Files"
              className="border-b border-border py-1 sm:min-h-0 sm:overflow-y-auto overscroll-none sm:border-b-0 sm:border-r"
            >
              <PreparerProfileRow portalContainer={portalContainer} />
              {GROUPS.map((group) => (
                <div key={group}>
                  <h3 className="px-3 pb-1 pt-3 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {EXPORT_GROUP_LABELS[group]}
                  </h3>
                  {EXPORT_ITEMS.filter((entry) => entry.group === group).map((entry) => {
                    // A format family is one row, where its first member is listed, under the family's name.
                    const of = exportFamilyOf(entry.kind)
                    if (of && of.members[0].kind !== entry.kind) return null
                    const shownKind = of ? familyShown(of) : entry.kind
                    const shown = EXPORT_ITEMS.find((candidate) => candidate.kind === shownKind) ?? entry
                    const label = of?.label ?? entry.label
                    const reason = exportUnavailable(shown.kind, context)
                    return (
                      <ResultRow
                        key={entry.kind}
                        accent="teal"
                        selected={!detailsOpen && (of ? of === family : entry.kind === item.kind)}
                        title={label}
                        subtitle={
                          reason ??
                          (exportStampNote(shown.kind, context) ? 'Stamped: leaves out an invalid input' : undefined)
                        }
                        trailing={<span className="text-3xs font-normal text-muted-foreground">{shown.extension}</span>}
                        className={`py-2 ${reason ? '[&_span]:text-muted-foreground' : ''}`}
                        aria-label={reason ? `${label}, unavailable: ${reason}` : label}
                        data-tutorial-id={roadFilesOutputAnchor(shown.kind)}
                        onClick={() => select(shown.kind)}
                      />
                    )
                  })}
                </div>
              ))}
            </nav>
            <PreparerProfilePane hidden={!detailsOpen} sectionRef={detailsPane} />
            {/* Kept mounted under Your details, so the preview is ready on the way back. */}
            <section
              ref={(element) => {
                pane.current = element
                setPaneElement(element)
              }}
              aria-label={`${item.label} preview`}
              hidden={detailsOpen}
              className={`${detailsOpen ? 'hidden' : 'flex'} min-w-0 flex-col gap-3 p-3 sm:min-h-0 sm:p-5`}
            >
              <div className="flex items-start justify-between gap-3">
                {/* One line: what the output is sits behind the (i), as on the visual quality page's dialog. */}
                <div className="flex min-w-0 items-center gap-1.5">
                  <h3 className="min-w-0 truncate text-sm font-semibold">
                    {family?.label ?? item.label}{' '}
                    <span className="font-normal text-muted-foreground">{item.extension}</span>
                  </h3>
                  {item.description && (
                    <InfoTip label={`About ${family?.label ?? item.label}`}>{item.description}</InfoTip>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-start justify-end gap-2">
                  {saveAsSpec && (
                    // Keyed by output, so a "Saved" or a failure beside it does not follow to the next one.
                    <SaveAsButton
                      key={item.kind}
                      {...saveAsSpec}
                      rememberFolderAs="pgmaps-road-exports"
                      size="default"
                      disabled={!!unavailable}
                      aria-label={`Save ${item.kind === 'project' ? 'project JSON' : item.label} as…`}
                    />
                  )}
                  <Button
                    className="shrink-0"
                    disabled={!!unavailable}
                    aria-label={item.kind === 'project' ? 'Save project JSON' : `Download ${item.label}`}
                    data-tutorial-id={ROAD_TOUR_ANCHORS.filesSave}
                    onClick={() => onSave(item.kind)}
                  >
                    <Download className="size-4" />
                    {item.kind === 'project' ? 'Save' : 'Download'}
                  </Button>
                </div>
              </div>
              {/* The name every file is saved under; opening and importing files live in Projects and Design. */}
              {item.kind === 'project' && (
                <Field label="Project name">
                  <input
                    className={roadFieldClass}
                    value={name}
                    maxLength={200}
                    onChange={(event) => onName(event.target.value)}
                  />
                </Field>
              )}
              {(stamped || setupAvailable || family) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {(stamped || setupAvailable) && (
                    <SegmentedControl
                      size="sm"
                      fullWidth={false}
                      label={`${item.label} view`}
                      value={formView}
                      onChange={setView}
                      options={[
                        ...(sideBySide ? [] : [{ value: 'preview' as const, label: 'Preview' }]),
                        ...(setupAvailable
                          ? [
                              {
                                value: 'setup' as const,
                                label:
                                  reportContents || reportPackage
                                    ? 'Contents'
                                    : estimate
                                      ? 'Allowances'
                                      : (setupLabels?.[item.kind] ?? 'Sheet setup'),
                              },
                            ]
                          : []),
                        ...(stamped ? [{ value: 'issue' as const, label: 'Issue stamp' }] : []),
                      ]}
                    />
                  )}
                  {family && (
                    <StyledSelect
                      aria-label={`${family.label} format`}
                      className="w-auto max-w-full rounded-md border bg-background px-2 py-1 text-xs"
                      value={item.kind}
                      onValueChange={(kind) => chooseFormat(kind as RoadExport)}
                      options={family.members.map((member) => ({ value: member.kind, label: member.format }))}
                    />
                  )}
                  {stamped && today && (
                    <span
                      className={`text-xs ${stamp.missing.length ? 'text-warning' : 'text-muted-foreground'}`}
                      data-testid="road-issue-line"
                    >
                      {issueLine(stamp, 'stated')}
                    </span>
                  )}
                </div>
              )}
              {chooseRoads && (
                <SegmentedControl
                  size="sm"
                  fullWidth={false}
                  label="Roads in this file"
                  value={typeof roadScope === 'function' ? roadScope(item.kind) : roadScope}
                  onChange={(scope) => onRoadScope?.(scope, item.kind)}
                  options={[
                    { value: 'active' as const, label: `This road: ${clipName(roads?.activeName ?? '')}` },
                    { value: 'all' as const, label: `All ${roads?.count} roads` },
                  ]}
                />
              )}
              {outputOptions?.[item.kind]}
              {stampNote && (
                <p
                  role="status"
                  className="rounded-md border border-warning-border bg-warning-surface p-2 text-xs text-warning-foreground"
                  data-testid="road-export-stamp-note"
                >
                  {stampNote}
                </p>
              )}
              {/* The settings and the file: side by side, each scrolls in its column; as tabs, the one shown scrolls in the
                  pane; stacked on a phone it flows with the dialog. */}
              {sideBySide ? (
                <div
                  className="grid min-h-0 flex-1 grid-cols-[minmax(20rem,2fr)_minmax(0,3fr)] gap-4"
                  data-layout="side-by-side"
                >
                  <div className="min-h-0 min-w-0 overflow-y-auto overscroll-none pr-1">{form}</div>
                  <div className="min-h-0 min-w-0" aria-label={`${item.label} file`} role="group">
                    {filePreview}
                  </div>
                </div>
              ) : (
                <div className="min-h-0 flex-1 sm:overflow-y-auto overscroll-none">
                  {settingUp ? form : filePreview}
                </div>
              )}
            </section>
          </div>
        </fieldset>
      </PreparerProfileHostProvider>
    </PanelDialog>
  )
}
