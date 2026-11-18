import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Download, Loader2 } from 'lucide-react'

import { PreparerProfileHostProvider, PreparerProfilePane, PreparerProfileRow } from '@/branding/PreparerProfile'
import { Button } from '@/components/ui/button'
import { CheckboxField, StyledSelect } from '@/components/ui/form-field'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { insetBox } from '@/components/ui/inset-box'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { ResultRow } from '@/components/ui/result-list'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TextButton } from '@/components/ui/text-button'
import { downloadBlob } from '@/lib/download'
import { useInterfaceThemeApplied } from '@/lib/interfaceTheme'
import { cn } from '@/lib/utils'

import { timed } from './exportTiming'
import { ReportDraftView, type ReportDraftPages, type ReportDraftResult } from './ReportDraftView'
import type { ViewCaptureReport } from './useViewCapture'
import { VIA_STEPS, type ViaStepId } from './via'
import {
  exportContents,
  exportPreparation,
  OPEN_PACKAGE_ACTION,
  packageSummary,
  rendererMissing,
  uncapturedNote,
  exportUnavailable,
  findVisualsExport,
  USES_PACKAGE_VIEWS,
  VISUALS_EXPORT_GROUP_LABELS,
  VISUALS_EXPORTS,
  waitsForRun,
  NEEDS_BEFORE,
  type ExportAction,
  type ExportContext,
  type ExportPlannedView,
  type ExportSection,
  type VisualsExport,
  type VisualsExportGroup,
} from './visualsExports'

/**
 * A written file: what the download saves and the preview shows. `notes` says what it was written without (terrain
 * that did not load, say), shown over the preview and beside the save line.
 */
export type BuiltFile = { blob: Blob; fileName: string; notes?: string }

/** What a file is missing: what its preparation left out, then what its own writing did. */
const withFileNotes = (missing: string | null, file: BuiltFile) =>
  [missing, file.notes].filter(Boolean).join(' ') || null

/**
 * An output's draft (the VIA report's): laid out at once without capturing anything, with stand-ins for pictures not
 * drawn yet, and `draw` to draw one picture group of it now.
 */
export type OutputDraft = {
  build: () => Promise<ReportDraftResult>
  draw: (id: string) => Promise<void>
  /** The draft on the pages its PDF prints, written from the draft as last built. */
  pages?: () => Promise<ReportDraftPages>
  /** Changes one printed value by hand; null puts back what the output filled. */
  edit?: (key: string, value: string | null, original?: string | null) => void
}

const GROUPS = Object.keys(VISUALS_EXPORT_GROUP_LABELS) as VisualsExportGroup[]
// Option edits rebuild the preview; a short pause keeps typing from rebuilding it per key.
const PREVIEW_DELAY_MS = 300
/** Text previews stop here; the download is whole. */
const TEXT_PREVIEW_CHARS = 60_000
/** How often a waiting export looks at the page's state again. */
const WAIT_POLL_MS = 150
/** After a run or the land checks, the content must hold still this long before the file is written. */
const SETTLE_MS = 400
/** A run that has not started by now never will: the scene refused it. */
const RUN_START_MS = 4000
/** How long an export waits for the road view's terrain to reload before an engine render counts it unavailable. */
const ROAD_VIEW_SETTLE_MS = 90_000
/** The land checks are waited for this long; a layer still reading then prints as Not read. */
const LAND_CHECK_WAIT_MS = 30_000
/** The visual inventory read is waited for this long (its own request gives up at 30 s); the file then says not read. */
const INVENTORY_WAIT_MS = 40_000

class Aborted extends Error {}

/** `promise`, or Aborted as soon as `signal` aborts; the work behind `promise` carries on either way. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Aborted('Stopped.'))
    const onAbort = () => reject(new Aborted('Stopped.'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/** Resolves once `ready()` holds, looking again every poll; `ready` may throw to fail the wait. */
function waitFor(ready: () => boolean, signal: AbortSignal, timeoutMs = Infinity): Promise<'ready' | 'timeout'> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const look = () => {
      if (signal.aborted) return reject(new Aborted('Stopped.'))
      try {
        if (ready()) return resolve('ready')
      } catch (error) {
        return reject(error)
      }
      if (Date.now() - started >= timeoutMs) return resolve('timeout')
      window.setTimeout(look, WAIT_POLL_MS)
    }
    look()
  })
}

type Preview =
  | { type: 'pdf' | 'image'; url: string }
  | { type: 'html'; html: string }
  | { type: 'text'; text: string; truncated: boolean }

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

async function previewOf(file: BuiltFile): Promise<Preview> {
  const type = file.blob.type
  if (type === 'application/pdf') return { type: 'pdf', url: URL.createObjectURL(file.blob) }
  if (type.startsWith('image/')) return { type: 'image', url: URL.createObjectURL(file.blob) }
  // A workbook is shown as its sheets, read back from the file itself, never as its zipped bytes.
  if (type === XLSX_TYPE) {
    const [{ workbookPreviewHtml }, ExcelJS] = await Promise.all([import('./workbookPreview'), import('exceljs')])
    return { type: 'html', html: await workbookPreviewHtml(await file.blob.arrayBuffer(), ExcelJS) }
  }
  if (type === 'application/zip') {
    const { projectArchiveFileList } = await import('./projectArchive')
    const text = await projectArchiveFileList(file.blob)
    return { type: 'text', text: text.slice(0, TEXT_PREVIEW_CHARS), truncated: text.length > TEXT_PREVIEW_CHARS }
  }
  const text = await file.blob.text()
  if (type === 'text/html') return { type: 'html', html: text }
  return { type: 'text', text: text.slice(0, TEXT_PREVIEW_CHARS), truncated: text.length > TEXT_PREVIEW_CHARS }
}

type PreviewResult =
  | { request: object; file: BuiltFile; preview: Preview; error?: undefined; missing: string | null; outdated?: true }
  | { request: object; file?: undefined; preview?: undefined; error: string; missing?: undefined }

const stepLabel = (id: ViaStepId) => {
  const step = VIA_STEPS.find((entry) => entry.id === id)
  return step ? `Step ${step.number}` : id
}

function ContentsSection({
  section,
  onGoToStep,
  onAction,
}: {
  section: ExportSection
  onGoToStep?: (id: ViaStepId) => void
  onAction?: (action: ExportAction) => void
}) {
  const empty = !section.rows?.length && !section.items?.length
  return (
    <section className="space-y-1.5" aria-label={section.title}>
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{section.title}</h4>
        <div className="flex shrink-0 items-baseline gap-3">
          {section.action && onAction && (
            <TextButton className="text-2xs" onClick={() => onAction(section.action!)}>
              {section.action.label}
            </TextButton>
          )}
          {section.step && onGoToStep && (
            <TextButton className="text-2xs" onClick={() => onGoToStep(section.step!)}>
              Change in {stepLabel(section.step)}
            </TextButton>
          )}
        </div>
      </div>
      {section.rows && section.rows.length > 0 && (
        <KeyValueRows
          variant="grid"
          rows={section.rows.map((row) => ({ label: row.label, value: row.value }))}
          className={cn(insetBox({ padding: 'sm' }))}
        />
      )}
      {section.items && section.items.length > 0 && (
        <ul className={cn(insetBox({ padding: 'none' }), 'divide-y overflow-hidden')}>
          {section.items.map((item, index) => (
            <li key={`${index}-${item.title}`} className="space-y-1 px-2.5 py-2 text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 font-medium text-foreground">{item.title}</p>
                {item.action && onAction && (
                  <TextButton
                    className="shrink-0 text-2xs"
                    aria-label={`${item.action.label}: ${item.title}`}
                    onClick={() => onAction(item.action!)}
                  >
                    {item.action.label}
                  </TextButton>
                )}
              </div>
              {item.subtitle && <p className="text-2xs text-muted-foreground">{item.subtitle}</p>}
              {item.rows && item.rows.length > 0 && (
                <KeyValueRows
                  variant="grid"
                  size="xs"
                  rows={item.rows.map((row) => ({ label: row.label, value: row.value }))}
                  className="pt-1 text-2xs"
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {empty && section.empty && <p className="text-2xs text-muted-foreground">{section.empty}</p>}
      {section.note && <p className="text-2xs text-muted-foreground">{section.note}</p>}
    </section>
  )
}

function PreviewView({ preview, title }: { preview: Preview; title: string }) {
  switch (preview.type) {
    case 'pdf':
      return (
        <iframe title={`${title} preview`} src={preview.url} className="h-full min-h-96 w-full rounded-md border" />
      )
    case 'image':
      return (
        <img
          src={preview.url}
          alt={`${title} preview`}
          className="max-h-full w-full rounded-md border bg-white object-contain"
        />
      )
    case 'html':
      // Scripts stay off; same-origin only lets the frame read its own navigator.
      return (
        <iframe
          title={`${title} preview`}
          sandbox="allow-same-origin"
          srcDoc={preview.html}
          className="h-full min-h-96 w-full rounded-md border bg-white"
        />
      )
    case 'text':
      return (
        <div className="space-y-1">
          <pre
            className={cn(
              insetBox({ padding: 'sm' }),
              'max-h-[32rem] overflow-auto whitespace-pre-wrap break-words font-mono text-2xs',
            )}
          >
            {preview.text}
          </pre>
          {preview.truncated && (
            <p className="text-2xs text-muted-foreground">The preview stops here; the download is complete.</p>
          )}
        </div>
      )
  }
}

type PackageSelect = {
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  onChange: (value: string) => void
}

const CAPTURE_LABELS: Record<ExportPlannedView['state'], string> = {
  captured: 'Captured',
  outdated: 'Changed since its capture: captured again on Preview or Download',
  'no-figure': 'Captured without its analysis sheet: captured again on Preview or Download',
  'not-captured': 'To capture on Preview or Download',
}

function PackageHeading({ children }: { children: ReactNode }) {
  return <h4 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h4>
}

/** A view's picture in the checklist, or an empty frame saying why there is none. */
function ViewThumbnail({ src, empty }: { src: string | null; empty: string }) {
  return src ? (
    <img src={src} alt="" className="aspect-video w-16 shrink-0 rounded-sm border bg-muted object-cover" />
  ) : (
    <span className="flex aspect-video w-16 shrink-0 items-center justify-center rounded-sm border border-dashed px-1 text-center text-3xs leading-tight text-muted-foreground">
      {empty}
    </span>
  )
}

/**
 * The package, chosen once for every output: the recipe the VIA report and the VIA document follow, who draws the
 * figures, and the views that go in, each planned view of interest with its capture state and every saved view not
 * captured for one.
 */
export function ExportPackagePane({
  recipe,
  recipeTools,
  renderer,
  planned,
  saved,
  onPlannedInclude,
  onSavedInclude,
}: {
  recipe: PackageSelect & { note: string }
  /** Making, editing, sharing and importing your own recipes (`OwnRecipeTools`), under the recipe. */
  recipeTools?: ReactNode
  renderer: PackageSelect & { unavailable: string | null }
  planned: ReadonlyArray<ExportPlannedView & { thumbnail: string | null }>
  saved: ReadonlyArray<{ id: string; name: string; included: boolean; detail: string; thumbnail: string | null }>
  /** Writes a view of interest's `include`; absent, the checklist only shows it. */
  onPlannedInclude?: (id: string, on: boolean) => void
  onSavedInclude: (id: string, on: boolean) => void
}) {
  const select = (choice: PackageSelect, label: string) => (
    <StyledSelect
      aria-label={label}
      className="w-full rounded-md border bg-background p-1"
      value={choice.value}
      onChange={(event) => choice.onChange(event.target.value)}
    >
      {choice.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </StyledSelect>
  )
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 pb-2">
      <section className="min-w-0 space-y-1.5" aria-label="Recipe">
        <PackageHeading>Recipe</PackageHeading>
        {select(recipe, 'Package recipe')}
        <p className="text-2xs text-muted-foreground">{recipe.note}</p>
        {recipeTools}
      </section>
      <section className="min-w-0 space-y-1.5" aria-label="Figures drawn by">
        <PackageHeading>Figures drawn by</PackageHeading>
        {select(renderer, 'Figures drawn by')}
        {renderer.unavailable ? (
          <p className="rounded-md border border-warning-border bg-warning-surface p-2 text-2xs text-warning-foreground">
            {renderer.unavailable}
          </p>
        ) : (
          <p className="text-2xs text-muted-foreground">
            The analysis sheet, the VIA document and the VIA report. Another engine draws each view again at final
            quality in the background before the file is written.
          </p>
        )}
      </section>
      <section className="min-w-0 space-y-1.5" aria-label="Views">
        <PackageHeading>Views</PackageHeading>
        {planned.length > 0 && (
          <ul aria-label="Views of interest" className={cn(insetBox({ padding: 'none' }), 'divide-y overflow-hidden')}>
            {planned.map((view) => (
              <li key={view.id} className="flex items-start gap-2 px-2.5 py-2">
                <ViewThumbnail src={view.thumbnail} empty={view.state === 'captured' ? 'No picture' : 'Not captured'} />
                <CheckboxField
                  className="min-w-0 flex-1"
                  label={view.name}
                  checked={view.include}
                  disabled={!onPlannedInclude}
                  onCheckedChange={(on) => onPlannedInclude?.(view.id, on)}
                  description={[
                    view.block,
                    view.lens,
                    view.failed && view.state === 'no-figure'
                      ? `Captured without its analysis sheet: ${view.failed.replace(/^Saved, but /, '').replace(/[.\s]*$/, '')}`
                      : view.failed && view.state !== 'captured'
                        ? `Not captured: ${view.failed.replace(/[.\s]*$/, '')}`
                        : CAPTURE_LABELS[view.state],
                  ].join(' · ')}
                />
              </li>
            ))}
          </ul>
        )}
        {saved.length > 0 && (
          <ul aria-label="Saved views" className={cn(insetBox({ padding: 'none' }), 'divide-y overflow-hidden')}>
            {saved.map((view) => (
              <li key={view.id} className="flex items-start gap-2 px-2.5 py-2">
                <ViewThumbnail src={view.thumbnail} empty="No screenshot" />
                <CheckboxField
                  className="min-w-0 flex-1"
                  label={view.name}
                  checked={view.included}
                  onCheckedChange={(on) => onSavedInclude(view.id, on)}
                  description={`Saved view · ${view.detail}`}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="text-2xs text-muted-foreground">
          {planned.length || saved.length
            ? 'The block note, the field brief, the analysis sheet, the VIA document and the VIA report take these views (a block’s note and brief only the views planned for it). A view of interest not yet captured is captured on Preview or Download: the page stands there, runs and saves it as Save viewpoint does.'
            : 'No views yet. Add a view of interest in step 2, or save one in the road view.'}
        </p>
      </section>
    </div>
  )
}

/**
 * Every output of the visual-quality page in one list, grouped, with what goes into the selected
 * one — the landform, the viewpoints and saved views with their settings, the blocks, the run and
 * the review — its options, and a preview built from the same file its download writes.
 */
export function VisualsExportDialog({
  open,
  initialOutput,
  initialPackage = false,
  onOpenChange,
  context,
  options,
  build,
  version,
  onGoToStep,
  onAction,
  onRun,
  onRender,
  onReadInventory,
  packagePane,
  viewsPane,
  viewsSummary,
  drafts,
  onCapture,
  onCancelCapture,
  portalContainer,
}: {
  open: boolean
  initialOutput: VisualsExport
  /** Open on the package's entry rather than `initialOutput`'s pane. */
  initialPackage?: boolean
  onOpenChange: (open: boolean) => void
  context: ExportContext
  /** Each output's own options (stations, figure style, block), shown above what goes in. */
  options: Partial<Record<VisualsExport, ReactNode>>
  /** Writes one output; `signal` aborts when the selection or its content changes. */
  build: (kind: VisualsExport, format: string, signal: AbortSignal) => Promise<BuiltFile>
  /** Changes whenever this output's content would (and never for another output's state or a wait's progress). */
  version: (kind: VisualsExport) => string
  /** Closes the dialog and opens a step of the sidebar. */
  onGoToStep?: (id: ViaStepId) => void
  /** Does a part's job: stand at a viewpoint, read the inventory, open the road view. */
  onAction?: (action: ExportAction) => void
  /** Starts the visibility run in the analysis worker, for an output that reads it. */
  onRun?: () => void
  /**
   * Queues the background renders the chosen engine still owes an output (`useBackgroundRenders`): the figures, and
   * for the VIA report each view's before picture by the same engine.
   */
  onRender?: (kind: VisualsExport) => void
  /** Reads the scene's visual inventory, or reads it again after a failure, for the outputs that print it. */
  onReadInventory?: () => void
  /** The package's choices (`ExportPackagePane`), shown under its own entry first in the list. Absent: no entry. */
  packagePane?: ReactNode
  /**
   * The views of interest (`ViewsOfInterestList`), under their own *Views* entry beside the package: each view's
   * options and capture, edited where the files that draw them are written. Absent: no entry.
   */
  viewsPane?: ReactNode
  /** The *Views* entry's subtitle ("2 planned · 1 of 2 captured"). */
  viewsSummary?: string
  /** Outputs with a draft view (`OutputDraft`): the VIA report. */
  drafts?: Partial<Record<VisualsExport, OutputDraft>>
  /**
   * Captures views of interest as saved views (`viewsToCapture`, `beforeToCapture`) before an output that draws them
   * is written; `before`, with each one's before-harvest render where it stands.
   */
  onCapture?: (viewIds: readonly string[], options?: { before?: boolean }) => Promise<ViewCaptureReport>
  /** Stops a capture in flight; the views captured so far are kept. */
  onCancelCapture?: () => void
  portalContainer?: HTMLElement | null
}) {
  const [selected, setSelected] = useState<VisualsExport>(initialOutput)
  // The package's entry is open in place of an output's pane. The page mounts the dialog only while it is open, so
  // the first render takes `initialPackage` here: the open transition below never runs for that mount.
  const [packageOpen, setPackageOpen] = useState(open && initialPackage && !!packagePane)
  // The views' entry is open in place of an output's pane (and of the package's).
  const [viewsOpen, setViewsOpen] = useState(false)
  // *Your details* are open in place of every other pane (`PreparerProfilePane`, kept mounted while the dialog is).
  const [detailsOpen, setDetailsOpen] = useState(false)
  // Teal in the built-in theme; an Appearance theme's own selection colours under one.
  const themed = useInterfaceThemeApplied()
  const [view, setView] = useState<'contents' | 'draft' | 'preview'>('contents')
  // The draft of the selected output, for its own request; the picture group drawing now, and why a draw failed.
  const [draftResult, setDraftResult] = useState<
    | { request: object; draft: ReportDraftResult; error?: undefined }
    | { request: object; draft?: undefined; error: string }
    | null
  >(null)
  const [drawing, setDrawing] = useState<string | null>(null)
  const [drawError, setDrawError] = useState<string | null>(null)
  const [formats, setFormats] = useState<Partial<Record<VisualsExport, string>>>({})
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ tone: 'info' | 'warning' | 'error'; text: string } | null>(null)
  // Open on the requested output, including when the previous session used another.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSelected(initialOutput)
      setPackageOpen(initialPackage && !!packagePane)
      setDetailsOpen(false)
      setViewsOpen(false)
      setView('contents')
      setStatus(null)
    }
  }
  const item = findVisualsExport(selected)
  const draftOf = drafts?.[item.kind]
  // An output without a draft shows its contents in place of one.
  const shownView = view === 'draft' && !draftOf ? 'contents' : view
  const format = item.formats.find((entry) => entry.id === formats[item.kind]) ?? item.formats[0]
  const unavailable = exportUnavailable(item.kind, context)
  const sections = useMemo(() => exportContents(item.kind, context), [item.kind, context])
  const preparation = exportPreparation(item.kind, context)

  // A new object per selection or content change: a preview is current only for its own request.
  const itemVersion = version(item.kind)
  const request = useMemo(
    () => ({ kind: item.kind, format: format.id, version: itemVersion }),
    [item.kind, format.id, itemVersion],
  )
  const [result, setResult] = useState<PreviewResult | null>(null)
  const latestRequest = useRef<object>(request)
  const resultRef = useRef(result)
  useEffect(() => {
    latestRequest.current = request
    resultRef.current = result
  })
  // What the preview waits on now, for its placeholder: the file being written, or the one before it finishing.
  const [previewStage, setPreviewStage] = useState<{ request: object; text: string } | null>(null)
  // The file being written, whatever asked for it: a build moves the page's maps and road view (the report's maps,
  // its before pictures), so the next waits for it to finish rather than moving them at the same time.
  const buildInFlight = useRef<Promise<unknown>>(Promise.resolve())
  const latestBuild = useRef(build)
  const latestContext = useRef(context)
  const latestRun = useRef(onRun)
  const latestRender = useRef(onRender)
  const latestReadInventory = useRef(onReadInventory)
  const latestCapture = useRef(onCapture)
  const latestCancelCapture = useRef(onCancelCapture)
  const latestDrafts = useRef(drafts)
  // The capture this dialog started, while it runs: every wait shares it rather than starting another, since the
  // capture moves the page and each move restarts the preview.
  const captureInFlight = useRef<Promise<ViewCaptureReport> | null>(null)
  const changedAt = useRef(0)
  useEffect(() => {
    latestBuild.current = build
    latestContext.current = context
    latestRun.current = onRun
    latestRender.current = onRender
    latestReadInventory.current = onReadInventory
    latestCapture.current = onCapture
    latestCancelCapture.current = onCancelCapture
    latestDrafts.current = drafts
  })
  useEffect(() => {
    changedAt.current = Date.now()
  }, [itemVersion])

  /**
   * Makes what the output reads before it is written: the views of interest the package includes and has not
   * captured (first, since capturing stands at each and runs there), the visibility run, in the analysis worker,
   * when it is missing or stale, and the land checks the block note prints. Then waits for the page to settle, so
   * the build that follows (`latestBuild`, from the render after) reads the new run and the views as captured.
   * Resolves with the views of interest the file goes without, worded, or null.
   */
  const prepare = useCallback(async (kind: VisualsExport, signal: AbortSignal, retry = false) => {
    let waited = false
    const first = exportPreparation(kind, latestContext.current, { retry })
    const roadViewWasReady = latestContext.current.roadViewReady
    const toCapture = first.capture
    const capturing = () => latestContext.current.capture.status === 'running'
    if (captureInFlight.current || (USES_PACKAGE_VIEWS.has(kind) && capturing()) || toCapture.length) {
      waited = true
      if (!captureInFlight.current && !capturing() && latestCapture.current) {
        const pending = latestCapture.current(toCapture, first.captureBefore ? { before: true } : {})
        captureInFlight.current = pending
        const clear = () => {
          if (captureInFlight.current === pending) captureInFlight.current = null
        }
        pending.then(clear, clear)
      }
      if (captureInFlight.current) {
        const report = await timed('capture views of interest', () => untilAborted(captureInFlight.current!, signal))
        if (report.cancelled)
          throw new Error(
            'Capturing the views of interest was cancelled, so nothing was written. Preview writes the file with the views captured so far; Download tries the rest again.',
          )
      } else await waitFor(() => !capturing(), signal)
      // The capture steps back to where the reviewer stood: let the page settle before reading what it needs now.
      await timed('settle after capture', () => waitFor(() => Date.now() - changedAt.current >= SETTLE_MS, signal))
      // An output with before pictures renders the views saved here from the road view: when it was open before the
      // capture, wait for the capture's way back to open it again and load its terrain.
      if (roadViewWasReady && NEEDS_BEFORE.has(kind))
        await timed('road view back', () =>
          waitFor(() => latestContext.current.roadViewReady, signal, ROAD_VIEW_SETTLE_MS),
        )
    }
    // A capture steps back where the reviewer stood and runs there again: the file waits for that run whatever it
    // reads, or it is written from the run before and thrown away when the new one lands.
    const captured = waited
    const needs = exportPreparation(kind, latestContext.current, { retry })
    const running = () => latestContext.current.autoRun.status === 'running'
    // The visual inventory, read alongside the run: a failed read does not stop the file, which then says not read.
    let inventoryRead: Promise<unknown> = Promise.resolve()
    if (needs.inventory && latestReadInventory.current) {
      waited = true
      const status = () => latestContext.current.visualInventory?.status ?? 'ready'
      const asked = Date.now()
      let started = status() === 'loading'
      latestReadInventory.current()
      inventoryRead = timed('visual inventory read', () =>
        waitFor(
          () => {
            const now = status()
            if (now === 'loading') started = true
            if (now === 'ready') return true
            // An error from before the request counts only once the new read has had time to start.
            if (now === 'error') return started || Date.now() - asked > RUN_START_MS
            return false
          },
          signal,
          INVENTORY_WAIT_MS,
        ),
      )
    }
    const rerun =
      captured && waitsForRun(kind) && latestContext.current.run !== 'current' && !latestContext.current.autoRun.blocker
    if (needs.run || rerun || (running() && waitsForRun(kind))) {
      waited = true
      if (!running()) latestRun.current?.()
      const asked = Date.now()
      let started = running()
      await timed('run', () =>
        waitFor(() => {
          const ctx = latestContext.current
          if (ctx.run === 'current') return true
          if (ctx.autoRun.status === 'running') started = true
          else if (started)
            throw new Error(
              ctx.autoRun.status === 'error'
                ? `The assessment stopped: ${ctx.autoRun.error ?? 'no reason given'}.`
                : 'The assessment was stopped before the file was written.',
            )
          else if (Date.now() - asked > RUN_START_MS)
            throw new Error(ctx.autoRun.blocker ?? 'The assessment could not start: check the scene in step 1.')
          return false
        }, signal),
      )
    }
    await inventoryRead
    if (needs.landChecks || (kind === 'block-note' && latestContext.current.landChecks.pending)) {
      waited = true
      await waitFor(
        () => !latestContext.current.landChecks.include || latestContext.current.landChecks.pending === 0,
        signal,
        LAND_CHECK_WAIT_MS,
      )
    }
    // Another engine's renders run in the background, in order; the file waits for the last of its views.
    if (needs.render) {
      waited = true
      latestRender.current?.(kind)
      const asked = Date.now()
      await timed('engine renders', () =>
        waitFor(() => {
          const r = latestContext.current.renderer
          if (r.failed) throw new Error(`${r.label} could not draw ${r.failed}`)
          // The road view's terrain reloading after a run is a wait, not a failure, for a while.
          if (r.unavailable && !(r.settling && Date.now() - asked < ROAD_VIEW_SETTLE_MS))
            throw new Error(`${r.label} cannot draw the figures: ${r.unavailable}`)
          // A view still missing with nothing queued (its render was kept under a scene the page has since moved on
          // from) is asked for again: the wait used to sit on it for good.
          const missing = rendererMissing(kind, r)
          if (missing > 0 && !r.running) latestRender.current?.(kind)
          return missing === 0
        }, signal),
      )
    }
    if (waited) await timed('settle', () => waitFor(() => Date.now() - changedAt.current >= SETTLE_MS, signal))
    return uncapturedNote(kind, latestContext.current)
  }, [])

  // A wait in flight stops with the dialog, and so does a capture it started: it drives the page.
  const live = useRef(new Set<AbortController>())
  useEffect(() => {
    const controllers = live.current
    return () => {
      controllers.forEach((controller) => controller.abort())
      if (captureInFlight.current) latestCancelCapture.current?.()
    }
  }, [])

  /** Writes the file once the one before it is done; aborts while waiting, never in the middle of another's moves. */
  const writeFile = useCallback(
    async (kind: VisualsExport, formatId: string, signal: AbortSignal, onStage?: (text: string) => void) => {
      let settled = false
      void buildInFlight.current.then(() => (settled = true))
      await Promise.resolve()
      if (!settled) onStage?.('Waiting for the file started before this one to finish writing…')
      await untilAborted(buildInFlight.current, signal)
      if (signal.aborted) throw new Aborted('Stopped.')
      onStage?.(
        kind === 'via-report'
          ? 'Writing the report: its maps and before pictures are captured from the page’s maps, a few seconds each…'
          : 'Writing the file…',
      )
      const job = timed(`write ${kind}`, () => latestBuild.current(kind, formatId, signal))
      buildInFlight.current = job.catch(() => undefined)
      return job
    },
    [],
  )

  useEffect(() => {
    if (!open || unavailable || shownView !== 'preview' || packageOpen || viewsOpen || detailsOpen) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      let missing: string | null = null
      prepare(request.kind, controller.signal)
        .then((note) => {
          missing = note
          return writeFile(request.kind, request.format, controller.signal, (text) => {
            if (!controller.signal.aborted) setPreviewStage({ request, text })
          })
        })
        .then(async (file) => {
          const preview = await previewOf(file)
          // Written for content that has since changed: shown, marked out of date, while the current one is written
          // (the pictures it drew are kept, so that one is quicker), rather than thrown away. Never downloaded.
          if (controller.signal.aborted) {
            // The current one already shown: this one is not needed.
            if (resultRef.current?.request === latestRequest.current) {
              if ('url' in preview) URL.revokeObjectURL(preview.url)
            } else setResult({ request, file, preview, missing: withFileNotes(missing, file), outdated: true })
          } else setResult({ request, file, preview, missing: withFileNotes(missing, file) })
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setResult({
              request,
              error: [error instanceof Error ? error.message : 'Could not prepare a preview.', missing]
                .filter(Boolean)
                .join(' '),
            })
        })
    }, PREVIEW_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, request, unavailable, shownView, packageOpen, viewsOpen, detailsOpen, prepare, writeFile])
  // The draft is laid out again whenever the output's content changes; it captures nothing, so it waits for nothing.
  useEffect(() => {
    if (!open || unavailable || shownView !== 'draft' || packageOpen || viewsOpen || detailsOpen) return
    let stopped = false
    const timer = window.setTimeout(() => {
      const draft = latestDrafts.current?.[request.kind]
      if (!draft) return
      draft
        .build()
        .then((built) => !stopped && setDraftResult({ request, draft: built }))
        .catch(
          (error: unknown) =>
            !stopped &&
            setDraftResult({
              request,
              error: error instanceof Error ? error.message : 'The draft could not be laid out.',
            }),
        )
    }, PREVIEW_DELAY_MS)
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [open, request, unavailable, shownView, packageOpen, viewsOpen, detailsOpen])
  // The last draft stays up while the next is laid out, so drawing a picture does not blank the page.
  const shownDraft = draftResult && (draftResult.request === request || draftResult.draft) ? draftResult : null
  /** Draws one picture group of the draft, after any file being written: both move the page's maps. */
  const drawPicture = async (id: string) => {
    const draft = latestDrafts.current?.[item.kind]
    if (!draft || drawing) return
    setDrawing(id)
    setDrawError(null)
    try {
      await buildInFlight.current
      const job = draft.draw(id)
      buildInFlight.current = job.catch(() => undefined)
      await job
    } catch (error) {
      setDrawError(error instanceof Error ? error.message : 'The picture could not be drawn.')
    } finally {
      setDrawing(null)
    }
  }

  // Object URLs live as long as their preview.
  useEffect(() => {
    const preview = result?.preview
    return () => {
      if (preview && 'url' in preview) URL.revokeObjectURL(preview.url)
    }
  }, [result])
  const current = result?.request === request ? result : null
  // A preview written for content that has since changed, shown until the current one is written.
  const outdated = !current && result?.preview && result.request && 'outdated' in result ? result : null

  const pane = useRef<HTMLElement>(null)
  const select = (kind: VisualsExport) => {
    setSelected(kind)
    setPackageOpen(false)
    setViewsOpen(false)
    setDetailsOpen(false)
    setStatus(null)
    // Stacked on a phone, the pane sits under the list; bring it up. Side by side this does nothing.
    requestAnimationFrame(() => pane.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }
  const download = async () => {
    setSaving(true)
    setStatus(null)
    const controller = new AbortController()
    live.current.add(controller)
    try {
      // The previewed file when it is this one and nothing waits; otherwise made and written now. A download tries
      // again the views of interest whose capture failed.
      const again = exportPreparation(item.kind, context, { retry: true })
      const ready =
        item.kind !== 'project' &&
        !again.run &&
        !again.landChecks &&
        !again.render &&
        !again.inventory &&
        !again.capture.length &&
        context.autoRun.status !== 'running' &&
        !(USES_PACKAGE_VIEWS.has(item.kind) && context.capture.status === 'running')
      let file = ready ? current?.file : undefined
      let missing = ready ? (current?.missing ?? null) : null
      if (!file) {
        missing = await prepare(item.kind, controller.signal, true)
        file = await writeFile(item.kind, format.id, controller.signal)
        missing = withFileNotes(missing, file)
      }
      if (controller.signal.aborted) return
      downloadBlob(file.blob, file.fileName)
      setStatus(
        missing
          ? { tone: 'warning', text: `Saved ${file.fileName}. ${missing}` }
          : { tone: 'info', text: `Saved ${file.fileName}.` },
      )
    } catch (error) {
      if (error instanceof Aborted) return
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : 'The file could not be written.' })
    } finally {
      live.current.delete(controller)
      if (!controller.signal.aborted) setSaving(false)
    }
  }

  const openPackage = () => {
    setPackageOpen(true)
    setViewsOpen(false)
    setDetailsOpen(false)
    setStatus(null)
    requestAnimationFrame(() => pane.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }
  const openViews = () => {
    setViewsOpen(true)
    setPackageOpen(false)
    setDetailsOpen(false)
    setStatus(null)
    requestAnimationFrame(() => pane.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }
  const openDetails = () => {
    setDetailsOpen(true)
    setStatus(null)
    requestAnimationFrame(() => detailsPane.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }
  const detailsPane = useRef<HTMLElement>(null)
  // The package's entry is the dialog's own; every other action is the page's.
  const act = (action: ExportAction) => (action.id === OPEN_PACKAGE_ACTION ? openPackage() : onAction?.(action))
  const capture = context.capture
  const captureRunning = capture.status === 'running'
  const cancelCapture = onCancelCapture && captureRunning && (
    <TextButton className="ml-2 text-2xs" onClick={onCancelCapture}>
      Cancel capture
    </TextButton>
  )

  return (
    <PanelDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Save & export"
      size="xl"
      portalContainer={portalContainer}
      className="sm:h-[min(48rem,92dvh)]"
      bodyClassName="p-0 workspace-sm:p-0"
      contentProps={{ 'data-testid': 'visuals-export-dialog' }}
    >
      {/* The row and every output's *Edit your details* open the pane below, not a second modal. */}
      <PreparerProfileHostProvider value={{ open: openDetails, shown: detailsOpen }}>
        {/* One column on a phone that never grows past the dialog: a long option or row text wraps or ellipsizes. */}
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] sm:h-full sm:min-h-[24rem] sm:grid-cols-[15rem_minmax(0,1fr)]">
          <nav
            aria-label="Files"
            className="border-b border-border py-1 sm:min-h-0 sm:overflow-y-auto overscroll-none sm:border-b-0 sm:border-r"
          >
            <PreparerProfileRow accent={themed ? 'theme' : 'teal'} portalContainer={portalContainer} />
            {(packagePane || viewsPane) && (
              <div>
                <h3 className="px-3 pb-1 pt-3 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Chosen once
                </h3>
                {packagePane && (
                  <ResultRow
                    accent={themed ? 'theme' : 'teal'}
                    selected={packageOpen && !detailsOpen}
                    title="Package"
                    subtitle={packageSummary(context)}
                    className="py-2"
                    aria-label={`Package: ${packageSummary(context)}`}
                    onClick={openPackage}
                  />
                )}
                {viewsPane && (
                  <ResultRow
                    accent={themed ? 'theme' : 'teal'}
                    selected={viewsOpen && !detailsOpen}
                    title="Views"
                    subtitle={viewsSummary}
                    className="py-2"
                    aria-label={viewsSummary ? `Views: ${viewsSummary}` : 'Views'}
                    onClick={openViews}
                  />
                )}
              </div>
            )}
            {GROUPS.map((group) => (
              <div key={group}>
                <h3 className="px-3 pb-1 pt-3 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {VISUALS_EXPORT_GROUP_LABELS[group]}
                </h3>
                {VISUALS_EXPORTS.filter((entry) => entry.group === group).map((entry) => {
                  const reason = exportUnavailable(entry.kind, context)
                  const shown = entry.formats.find((f) => f.id === formats[entry.kind]) ?? entry.formats[0]
                  return (
                    <ResultRow
                      key={entry.kind}
                      accent={themed ? 'theme' : 'teal'}
                      selected={!detailsOpen && !packageOpen && !viewsOpen && entry.kind === item.kind}
                      title={entry.label}
                      subtitle={reason ?? undefined}
                      trailing={<span className="text-3xs font-normal text-muted-foreground">{shown.extension}</span>}
                      className={`py-2 ${reason ? '[&_span]:text-muted-foreground' : ''}`}
                      aria-label={reason ? `${entry.label}, unavailable: ${reason}` : entry.label}
                      onClick={() => select(entry.kind)}
                    />
                  )
                })}
              </div>
            ))}
          </nav>
          <PreparerProfilePane hidden={!detailsOpen} sectionRef={detailsPane} />
          {detailsOpen ? null : viewsOpen && viewsPane ? (
            <section ref={pane} aria-label="Views" className="flex min-w-0 flex-col gap-3 p-3 sm:min-h-0 sm:p-5">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Views</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  The views of interest, as step 2 lists them: open a row for its facing, lens, record, field photos and
                  whether it goes in the exports, and capture the ones the files still need.
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-x-clip sm:overflow-y-auto overscroll-none">{viewsPane}</div>
            </section>
          ) : packageOpen && packagePane ? (
            <section ref={pane} aria-label="Package" className="flex min-w-0 flex-col gap-3 p-3 sm:min-h-0 sm:p-5">
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold">Package</h3>
                  {drafts?.['via-report'] && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => {
                        select('via-report')
                        setView('draft')
                      }}
                    >
                      See the report’s draft
                    </Button>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Chosen once for every output: the recipe the VIA report and the VIA document follow, who draws the
                  figures, and the views that go in.
                </p>
              </div>
              {captureRunning && (
                <InlineAlert loading>
                  <span role="status">
                    {capture.message ??
                      `Capturing the views of interest${capture.total ? `, ${capture.done} of ${capture.total}` : ''}.`}
                  </span>
                  {cancelCapture}
                </InlineAlert>
              )}
              <div className="min-h-0 flex-1 overflow-x-clip sm:overflow-y-auto overscroll-none">{packagePane}</div>
            </section>
          ) : (
            <section
              ref={pane}
              aria-label={`${item.label} export`}
              className="flex min-w-0 flex-col gap-3 p-3 sm:min-h-0 sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">
                    {item.label} <span className="font-normal text-muted-foreground">{format.extension}</span>
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                </div>
                <Button
                  className="shrink-0"
                  disabled={!!unavailable || saving}
                  aria-label={`Download ${item.label}`}
                  onClick={() => void download()}
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                  {item.group === 'files' ? 'Save' : 'Download'}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <SegmentedControl
                  size="sm"
                  fullWidth={false}
                  label={`${item.label} view`}
                  value={shownView}
                  onChange={(next) => {
                    // A download's line (saved, or why not) belongs to that download, not to the next view.
                    setView(next)
                    setStatus(null)
                  }}
                  options={[
                    { value: 'contents' as const, label: 'What goes in' },
                    ...(draftOf ? [{ value: 'draft' as const, label: 'Draft' }] : []),
                    { value: 'preview' as const, label: 'Preview' },
                  ]}
                />
                {item.formats.length > 1 && (
                  <SegmentedControl
                    size="sm"
                    fullWidth={false}
                    label={`${item.label} format`}
                    value={format.id}
                    onChange={(id) => setFormats((current) => ({ ...current, [item.kind]: id }))}
                    options={item.formats.map((entry) => ({ value: entry.id, label: entry.label }))}
                  />
                )}
              </div>
              {status && (
                <InlineAlert tone={status.tone === 'info' ? 'success' : status.tone}>
                  <span role="status">{status.text}</span>
                </InlineAlert>
              )}
              {!unavailable &&
                preparation.note &&
                !(shownView === 'preview' && preparation.noteIsSkipped && current) && (
                  <InlineAlert
                    loading={
                      context.autoRun.status === 'running' ||
                      (USES_PACKAGE_VIEWS.has(item.kind) && captureRunning) ||
                      (saving && preparation.landChecks) ||
                      (preparation.render && context.renderer.running)
                    }
                  >
                    <span role="status">{preparation.note}</span>
                    {USES_PACKAGE_VIEWS.has(item.kind) && cancelCapture}
                  </InlineAlert>
                )}
              {unavailable && (
                <p
                  role="status"
                  className="rounded-md border border-warning-border bg-warning-surface p-2 text-xs text-warning-foreground"
                >
                  {unavailable}
                </p>
              )}
              {/* Side by side the pane scrolls; stacked on a phone it flows with the dialog. */}
              <div className="min-h-0 flex-1 overflow-x-clip sm:overflow-y-auto overscroll-none">
                {shownView === 'draft' && !unavailable ? (
                  shownDraft?.draft ? (
                    <ReportDraftView
                      draft={shownDraft.draft}
                      options={options[item.kind]}
                      drawing={drawing}
                      onDraw={(id) => void drawPicture(id)}
                      drawError={drawError}
                      startOnPages={request.format === 'pdf'}
                      {...(draftOf?.pages ? { pages: () => latestDrafts.current![item.kind]!.pages!() } : {})}
                      {...(draftOf?.edit
                        ? {
                            onEdit: (key, value, original) =>
                              latestDrafts.current?.[item.kind]?.edit?.(key, value, original),
                          }
                        : {})}
                    />
                  ) : shownDraft?.error ? (
                    <InlineAlert tone="error">{shownDraft.error}</InlineAlert>
                  ) : (
                    <InlineAlert loading>Laying out the draft…</InlineAlert>
                  )
                ) : shownView === 'contents' ? (
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 pb-2">
                    {options[item.kind] && (
                      <section className="space-y-1.5" aria-label="Options">
                        <h4 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Options
                        </h4>
                        {options[item.kind]}
                      </section>
                    )}
                    {sections.map((section) => (
                      <ContentsSection
                        key={section.title}
                        section={section}
                        onGoToStep={onGoToStep}
                        onAction={onAction || packagePane ? act : undefined}
                      />
                    ))}
                  </div>
                ) : unavailable ? (
                  <p className={cn(insetBox({ padding: 'lg' }), 'border-dashed text-xs text-muted-foreground')}>
                    {unavailable}
                  </p>
                ) : current?.preview ? (
                  <div className="flex h-full min-h-0 flex-col gap-2">
                    {current.missing && <InlineAlert tone="warning">{current.missing}</InlineAlert>}
                    <div className="min-h-0 flex-1">
                      <PreviewView preview={current.preview} title={item.label} />
                    </div>
                  </div>
                ) : outdated?.preview && (outdated.request as { kind?: string }).kind === item.kind ? (
                  <div className="flex h-full min-h-0 flex-col gap-2">
                    <InlineAlert loading>
                      <span role="status">
                        Out of date: the page changed while this was written. Writing it again, with the pictures
                        already drawn kept.
                      </span>
                    </InlineAlert>
                    <div className="min-h-0 flex-1">
                      <PreviewView preview={outdated.preview} title={item.label} />
                    </div>
                  </div>
                ) : current?.error ? (
                  <InlineAlert tone="error">{current.error}</InlineAlert>
                ) : (
                  <InlineAlert loading>
                    {previewStage?.request === request ? previewStage.text : 'Preparing preview…'}
                  </InlineAlert>
                )}
              </div>
            </section>
          )}
        </div>
      </PreparerProfileHostProvider>
    </PanelDialog>
  )
}
