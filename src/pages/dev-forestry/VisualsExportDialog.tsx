import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Download, Loader2 } from 'lucide-react'

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
  RUNS_ON_EXPORT,
  type ExportAction,
  type ExportContext,
  type ExportPlannedView,
  type ExportSection,
  type VisualsExport,
  type VisualsExportGroup,
} from './visualsExports'

/** A written file: what the download saves and the preview shows. */
export type BuiltFile = { blob: Blob; fileName: string }

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

async function previewOf(file: BuiltFile): Promise<Preview> {
  const type = file.blob.type
  if (type === 'application/pdf') return { type: 'pdf', url: URL.createObjectURL(file.blob) }
  if (type.startsWith('image/')) return { type: 'image', url: URL.createObjectURL(file.blob) }
  const text = await file.blob.text()
  if (type === 'text/html') return { type: 'html', html: text }
  return { type: 'text', text: text.slice(0, TEXT_PREVIEW_CHARS), truncated: text.length > TEXT_PREVIEW_CHARS }
}

type PreviewResult =
  | { request: object; file: BuiltFile; preview: Preview; error?: undefined; missing: string | null }
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
  renderer,
  planned,
  saved,
  onPlannedInclude,
  onSavedInclude,
}: {
  recipe: PackageSelect & { note: string }
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
    <div className="grid gap-4 pb-2">
      <section className="space-y-1.5" aria-label="Recipe">
        <PackageHeading>Recipe</PackageHeading>
        {select(recipe, 'Package recipe')}
        <p className="text-2xs text-muted-foreground">{recipe.note}</p>
      </section>
      <section className="space-y-1.5" aria-label="Figures drawn by">
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
      <section className="space-y-1.5" aria-label="Views">
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
                    view.failed && view.state !== 'captured'
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
            ? 'The block note, the analysis sheet, the VIA document and the VIA report take these views. A view of interest not yet captured is captured on Preview or Download: the page stands there, runs and saves it as Save viewpoint does.'
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
  onCapture,
  onCancelCapture,
  portalContainer,
}: {
  open: boolean
  initialOutput: VisualsExport
  onOpenChange: (open: boolean) => void
  context: ExportContext
  /** Each output's own options (stations, figure style, block), shown above what goes in. */
  options: Partial<Record<VisualsExport, ReactNode>>
  /** Writes one output; `signal` aborts when the selection or its content changes. */
  build: (kind: VisualsExport, format: string, signal: AbortSignal) => Promise<BuiltFile>
  /** Changes whenever an output's content would. */
  version: unknown
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
  /** Captures views of interest as saved views (`viewsToCapture`), before an output that draws them is written. */
  onCapture?: (viewIds: readonly string[]) => Promise<ViewCaptureReport>
  /** Stops a capture in flight; the views captured so far are kept. */
  onCancelCapture?: () => void
  portalContainer?: HTMLElement | null
}) {
  const [selected, setSelected] = useState<VisualsExport>(initialOutput)
  // The package's entry is open in place of an output's pane.
  const [packageOpen, setPackageOpen] = useState(false)
  // Teal in the built-in theme; an Appearance theme's own selection colours under one.
  const themed = useInterfaceThemeApplied()
  const [view, setView] = useState<'contents' | 'preview'>('contents')
  const [formats, setFormats] = useState<Partial<Record<VisualsExport, string>>>({})
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ tone: 'info' | 'warning' | 'error'; text: string } | null>(null)
  // Open on the requested output, including when the previous session used another.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSelected(initialOutput)
      setPackageOpen(false)
      setView('contents')
      setStatus(null)
    }
  }
  const item = findVisualsExport(selected)
  const format = item.formats.find((entry) => entry.id === formats[item.kind]) ?? item.formats[0]
  const unavailable = exportUnavailable(item.kind, context)
  const sections = useMemo(() => exportContents(item.kind, context), [item.kind, context])
  const preparation = exportPreparation(item.kind, context)

  // A new object per selection or content change: a preview is current only for its own request.
  const request = useMemo(() => ({ kind: item.kind, format: format.id, version }), [item.kind, format.id, version])
  const [result, setResult] = useState<PreviewResult | null>(null)
  const latestBuild = useRef(build)
  const latestContext = useRef(context)
  const latestRun = useRef(onRun)
  const latestRender = useRef(onRender)
  const latestReadInventory = useRef(onReadInventory)
  const latestCapture = useRef(onCapture)
  const latestCancelCapture = useRef(onCancelCapture)
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
  })
  useEffect(() => {
    changedAt.current = Date.now()
  }, [version])

  /**
   * Makes what the output reads before it is written: the views of interest the package includes and has not
   * captured (first, since capturing stands at each and runs there), the visibility run, in the analysis worker,
   * when it is missing or stale, and the land checks the block note prints. Then waits for the page to settle, so
   * the build that follows (`latestBuild`, from the render after) reads the new run and the views as captured.
   * Resolves with the views of interest the file goes without, worded, or null.
   */
  const prepare = useCallback(async (kind: VisualsExport, signal: AbortSignal, retry = false) => {
    let waited = false
    const toCapture = exportPreparation(kind, latestContext.current, { retry }).capture
    const capturing = () => latestContext.current.capture.status === 'running'
    if (captureInFlight.current || (USES_PACKAGE_VIEWS.has(kind) && capturing()) || toCapture.length) {
      waited = true
      if (!captureInFlight.current && !capturing() && latestCapture.current) {
        const pending = latestCapture.current(toCapture)
        captureInFlight.current = pending
        const clear = () => {
          if (captureInFlight.current === pending) captureInFlight.current = null
        }
        pending.then(clear, clear)
      }
      if (captureInFlight.current) {
        const report = await untilAborted(captureInFlight.current, signal)
        if (report.cancelled)
          throw new Error(
            'Capturing the views of interest was cancelled, so nothing was written. Preview writes the file with the views captured so far; Download tries the rest again.',
          )
      } else await waitFor(() => !capturing(), signal)
      // The capture steps back to where the reviewer stood: let the page settle before reading what it needs now.
      await waitFor(() => Date.now() - changedAt.current >= SETTLE_MS, signal)
    }
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
      inventoryRead = waitFor(
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
      )
    }
    if (needs.run || (running() && RUNS_ON_EXPORT.has(kind))) {
      waited = true
      if (!running()) latestRun.current?.()
      const asked = Date.now()
      let started = running()
      await waitFor(() => {
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
      }, signal)
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
      await waitFor(() => {
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
      }, signal)
    }
    if (waited) await waitFor(() => Date.now() - changedAt.current >= SETTLE_MS, signal)
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

  useEffect(() => {
    if (!open || unavailable || view !== 'preview' || packageOpen) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      let missing: string | null = null
      prepare(request.kind, controller.signal)
        .then((note) => {
          missing = note
          return latestBuild.current(request.kind, request.format, controller.signal)
        })
        .then(async (file) => {
          const preview = await previewOf(file)
          if (controller.signal.aborted) {
            if ('url' in preview) URL.revokeObjectURL(preview.url)
          } else setResult({ request, file, preview, missing })
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
  }, [open, request, unavailable, view, packageOpen, prepare])
  // Object URLs live as long as their preview.
  useEffect(() => {
    const preview = result?.preview
    return () => {
      if (preview && 'url' in preview) URL.revokeObjectURL(preview.url)
    }
  }, [result])
  const current = result?.request === request ? result : null

  const pane = useRef<HTMLElement>(null)
  const select = (kind: VisualsExport) => {
    setSelected(kind)
    setPackageOpen(false)
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
        file = await latestBuild.current(item.kind, format.id, controller.signal)
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
    setStatus(null)
    requestAnimationFrame(() => pane.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }
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
      <div className="grid min-w-0 sm:h-full sm:min-h-[24rem] sm:grid-cols-[15rem_minmax(0,1fr)]">
        <nav
          aria-label="Files"
          className="border-b border-border py-1 sm:min-h-0 sm:overflow-y-auto overscroll-none sm:border-b-0 sm:border-r"
        >
          {packagePane && (
            <div>
              <h3 className="px-3 pb-1 pt-3 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
                Chosen once
              </h3>
              <ResultRow
                accent={themed ? 'theme' : 'teal'}
                selected={packageOpen}
                title="Package"
                subtitle={packageSummary(context)}
                className="py-2"
                aria-label={`Package: ${packageSummary(context)}`}
                onClick={openPackage}
              />
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
                    selected={!packageOpen && entry.kind === item.kind}
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
        {packageOpen && packagePane ? (
          <section ref={pane} aria-label="Package" className="flex min-w-0 flex-col gap-3 p-3 sm:min-h-0 sm:p-5">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Package</h3>
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
            <div className="min-h-0 flex-1 sm:overflow-y-auto overscroll-none">{packagePane}</div>
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
                value={view}
                onChange={setView}
                options={[
                  { value: 'contents' as const, label: 'What goes in' },
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
            {!unavailable && preparation.note && (
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
            <div className="min-h-0 flex-1 sm:overflow-y-auto overscroll-none">
              {view === 'contents' ? (
                <div className="grid gap-4 pb-2">
                  {options[item.kind] && (
                    <section className="space-y-1.5" aria-label="Options">
                      <h4 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Options</h4>
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
              ) : current?.error ? (
                <InlineAlert tone="error">{current.error}</InlineAlert>
              ) : (
                <InlineAlert loading>Preparing preview…</InlineAlert>
              )}
            </div>
          </section>
        )}
      </div>
    </PanelDialog>
  )
}
