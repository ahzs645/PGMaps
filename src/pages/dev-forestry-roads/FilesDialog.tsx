import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Download, FolderOpen, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { ResultRow } from '@/components/ui/result-list'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Field, roadFieldClass } from './Controls'
import type { FileKind } from './DesignSidebarBody'
import {
  EXPORT_GROUP_LABELS,
  EXPORT_ITEMS,
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
import { ExportPreviewView } from './ExportPreview'
import { IssueStampEditor } from './IssueStampEditor'
import { issueLine, issueStamp, type ProjectIssue } from './projectIssue'
import type { RoadReportSettings } from './reportSettings'
import { ReportSettingsEditor } from './ReportSettingsEditor'
import type { BlockSheetSettings } from './blockSheet'
import type { PreviewPick } from './previewPick'
import type { ReportSectionId } from './reportContents'
import { ReportContentsEditor } from './ReportContentsEditor'
import { SheetSetupLibrary } from './SheetSetupLibrary'

export type { RoadExport } from './exportCatalog'

const GROUPS = Object.keys(EXPORT_GROUP_LABELS) as ExportGroup[]
// Edits in Sheet setup rebuild the plot book; a short pause keeps typing from rebuilding it per key.
const PREVIEW_DELAY_MS = 250

/** A road name short enough for a choice chip; the whole name is in the header's road switcher. */
const clipName = (name: string) => (name.length > 30 ? `${name.slice(0, 29)}…` : name)

type PreviewResult =
  | { request: object; preview: ExportPreview; error?: undefined }
  | { request: object; preview?: undefined; error: string }

/**
 * Every output in one list, grouped, with the selected one previewed beside it from the same content
 * its download writes. Phones stack the preview under the list.
 */
export function FilesDialog({
  open,
  onOpenChange,
  name,
  onName,
  onFile,
  onSave,
  busy,
  portalContainer,
  reportSettings,
  onReportSettings,
  issue,
  onIssue,
  today = '',
  roads,
  roadScope = 'active',
  onRoadScope,
  context,
  buildPreview,
  previewVersion,
  setupViews,
  blockSheetSettings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  onName: (name: string) => void
  onFile: (kind: FileKind) => void
  onSave: (kind: RoadExport) => void
  busy: boolean
  portalContainer?: HTMLElement | null
  reportSettings?: RoadReportSettings
  onReportSettings?: (settings: RoadReportSettings) => void
  /** The project's issue stamp, printed on the report, the map PDF and the plot book. */
  issue?: ProjectIssue
  onIssue?: (issue: ProjectIssue) => void
  /** The day the dialog was opened (YYYY-MM-DD), printed while the stamp has no date of its own. */
  today?: string
  /** The project's roads, for outputs that can hold one or all of them. */
  roads?: { count: number; activeName: string }
  roadScope?: RoadScope
  onRoadScope?: (scope: RoadScope) => void
  context: ExportContext
  /** Builds one output's preview; `signal` aborts when the selection or project changes. */
  buildPreview: (kind: RoadExport, signal: AbortSignal) => Promise<ExportPreview>
  /** Changes whenever the content would: the project, its results or the shown road. */
  previewVersion: unknown
  /** A Sheet setup view for outputs other than the plot book, e.g. the block map sheet. */
  setupViews?: Partial<Record<RoadExport, ReactNode>>
  /** The block sheet's settings, so a saved sheet setup can be saved from and applied to it. */
  blockSheetSettings?: { value: BlockSheetSettings; onApply: (settings: BlockSheetSettings) => void }
}) {
  const [selected, setSelected] = useState<RoadExport>('project')
  const [view, setView] = useState<'preview' | 'setup' | 'issue'>('preview')
  // The part of the setup a click on the preview asked for: a plot-book chapter or a report section.
  const [setupFocus, setSetupFocus] = useState<{ chapter?: string; section?: ReportSectionId } | null>(null)
  // Each opening starts on the project file, which the header's Save button is for.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSelected('project')
      setView('preview')
    }
  }
  const item = EXPORT_ITEMS.find((entry) => entry.kind === selected) ?? EXPORT_ITEMS[0]
  const unavailable = exportUnavailable(item.kind, context)
  const stampNote = exportStampNote(item.kind, context)
  const stamped = STAMPED_EXPORTS.includes(item.kind) && !!onIssue
  const setupView = setupViews?.[item.kind]
  const reportContents = item.kind === 'report' || item.kind === 'report-pdf'
  const setupAvailable = ((item.kind === 'plotbook' || reportContents) && !!onReportSettings) || !!setupView
  // A view the selected output does not have falls back to its preview.
  const shownView =
    view === 'setup' ? (setupAvailable ? view : 'preview') : view === 'issue' && !stamped ? 'preview' : view
  const settingUp = shownView !== 'preview'
  const chooseRoads = MULTI_ROAD_EXPORTS.includes(item.kind) && !!onRoadScope && (roads?.count ?? 0) > 1
  // A new object per selection or content change: a preview is current only for its own request.
  const request = useMemo(() => ({ kind: item.kind, version: previewVersion }), [item.kind, previewVersion])
  const [result, setResult] = useState<PreviewResult | null>(null)
  const latestBuild = useRef(buildPreview)
  useEffect(() => {
    latestBuild.current = buildPreview
  })
  const stamp = issueStamp(issue, today ? new Date(`${today}T12:00:00`) : undefined)
  useEffect(() => {
    if (!open || unavailable || settingUp) return
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
  }, [open, request, unavailable, settingUp])
  const current = result?.request === request ? result : null
  const pane = useRef<HTMLElement>(null)
  // Saved sheet setups sit above the plot book's and the block sheet's own setup.
  const setupLibrary =
    item.kind === 'plotbook' || item.kind === 'block-sheet-pdf' ? (
      <SheetSetupLibrary plotBook={reportSettings} onPlotBook={onReportSettings} blockSheet={blockSheetSettings} />
    ) : null
  /** A click on a part of the preview opens that part's settings, where the output has them. */
  const pick = (target: PreviewPick) => {
    if (target.view === 'issue' && stamped) setView('issue')
    else if (target.view === 'setup' && setupAvailable) {
      setSetupFocus({ chapter: target.chapter, section: target.section })
      setView('setup')
    }
  }
  const select = (kind: RoadExport) => {
    setSelected(kind)
    setSetupFocus(null)
    // Stacked on a phone, the preview sits under the list; bring it up. Side by side this does nothing.
    requestAnimationFrame(() => pane.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }
  const fileAction = (kind: FileKind) => {
    onOpenChange(false)
    onFile(kind)
  }
  // The toolkit's `workspace-*` variants are not built for app classes, so the layout uses `sm:`, which
  // matches the dialog's own breakpoint in this workspace. `workspace-sm:p-0` only overrides its padding.
  return (
    <PanelDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Save & export"
      subtitle="Pick a file to preview it, then download"
      size="xl"
      portalContainer={portalContainer}
      className="sm:h-[min(48rem,92dvh)]"
      bodyClassName="p-0 workspace-sm:p-0"
      toolbar={
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <Field label="Project name">
              <input
                className={roadFieldClass}
                value={name}
                maxLength={200}
                disabled={busy}
                onChange={(event) => onName(event.target.value)}
              />
            </Field>
          </div>
          <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={() => fileAction('project')}>
            <FolderOpen className="size-3.5" />
            Open project
          </Button>
          <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={() => fileAction('alignment')}>
            <Upload className="size-3.5" />
            Import road lines
          </Button>
          <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={() => fileAction('landxml')}>
            <Upload className="size-3.5" />
            Import LandXML alignment
          </Button>
        </div>
      }
      contentProps={{ 'data-testid': 'road-files-dialog' }}
    >
      <fieldset disabled={busy} className="min-w-0 sm:h-full sm:min-h-0">
        {/* A floor on the side-by-side layout: on a short screen the dialog body scrolls instead of the
            pane shrinking until its controls are clipped. */}
        <div className="grid min-w-0 sm:h-full sm:min-h-[24rem] sm:grid-cols-[15rem_minmax(0,1fr)]">
          <nav
            aria-label="Files"
            className="border-b border-border py-1 sm:min-h-0 sm:overflow-y-auto sm:border-b-0 sm:border-r"
          >
            {GROUPS.map((group) => (
              <div key={group}>
                <h3 className="px-3 pb-1 pt-3 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {EXPORT_GROUP_LABELS[group]}
                </h3>
                {EXPORT_ITEMS.filter((entry) => entry.group === group).map((entry) => {
                  const reason = exportUnavailable(entry.kind, context)
                  return (
                    <ResultRow
                      key={entry.kind}
                      accent="teal"
                      selected={entry.kind === item.kind}
                      title={entry.label}
                      subtitle={
                        reason ??
                        (exportStampNote(entry.kind, context) ? 'Stamped: leaves out an invalid input' : undefined)
                      }
                      trailing={<span className="text-3xs font-normal text-muted-foreground">{entry.extension}</span>}
                      className={`py-2 ${reason ? '[&_span]:text-muted-foreground' : ''}`}
                      aria-label={reason ? `${entry.label}, unavailable: ${reason}` : entry.label}
                      onClick={() => select(entry.kind)}
                    />
                  )
                })}
              </div>
            ))}
          </nav>
          <section
            ref={pane}
            aria-label={`${item.label} preview`}
            className="flex min-w-0 flex-col gap-3 p-3 sm:min-h-0 sm:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">
                  {item.label} <span className="font-normal text-muted-foreground">{item.extension}</span>
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
              </div>
              <Button
                className="shrink-0"
                disabled={!!unavailable}
                aria-label={item.kind === 'project' ? 'Save project JSON' : `Download ${item.label}`}
                onClick={() => onSave(item.kind)}
              >
                <Download className="size-4" />
                {item.kind === 'project' ? 'Save' : 'Download'}
              </Button>
            </div>
            {(stamped || setupAvailable) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <SegmentedControl
                  size="sm"
                  fullWidth={false}
                  label={`${item.label} view`}
                  value={shownView}
                  onChange={setView}
                  options={[
                    { value: 'preview' as const, label: 'Preview' },
                    ...(setupAvailable
                      ? [{ value: 'setup' as const, label: reportContents ? 'Contents' : 'Sheet setup' }]
                      : []),
                    ...(stamped ? [{ value: 'issue' as const, label: 'Issue stamp' }] : []),
                  ]}
                />
                {stamped && today && (
                  <span
                    className={`text-xs ${stamp.missing.length ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}
                    data-testid="road-issue-line"
                  >
                    {issueLine(stamp)}
                  </span>
                )}
              </div>
            )}
            {chooseRoads && (
              <SegmentedControl
                size="sm"
                fullWidth={false}
                label="Roads in this file"
                value={roadScope}
                onChange={(scope) => onRoadScope?.(scope)}
                options={[
                  { value: 'active' as const, label: `This road: ${clipName(roads?.activeName ?? '')}` },
                  { value: 'all' as const, label: `All ${roads?.count} roads` },
                ]}
              />
            )}
            {stampNote && (
              <p
                role="status"
                className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs"
                data-testid="road-export-stamp-note"
              >
                {stampNote}
              </p>
            )}
            {/* Side by side the preview scrolls in its pane; stacked on a phone it flows with the dialog. */}
            <div className="min-h-0 flex-1 sm:overflow-y-auto">
              {shownView === 'issue' && onIssue ? (
                <IssueStampEditor value={issue} onChange={onIssue} today={stamp.date} />
              ) : shownView === 'setup' && setupView ? (
                <div className="grid gap-3">
                  {setupLibrary}
                  {setupView}
                </div>
              ) : shownView === 'setup' && onReportSettings && reportContents ? (
                <ReportContentsEditor value={reportSettings} onChange={onReportSettings} focus={setupFocus?.section} />
              ) : shownView === 'setup' && onReportSettings ? (
                <div className="grid gap-3">
                  {setupLibrary}
                  <ReportSettingsEditor
                    key={setupFocus?.chapter ?? ''}
                    value={reportSettings}
                    onChange={onReportSettings}
                    initialChapter={setupFocus?.chapter}
                  />
                </div>
              ) : unavailable ? (
                <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">{unavailable}</p>
              ) : current?.preview ? (
                <ExportPreviewView
                  preview={current.preview}
                  title={item.label}
                  onPick={setupAvailable ? pick : undefined}
                />
              ) : current?.error ? (
                <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                  {current.error}
                </p>
              ) : (
                <p className="p-4 text-xs text-muted-foreground" aria-live="polite">
                  Preparing preview…
                </p>
              )}
            </div>
          </section>
        </div>
      </fieldset>
    </PanelDialog>
  )
}
