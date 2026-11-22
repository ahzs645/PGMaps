import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Circle, Download, Loader2, Save, Square } from 'lucide-react'

import { PreparerProfileHostProvider, PreparerProfilePane, PreparerProfileRow } from '@/branding/PreparerProfile'
import { Button } from '@/components/ui/button'
import { CopyImageButton } from '@/components/ui/copy-image-button'
import { DocumentContents, type DocumentContentsProps } from '@/components/ui/document-contents'
import { StyledSelect } from '@/components/ui/form-field'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { FramePages } from '@/components/ui/frame-pages'
import { PdfPages } from '@/components/ui/pdf-pages'
import { PicturePreview } from '@/components/ui/picture-preview'
import { insetBox } from '@/components/ui/inset-box'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { ProjectionSlot, useProjectableMounted } from '@/components/ui/movable-content'
import { ResultRow } from '@/components/ui/result-list'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TextButton } from '@/components/ui/text-button'
import { downloadBlob } from '@/lib/download'
import { SaveFileError, saveFileAs, saveFilePickerSupported } from '@/lib/saveFile'
import type { ContentsPart } from '@/lib/documentContents/contents'
import { useElementSize } from '@/hooks/useElementSize'
import { useSizeFold } from '@/hooks/useSizeFold'
import { useInterfaceThemeApplied } from '@/lib/interfaceTheme'
import { cn } from '@/lib/utils'

import { timed } from './exportTiming'
import { readBackFor, type FileReadBack } from './exportFilePreview'
import { ReportDraftView, type ReportDraftPages, type ReportDraftResult } from './ReportDraftView'
import type { ViewCaptureReport } from './useViewCapture'
import { VIA_STEPS, type ViaStepId } from './via'
import {
  exportContents,
  exportEditorId,
  exportPreparation,
  OPEN_PACKAGE_ACTION,
  packageSummary,
  rendererMissing,
  uncapturedNote,
  exportFileType,
  exportUnavailable,
  findVisualsExport,
  suggestedExportName,
  DRAWS_FIGURES,
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
 * that did not load, say), shown over the preview and beside the save line. `readBack` says how the preview reads a
 * file back that its type alone does not (a ZIP of shapefiles or of an OBJ and its `.mtl`, `exportFilePreview.ts`).
 * `previewOf` marks a preview that is part of the download (a block sheet series' first sheet), in words: it is shown
 * over the preview, and Download makes the whole file rather than saving it. `copyPng` makes the previewed picture as
 * a PNG at print resolution from what was drawn for it, for *Copy image*; absent, nothing is offered to copy.
 */
export type BuiltFile = {
  blob: Blob
  fileName: string
  notes?: string
  readBack?: FileReadBack
  previewOf?: string
  copyPng?: () => Promise<Blob>
}

/** How a file is being written: for the preview (which may be a part of it, `BuiltFile.previewOf`) and its progress. */
export type BuildOptions = { preview?: boolean; onProgress?: (text: string) => void }

/**
 * An output whose format the page keeps rather than the dialog (the block map sheet's, kept in this browser with its
 * other settings): the chips read and write it, and `extension` is what the download really is (a series' `.zip`).
 */
export type FormatControl = { value: string; onChange: (id: string) => void; extension?: string }

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

/**
 * An output recorded on request rather than written on Preview (the road view video): a take runs as long as the
 * video, so opening the output or its preview never starts one. Its pane records it (`record`, with *Stop*), shows its
 * progress and plays the recorded file; *Download* and *Save as…* write that same file and never record again. While
 * a take runs, no other output is previewed or written: a take moves the road view.
 */
export type OutputRecording = {
  /** What a take records, in one line. */
  plan: string
  /** Why it cannot be recorded as set (past the time limit, nothing to film), or null. */
  problem: string | null
  status: 'idle' | 'preparing' | 'recording' | 'stopping' | 'done' | 'cancelled' | 'error'
  /** What the take is doing, or how it ended. */
  message: string | null
  /** "12 s of 1 min 40 s" while it records. */
  progress: string | null
  /** The recorded file for the output as it is set now, with its address for the player; null until recorded. */
  file: (BuiltFile & { url: string; summary: string }) | null
  /** Said when the take kept was recorded with other settings, so it is not this output's file. */
  otherTake: string | null
  /** The monitor's shape, width over height. */
  aspect: number
  record: () => Promise<void>
  /** Ends the take, keeping what was recorded. */
  stop: () => void
  /** Ends the take and keeps nothing: before it records, and when the dialog closes. */
  cancel: () => void
  /** The small live picture of what is being recorded. */
  monitor?: (canvas: HTMLCanvasElement | null) => void
}

const recordingBusy = (recording: OutputRecording | undefined) =>
  !!recording &&
  (recording.status === 'preparing' || recording.status === 'recording' || recording.status === 'stopping')

/** A small live picture of what a take records: the canvas is lent to the take while shown (`attach`). */
function RecordingMonitor({ attach, aspect }: { attach: (canvas: HTMLCanvasElement | null) => void; aspect: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    attach(canvas.current)
    return () => attach(null)
  }, [attach])
  return (
    <canvas
      ref={canvas}
      width={480}
      height={Math.max(2, Math.round(480 / Math.max(0.1, aspect)))}
      aria-label="What is being recorded"
      className="w-full max-w-md rounded-md border bg-black"
    />
  )
}

/** The pane of an output recorded on request: its plan, *Record* or *Stop* with the progress, and the recorded file. */
function RecordingPane({
  recording,
  title,
  blocked,
  onRecord,
}: {
  recording: OutputRecording
  title: string
  /** Why a take cannot start now (a capture or a file being written), or null. */
  blocked: string | null
  onRecord: () => void
}) {
  const busy = recordingBusy(recording)
  const preparing = recording.status === 'preparing'
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <p className="text-xs text-muted-foreground">{recording.plan}</p>
      {recording.problem && <InlineAlert tone="warning">{recording.problem}</InlineAlert>}
      <div className="flex flex-wrap items-center gap-2">
        {busy ? (
          <Button
            variant="outline"
            disabled={recording.status === 'stopping'}
            aria-label={preparing ? `Cancel ${title}` : `Stop ${title}`}
            onClick={preparing ? recording.cancel : recording.stop}
          >
            <Square className="size-4" />
            {preparing ? 'Cancel' : 'Stop'}
          </Button>
        ) : (
          <Button
            disabled={!!recording.problem || !!blocked}
            aria-label={`Record ${title}`}
            title={blocked ?? undefined}
            onClick={onRecord}
          >
            <Circle className="size-4 fill-current text-destructive" />
            {recording.file ? 'Record again' : 'Record'}
          </Button>
        )}
        {busy && (
          <span role="status" className="text-xs text-muted-foreground">
            {[recording.progress, recording.message].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      {!busy && blocked && <p className="text-2xs text-muted-foreground">{blocked}</p>}
      {busy && recording.monitor && <RecordingMonitor attach={recording.monitor} aspect={recording.aspect} />}
      {!busy && recording.message && (
        <InlineAlert
          tone={recording.status === 'error' ? 'error' : recording.status === 'done' ? 'success' : 'warning'}
        >
          <span role="status">{recording.message}</span>
        </InlineAlert>
      )}
      {!busy && recording.otherTake && <InlineAlert tone="warning">{recording.otherTake}</InlineAlert>}
      {recording.file && !busy ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1">
          <video
            controls
            src={recording.file.url}
            aria-label={`${title} preview`}
            className="max-h-[32rem] w-full rounded-md border bg-black"
          />
          <p className="text-2xs text-muted-foreground">{recording.file.summary}</p>
        </div>
      ) : (
        !busy && (
          <p className={cn(insetBox({ padding: 'lg' }), 'border-dashed text-xs text-muted-foreground')}>
            Nothing recorded yet. Record plays the road view as planned and records it in real time; the preview is the
            recorded file, and Download and Save as… write it.
          </p>
        )
      )}
    </div>
  )
}

const GROUPS = Object.keys(VISUALS_EXPORT_GROUP_LABELS) as VisualsExportGroup[]
// Option edits rebuild the preview; a short pause keeps typing from rebuilding it per key.
const PREVIEW_DELAY_MS = 300
/** How many outputs' written previews the dialog keeps; the oldest shown gives way. */
const KEPT_PREVIEWS = 6
/**
 * Where an output's pane puts *What goes in* beside its preview: from about 900 px, which the dialog has at its widest
 * normal size and at Full screen. The gap keeps a pane dragged across the line from flipping.
 */
const SIDE_BY_SIDE_FOLD = { foldBelow: 860, unfoldFrom: 900 }
/** The dialog at its normal size: wide enough for what goes in and a preview side by side on a laptop screen. */
const DIALOG_MAX_WIDTH = 'min(80rem, calc(100vw - 2rem))'
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
/** `DOCX_TYPE` in `viaReportWord.ts`, which is only loaded with a Word file. */
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

async function previewOf(file: BuiltFile): Promise<Preview> {
  const type = file.blob.type
  if (type === 'application/pdf') return { type: 'pdf', url: URL.createObjectURL(file.blob) }
  if (type.startsWith('image/')) return { type: 'image', url: URL.createObjectURL(file.blob) }
  // A GeoPackage, a KMZ, a 3D model or a ZIP of shapefiles: the bytes read back, as a GIS or a viewer would read them.
  const readBack = readBackFor(type, file.readBack)
  if (readBack) {
    const [{ readBackText }, bytes, SQL] = await Promise.all([
      import('./exportFilePreview'),
      file.blob.arrayBuffer(),
      readBack === 'geopackage' ? import('@/lib/browserSqlite').then((module) => module.loadSqlJs()) : undefined,
    ])
    const text = readBackText(readBack, new Uint8Array(bytes), SQL)
    return { type: 'text', text: text.slice(0, TEXT_PREVIEW_CHARS), truncated: text.length > TEXT_PREVIEW_CHARS }
  }
  // A workbook is shown as its sheets, read back from the file itself, never as its zipped bytes.
  if (type === XLSX_TYPE) {
    const [{ workbookPreviewHtml }, ExcelJS] = await Promise.all([import('./workbookPreview'), import('exceljs')])
    return { type: 'html', html: await workbookPreviewHtml(await file.blob.arrayBuffer(), ExcelJS) }
  }
  // A Word file is shown as its pages, laid out from the file itself by the kit, never as its zipped bytes.
  if (type === DOCX_TYPE) {
    const { viaReportWordPagesHtml } = await import('./viaReportWord')
    return { type: 'html', html: await viaReportWordPagesHtml(new Uint8Array(await file.blob.arrayBuffer())) }
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

/** A preview that was written, kept by `previewKey` to be shown again while its content is unchanged. */
type WrittenPreview = { request: object; file: BuiltFile; preview: Preview; missing: string | null }
/** Which written preview a request can take: the same output, format and content version. */
const previewKey = (request: { kind: string; format: string; version: string }) =>
  `${request.kind}\u0000${request.format}\u0000${request.version}`

type PreviewResult =
  | { request: object; file: BuiltFile; preview: Preview; error?: undefined; missing: string | null; outdated?: true }
  | { request: object; file?: undefined; preview?: undefined; error: string; missing?: undefined }

const stepLabel = (id: ViaStepId) => {
  const step = VIA_STEPS.find((entry) => entry.id === id)
  return step ? `Step ${step.number}` : id
}

/**
 * The controls a page gives an output's parts list (`ExportSection.contents`): what changes a part's state, its place,
 * what is added or removed, and the presets. Without them the list is read-only.
 */
export type ContentsControls = Pick<
  DocumentContentsProps,
  'onState' | 'onStates' | 'onMove' | 'onRemove' | 'add' | 'presets' | 'choices' | 'stateLabel'
>

/** What a parts list shows beside it: the preview of the selected part, and which part that is. */
type ContentsPreviewProps = Pick<
  DocumentContentsProps,
  'preview' | 'previewLabel' | 'selected' | 'onSelect' | 'focusKey'
>

/**
 * One part of an output: what the file takes, and where it is changed. A part with an `editor` is changed under its
 * own rows (*Edit here*): the sidebar section that sets it is shown there (`ProjectionSlot`, the same controls and
 * state as in its step, moved rather than copied) or, for the views of interest, their list. Without one, or while
 * the sidebar is not on the page, the link opens the step instead and closes the dialog. A part that is the file's own
 * parts list (`contents`) is drawn by the shared `DocumentContents`, with the page's `controls` and the preview beside
 * it (`list`).
 */
function ContentsSection({
  section,
  onGoToStep,
  onAction,
  viewsEditor,
  editing,
  onEditing,
  controls,
  list,
}: {
  section: ExportSection
  onGoToStep?: (id: ViaStepId) => void
  onAction?: (action: ExportAction) => void
  /** The views of interest, for a part whose editor is `views`. */
  viewsEditor?: ReactNode
  editing: boolean
  onEditing: (on: boolean) => void
  /** For a parts list: the controls that change it. */
  controls?: ContentsControls
  /** For a parts list: its preview, its selected part and its size. */
  list?: ContentsPreviewProps
}) {
  const empty = !section.rows?.length && !section.items?.length
  const projected = useProjectableMounted(
    section.editor && section.editor !== 'views' ? exportEditorId(section.editor) : null,
  )
  const editor =
    section.editor === 'views' ? (
      (viewsEditor ?? null)
    ) : section.editor && projected ? (
      <ProjectionSlot id={exportEditorId(section.editor)} />
    ) : null
  const part = useRef<HTMLElement>(null)
  // The editor opens under the part's rows, often below the fold: bring the part to the top of the pane, so its
  // rows and the controls that change them are read together.
  useEffect(() => {
    if (editing && editor) part.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    // Only when it opens: the editor's own changes must not scroll the pane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])
  const actions = (
    <>
      {section.action && onAction && (
        <TextButton className="text-2xs" onClick={() => onAction(section.action!)}>
          {section.action.label}
        </TextButton>
      )}
      {editor ? (
        <TextButton
          className="text-2xs"
          aria-expanded={editing}
          aria-label={`${editing ? 'Done editing' : 'Edit here'}: ${section.title}`}
          onClick={() => onEditing(!editing)}
        >
          {editing ? 'Done' : 'Edit here'}
        </TextButton>
      ) : (
        section.step &&
        onGoToStep && (
          <TextButton className="text-2xs" onClick={() => onGoToStep(section.step!)}>
            Change in {stepLabel(section.step)}
          </TextButton>
        )
      )}
    </>
  )
  const contents = section.contents
  return (
    <section
      ref={part}
      className="scroll-mt-1 space-y-1.5"
      aria-label={contents ? undefined : section.title}
      data-export-contents={contents ? '' : undefined}
    >
      {contents ? (
        <DocumentContents
          title={section.title}
          subject={contents.subject}
          parts={contents.parts}
          {...(contents.help ? { help: contents.help } : {})}
          {...(contents.summary ? { summary: contents.summary } : {})}
          {...controls}
          {...list}
          actions={actions}
        />
      ) : (
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{section.title}</h4>
          <div className="flex shrink-0 flex-wrap items-baseline justify-end gap-x-3">{actions}</div>
        </div>
      )}
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
      {empty && section.empty && !contents?.parts.length && (
        <p className="text-2xs text-muted-foreground">{section.empty}</p>
      )}
      {section.note && <p className="text-2xs text-muted-foreground">{section.note}</p>}
      {editing && editor && (
        <div
          className={cn(insetBox({ padding: 'none' }), 'overflow-hidden border-primary/40')}
          data-export-editor={section.editor}
        >
          {/* A sidebar section brings its own padding and bottom rule, which the line below sits on. */}
          <div className={section.editor === 'views' ? 'p-2.5' : '-mb-px'}>{editor}</div>
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-border bg-muted/40 px-2.5 py-1.5 text-2xs text-muted-foreground">
            <span>
              {section.step
                ? `The same controls as ${stepLabel(section.step).toLowerCase()}: a change here is made there too.`
                : 'A change here is made on the page too.'}{' '}
              Drawing on the map closes this window.
            </span>
            {section.step && onGoToStep && (
              <TextButton className="shrink-0 text-2xs" onClick={() => onGoToStep(section.step!)}>
                Open {stepLabel(section.step).toLowerCase()}
              </TextButton>
            )}
          </p>
        </div>
      )}
    </section>
  )
}

/** Scrolls a draft frame to a part's mark, or to the top when there is none. */
function showDraftPlace(frame: HTMLIFrameElement | null, place: number | null, smooth: boolean) {
  const win = frame?.contentWindow
  const doc = frame?.contentDocument
  if (!win || !doc) return
  const mark = place === null ? null : doc.getElementById(`part-${place}`)
  // The frame's own window is scrolled, never `scrollIntoView`: from inside a frame that also scrolls the dialog's
  // pane, which pushed the contents list's heading out of view on every row chosen.
  const top = mark ? Math.max(0, mark.getBoundingClientRect().top + win.scrollY - 8) : 0
  win.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
}

/**
 * The VIA report's draft at one part, beside its contents: the same draft page the *Draft* view shows, scrolled to the
 * part's mark (`part-<place>`), or to the top for the whole report. A click on a part's mark selects its row. Nothing
 * is captured or run for it.
 */
function DraftPartFrame({
  html,
  place,
  onPlace,
}: {
  html: string
  /** The part's place among the printing parts, or null for the whole report. */
  place: number | null
  onPlace: (place: number) => void
}) {
  const frame = useRef<HTMLIFrameElement | null>(null)
  const latest = useRef({ place, onPlace })
  useEffect(() => {
    latest.current = { place, onPlace }
  })
  useEffect(() => {
    showDraftPlace(frame.current, place, true)
  }, [place])
  const onLoad = () => {
    showDraftPlace(frame.current, latest.current.place, false)
    // The frame runs no scripts of its own; the dialog listens for clicks on its part marks.
    frame.current?.contentDocument?.addEventListener('click', (event) => {
      const mark = (event.target as Element | null)?.closest?.('.draft-part')
      const at = Number(mark?.getAttribute('data-part'))
      if (mark && Number.isInteger(at)) latest.current.onPlace(at)
    })
  }
  return (
    <FramePages
      html={html}
      title="VIA report draft"
      frameTitle="VIA report draft at the selected part"
      resetKey="draft"
      frameRef={(element) => {
        frame.current = element
      }}
      onFrameLoad={onLoad}
      className="h-[60dvh] min-w-0 sm:h-full sm:min-h-80"
    />
  )
}

function PreviewView({ preview, title }: { preview: Preview; title: string }) {
  // Every file in the same viewer (`docs/shared-ui.md`, **File previews**); a rebuilt file of the same output keeps
  // the reader's zoom and place.
  switch (preview.type) {
    case 'pdf':
      return <PdfPages source={preview.url} title={title} resetKey={title} className="min-h-96" />
    case 'image':
      return <PicturePreview src={preview.url} title={title} resetKey={title} className="min-h-96" />
    case 'html':
      return <FramePages html={preview.html} title={title} resetKey={title} className="min-h-96" />
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
  'screenshot-only':
    'Saved with its screenshot, without its analysis sheet: the sheet is drawn again on Preview or Download',
  'no-figure': 'Captured without its analysis sheet: captured again on Preview or Download',
  'not-captured': 'To capture on Preview or Download',
}

/** A view of interest's capture state as the package lists it: "Captured", or a sentence saying what happens next. */
function plannedCaptureState(view: ExportPlannedView): string {
  if (view.failed && (view.state === 'no-figure' || view.state === 'screenshot-only'))
    return `Captured without its analysis sheet: ${view.failed.replace(/^Saved, but /, '').replace(/[.\s]*$/, '')}`
  if (view.failed && view.state !== 'captured') return `Not captured: ${view.failed.replace(/[.\s]*$/, '')}`
  return CAPTURE_LABELS[view.state]
}

/** A package view list's count line: "2 of 3 in the package". */
function viewCount(parts: readonly ContentsPart[]): string {
  const included = parts.filter((part) => part.state === 'on').length
  if (included === parts.length) return parts.length === 1 ? 'In the package' : `All ${parts.length} in the package`
  return included ? `${included} of ${parts.length} in the package` : 'None in the package'
}

/** All / None's changes, as the package's include flags. */
const includeChanges = (changes: Record<string, string>) =>
  Object.fromEntries(Object.entries(changes).map(([id, state]) => [id, state === 'on']))

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
  /** Writes views of interest's `include`, every change of one click at once; absent, the list only shows them. */
  onPlannedInclude?: (changes: Record<string, boolean>) => void
  onSavedInclude: (changes: Record<string, boolean>) => void
}) {
  // The views in the package's own order, never reordered here: the state lives in `resolvePackage`, the list only
  // draws it. A capture state of a word goes on the row, a sentence under the name.
  const plannedParts: ContentsPart[] = planned.map((view) => {
    const capture = plannedCaptureState(view)
    const short = capture === CAPTURE_LABELS.captured
    return {
      key: view.id,
      label: view.name,
      state: view.include ? 'on' : 'off',
      detail: short ? capture : undefined,
      note: [view.block, view.lens, ...(short ? [] : [capture])].join(' · '),
    }
  })
  const savedParts: ContentsPart[] = saved.map((view) => ({
    key: view.id,
    label: view.name,
    state: view.included ? 'on' : 'off',
    note: `Saved view · ${view.detail}`,
  }))
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
      <section className="min-w-0 space-y-3" aria-label="Views">
        <PackageHeading>Views</PackageHeading>
        {planned.length > 0 && (
          <DocumentContents
            title="Views of interest"
            subject="the package"
            parts={plannedParts}
            summary={viewCount(plannedParts)}
            onState={onPlannedInclude ? (id, state) => onPlannedInclude({ [id]: state === 'on' }) : undefined}
            onStates={onPlannedInclude ? (changes) => onPlannedInclude(includeChanges(changes)) : undefined}
            rowLead={(part) => {
              const view = planned.find((entry) => entry.id === part.key)
              return view ? (
                <ViewThumbnail src={view.thumbnail} empty={view.state === 'captured' ? 'No picture' : 'Not captured'} />
              ) : null
            }}
          />
        )}
        {saved.length > 0 && (
          <DocumentContents
            title="Saved views"
            subject="the package"
            parts={savedParts}
            summary={viewCount(savedParts)}
            onState={(id, state) => onSavedInclude({ [id]: state === 'on' })}
            onStates={(changes) => onSavedInclude(includeChanges(changes))}
            rowLead={(part) => (
              <ViewThumbnail
                src={saved.find((entry) => entry.id === part.key)?.thumbnail ?? null}
                empty="No screenshot"
              />
            )}
          />
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
  formatControls,
  onGoToStep,
  onAction,
  onRun,
  onRender,
  onReadInventory,
  packagePane,
  viewsPane,
  viewsSummary,
  drafts,
  contents,
  recordings,
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
  /** Writes one output; `signal` aborts when the selection or its content changes, or the dialog closes. */
  build: (kind: VisualsExport, format: string, signal: AbortSignal, options?: BuildOptions) => Promise<BuiltFile>
  /** Changes whenever this output's content would (and never for another output's state or a wait's progress). */
  version: (kind: VisualsExport) => string
  /** Outputs whose format the page keeps (`FormatControl`); the others keep theirs in the dialog while it is open. */
  formatControls?: Partial<Record<VisualsExport, FormatControl>>
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
   * The controls of each output's parts list (`ExportSection.contents`, drawn by `DocumentContents` first in *What
   * goes in*): the VIA report's recipe, the block note's land status checks, the FS1252's stations. Absent for an
   * output: its list is read-only.
   */
  contents?: Partial<Record<VisualsExport, ContentsControls>>
  /** Outputs recorded on request rather than written on Preview (`OutputRecording`): the road view video. */
  recordings?: Partial<Record<VisualsExport, OutputRecording>>
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
  // The pages each part of the draft starts on, once its *Pages* layout has written them, for the draft they came from.
  const [draftPages, setDraftPages] = useState<{ draft: ReportDraftResult; partPages: number[] } | null>(null)
  // The part of a parts list whose preview is shown, and the row a click in that preview brings into view.
  const [partSelected, setPartSelected] = useState<string | null>(null)
  const [partFocus, setPartFocus] = useState<string | undefined>(undefined)
  const [drawing, setDrawing] = useState<string | null>(null)
  const [drawError, setDrawError] = useState<string | null>(null)
  const [formats, setFormats] = useState<Partial<Record<VisualsExport, string>>>({})
  const [saving, setSaving] = useState(false)
  // A long file's progress while Download or Save as writes it (a block sheet series, sheet by sheet), and its Stop.
  const [saveStage, setSaveStage] = useState<string | null>(null)
  const saveController = useRef<AbortController | null>(null)
  const [status, setStatus] = useState<{ tone: 'info' | 'warning' | 'error'; text: string } | null>(null)
  // The part being edited in place (`ContentsSection`), by its title: one at a time, since a part's editor is one
  // element shown in one place.
  const [editing, setEditing] = useState<string | null>(null)
  // Side by side, the output whose preview was asked for with *Build preview* (see `previewOnRequest` below).
  const [previewAsked, setPreviewAsked] = useState<VisualsExport | null>(null)
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
      setEditing(null)
      setPartSelected(null)
      setPreviewAsked(null)
    }
  }
  const item = findVisualsExport(selected)
  const draftOf = drafts?.[item.kind]
  // The selected output when it is recorded on request, and whether any take is under way (which holds every
  // preview and file: a take moves the road view).
  const recordingOf = recordings?.[item.kind]
  const runningTake = Object.values(recordings ?? {}).find(recordingBusy)
  const takeRunning = !!runningTake
  // An output without a draft shows its contents in place of one.
  const shownView = view === 'draft' && !draftOf ? 'contents' : view
  // *What goes in* beside the file once the pane has room for both (a wide window or Full screen), with no Preview
  // tab. An output with a draft (the VIA report) keeps its tabs: its contents already show the draft beside them.
  // The pane is one of three sections (an output, Package, Views), swapped as the list is used: it is measured as the
  // element mounted now, never a ref read once.
  const pane = useRef<HTMLElement | null>(null)
  const [paneElement, setPaneElement] = useState<HTMLElement | null>(null)
  const paneRef = (element: HTMLElement | null) => {
    pane.current = element
    setPaneElement(element)
  }
  const { width: paneWidth } = useElementSize(paneElement)
  const narrowPane = useSizeFold(paneWidth, SIDE_BY_SIDE_FOLD, true)
  const sideBySide = !narrowPane && !draftOf
  // Whether the file's preview is on screen: its tab, or its column.
  const previewShown = sideBySide || shownView === 'preview'
  /** The format chosen for an output: the page's (`formatControls`) where it keeps it, else this dialog's. */
  const formatOf = (entry: (typeof VISUALS_EXPORTS)[number]) => {
    const control = formatControls?.[entry.kind]
    const chosen =
      entry.formats.find((f) => f.id === (control ? control.value : formats[entry.kind])) ?? entry.formats[0]
    return control?.extension ? { ...chosen, extension: control.extension } : chosen
  }
  const chooseFormat = (kind: VisualsExport, id: string) => {
    const control = formatControls?.[kind]
    if (control) control.onChange(id)
    else setFormats((current) => ({ ...current, [kind]: id }))
  }
  const format = formatOf(item)
  // A take under way keeps its pane (and its Stop) whatever the road view reports meanwhile.
  const unavailable = recordingBusy(recordingOf) ? null : exportUnavailable(item.kind, context)
  const preparation = exportPreparation(item.kind, context)
  // Side by side, the preview is written as soon as the output is open, unless writing it would first run the
  // assessment, capture views of interest, wait for another engine's renders or draw figures from the road view:
  // those wait for *Build preview*, as they wait for the Preview tab, so opening an output never moves the page or
  // starts a run.
  const previewOnRequest =
    sideBySide &&
    previewAsked !== item.kind &&
    (preparation.run || preparation.capture.length > 0 || preparation.render || DRAWS_FIGURES.has(item.kind))

  // A new object per selection or content change: a preview is current only for its own request.
  const itemVersion = version(item.kind)
  const request = useMemo(
    () => ({ kind: item.kind, format: format.id, version: itemVersion }),
    [item.kind, format.id, itemVersion],
  )
  const [result, setResult] = useState<PreviewResult | null>(null)
  // Previews already written, by output, format and content version: going back to an output whose content has not
  // changed shows its file at once, with nothing prepared, captured or written again. The oldest shown gives way.
  const [kept, setKept] = useState<ReadonlyMap<string, WrittenPreview>>(() => new Map())
  const keptResult = kept.get(previewKey(request))
  const hasKept = !!keptResult
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
  const latestRecordings = useRef(recordings)
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
    latestRecordings.current = recordings
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

  // A wait in flight stops with the dialog, and so does a capture it started, and a take: they drive the page. A
  // cancelled take keeps nothing and hands the road view back (`useRoadVideo`'s `finally`).
  const live = useRef(new Set<AbortController>())
  useEffect(() => {
    const controllers = live.current
    return () => {
      controllers.forEach((controller) => controller.abort())
      if (captureInFlight.current) latestCancelCapture.current?.()
      for (const recording of Object.values(latestRecordings.current ?? {})) recording?.cancel()
    }
  }, [])

  /** Writes the file once the one before it is done; aborts while waiting, never in the middle of another's moves. */
  const writeFile = useCallback(
    async (
      kind: VisualsExport,
      formatId: string,
      signal: AbortSignal,
      onStage?: (text: string) => void,
      options?: BuildOptions,
    ) => {
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
      const job = timed(`write ${kind}`, () => latestBuild.current(kind, formatId, signal, options))
      buildInFlight.current = job.catch(() => undefined)
      return job
    },
    [],
  )

  // An output recorded on request is never written by its preview; no preview is written while a take runs.
  const recorded = !!recordingOf
  useEffect(() => {
    if (!open || unavailable || !previewShown || previewOnRequest || packageOpen || viewsOpen || detailsOpen) return
    if (recorded || takeRunning || hasKept) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      let missing: string | null = null
      prepare(request.kind, controller.signal)
        .then((note) => {
          missing = note
          const stage = (text: string) => {
            if (!controller.signal.aborted) setPreviewStage({ request, text })
          }
          return writeFile(request.kind, request.format, controller.signal, stage, { preview: true, onProgress: stage })
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
          } else {
            const written = { request, file, preview, missing: withFileNotes(missing, file) }
            setResult(written)
            setKept((previous) => {
              const next = new Map(previous)
              const key = previewKey(request)
              next.delete(key)
              next.set(key, written)
              while (next.size > KEPT_PREVIEWS) next.delete(next.keys().next().value!)
              return next
            })
          }
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
  }, [
    open,
    request,
    unavailable,
    previewShown,
    previewOnRequest,
    hasKept,
    packageOpen,
    viewsOpen,
    detailsOpen,
    prepare,
    writeFile,
    recorded,
    takeRunning,
  ])
  // The draft is laid out again whenever the output's content changes; it captures nothing, so it waits for nothing.
  // *What goes in* lays it out too, as the preview beside the output's contents.
  useEffect(() => {
    if (!open || unavailable || shownView === 'preview' || packageOpen || viewsOpen || detailsOpen) return
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
  // The draft's pages are known only for the draft they were written from.
  const reportPages = draftPages && draftPages.draft === shownDraft?.draft ? draftPages.partPages : null
  const sections = useMemo(() => exportContents(item.kind, context, { reportPages }), [item.kind, context, reportPages])
  /** Draws one picture group of the draft, after any file being written: both move the page's maps. */
  const drawPicture = async (id: string) => {
    const draft = latestDrafts.current?.[item.kind]
    if (!draft || drawing || takeRunning) return
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

  // Object URLs live as long as something shows or keeps their preview: the current result or a kept one.
  const ownedUrls = useRef(new Set<string>())
  useEffect(() => {
    const live = new Set<string>()
    for (const entry of [...kept.values(), result])
      if (entry?.preview && 'url' in entry.preview) live.add(entry.preview.url)
    for (const url of live) ownedUrls.current.add(url)
    for (const url of ownedUrls.current)
      if (!live.has(url)) {
        URL.revokeObjectURL(url)
        ownedUrls.current.delete(url)
      }
  }, [kept, result])
  useEffect(() => {
    const owned = ownedUrls.current
    return () => {
      owned.forEach((url) => URL.revokeObjectURL(url))
      owned.clear()
    }
  }, [])
  const current = useMemo(
    () => (result?.request === request ? result : keptResult ? { ...keptResult, request } : null),
    [result, request, keptResult],
  )
  // A preview written for content that has since changed, shown until the current one is written.
  const outdated = !current && result?.preview && result.request && 'outdated' in result ? result : null

  const select = (kind: VisualsExport) => {
    setSelected(kind)
    setEditing(null)
    setPartSelected(null)
    setPackageOpen(false)
    setViewsOpen(false)
    setDetailsOpen(false)
    setStatus(null)
    // Stacked on a phone, the pane sits under the list; bring it up. Side by side this does nothing.
    requestAnimationFrame(() => pane.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }
  /**
   * The file a download or *Save as…* writes: the previewed file when it is this one and nothing waits; otherwise made
   * and written now, with the run, the captures and the renders it reads made first (`prepare`). Either tries again
   * the views of interest whose capture failed. `missing` says what it was written without.
   */
  const fileToSave = async (signal: AbortSignal): Promise<{ file: BuiltFile; missing: string | null }> => {
    // A recorded output writes the take it holds, never a second one.
    if (recordingOf) {
      if (!recordingOf.file) throw new Error('Nothing recorded yet: record the video under Preview first.')
      return { file: recordingOf.file, missing: recordingOf.file.notes ?? null }
    }
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
    // A preview of part of the file (a series' first sheet) is never what is saved.
    if (ready && current?.file && !current.file.previewOf)
      return { file: current.file, missing: current.missing ?? null }
    const missing = await prepare(item.kind, signal, true)
    const file = await writeFile(item.kind, format.id, signal, undefined, {
      onProgress: (text) => {
        if (!signal.aborted) setSaveStage(text)
      },
    })
    return { file, missing: withFileNotes(missing, file) }
  }
  /** Stops a Download or Save as in flight (a long series); what was made so far is thrown away and nothing is saved. */
  const stopSaving = () => {
    saveController.current?.abort()
    saveController.current = null
    setSaving(false)
    setSaveStage(null)
    setStatus({ tone: 'warning', text: 'Stopped: nothing was saved.' })
  }
  const savedStatus = (fileName: string, missing: string | null) =>
    setStatus(
      missing
        ? { tone: 'warning', text: `Saved ${fileName}. ${missing}` }
        : { tone: 'info', text: `Saved ${fileName}.` },
    )
  const download = async () => {
    setSaving(true)
    setStatus(null)
    const controller = new AbortController()
    live.current.add(controller)
    saveController.current = controller
    try {
      const { file, missing } = await fileToSave(controller.signal)
      if (controller.signal.aborted) return
      downloadBlob(file.blob, file.fileName)
      savedStatus(file.fileName, missing)
    } catch (error) {
      if (error instanceof Aborted || controller.signal.aborted) return
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : 'The file could not be written.' })
    } finally {
      live.current.delete(controller)
      if (saveController.current === controller) saveController.current = null
      if (!controller.signal.aborted) {
        setSaving(false)
        setSaveStage(null)
      }
    }
  }
  /**
   * *Save as…*: the browser's save dialog opens first, inside the click (`saveFileAs`), and only once a place is chosen
   * is the file made, as Download makes it (`fileToSave`: the run, the captures and the renders first). A cancelled
   * dialog makes nothing.
   */
  const saveAs = () => {
    const controller = new AbortController()
    let missing: string | null = null
    // Synchronously, inside the click: the dialog needs the click's activation.
    const saving = saveFileAs({
      suggestedName: recordingOf?.file?.fileName ?? current?.file?.fileName ?? suggestedExportName(item, format),
      type: exportFileType(item, format),
      rememberFolderAs: 'pgmaps-visual-quality',
      content: async () => {
        const made = await fileToSave(controller.signal)
        missing = made.missing
        return made.file.blob
      },
    })
    setSaving(true)
    setStatus(null)
    live.current.add(controller)
    saveController.current = controller
    saving
      .then((result) => {
        if (controller.signal.aborted || result.outcome === 'cancelled') return
        savedStatus(result.fileName, missing)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof SaveFileError && error.cause instanceof Aborted)) return
        setStatus({ tone: 'error', text: error instanceof Error ? error.message : 'The file could not be saved.' })
      })
      .finally(() => {
        live.current.delete(controller)
        if (saveController.current === controller) saveController.current = null
        if (!controller.signal.aborted) {
          setSaving(false)
          setSaveStage(null)
        }
      })
  }
  // Where the browser has no save dialog, Save as would only repeat Download.
  const canSaveAs = useMemo(() => saveFilePickerSupported(), [])

  // A take waits for the file being written (both move the road view), and holds every other file until it ends.
  const recordBlocked = saving
    ? 'A file is being written: record once it is saved.'
    : context.capture.status === 'running'
      ? 'Views of interest are being captured: record once they are done.'
      : context.autoRun.status === 'running'
        ? 'The assessment is running: record once it finishes, since the road view reloads its terrain after a run.'
        : null
  const startRecording = async () => {
    const recording = latestRecordings.current?.[item.kind]
    if (!recording || takeRunning) return
    setStatus(null)
    await buildInFlight.current
    const job = recording.record()
    buildInFlight.current = job.catch(() => undefined)
    await job
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

  /**
   * The preview beside an output's parts list, for an output with a draft (the VIA report): the draft at the selected
   * part, laid out without capturing or running anything, or one line saying why there is no draft yet. The whole file
   * stays under *Draft* and *Preview*, full width.
   */
  const contentsPreview = (section: ExportSection): ContentsPreviewProps => {
    const places = section.contents?.places ?? {}
    const at = partSelected !== null ? (places[partSelected] ?? null) : null
    const keyAt = (place: number) => Object.keys(places).find((key) => places[key] === place)
    const off = partSelected !== null && at === null && section.contents?.parts.some((p) => p.key === partSelected)
    const line = (text: string) => <p className="text-xs text-muted-foreground">{text}</p>
    const preview = unavailable ? (
      line(`No draft yet. ${unavailable}`)
    ) : shownDraft?.draft ? (
      <div className="flex h-full min-h-0 flex-col gap-2">
        {off && line('Switched off: it prints nothing. Switch it on to see it in the draft.')}
        <div className="min-h-0 flex-1">
          <DraftPartFrame
            html={shownDraft.draft.html}
            place={at}
            onPlace={(place) => {
              const key = keyAt(place)
              if (!key) return
              setPartSelected(key)
              setPartFocus(key)
            }}
          />
        </div>
        {/* The draft is not the file: say so where it stands in for a preview. */}
        <p className="text-2xs text-muted-foreground">
          The draft: tinted values and dashed boxes mark what is still to fill in, and are not in the file.
        </p>
      </div>
    ) : shownDraft?.error ? (
      line(`No draft yet. ${shownDraft.error}`)
    ) : (
      <InlineAlert loading>Laying out the draft…</InlineAlert>
    )
    return {
      preview,
      previewLabel: 'Whole report',
      selected: partSelected,
      onSelect: setPartSelected,
      ...(partFocus ? { focusKey: partFocus } : {}),
    }
  }

  // The VIA report's draft, full width under its own tab.
  const draftView = shownDraft?.draft ? (
    <ReportDraftView
      draft={shownDraft.draft}
      options={options[item.kind]}
      drawing={drawing}
      onDraw={(id) => void drawPicture(id)}
      drawError={drawError}
      startOnPages={request.format === 'pdf'}
      onPages={(partPages) => setDraftPages({ draft: shownDraft.draft!, partPages })}
      {...(draftOf?.pages ? { pages: () => latestDrafts.current![item.kind]!.pages!() } : {})}
      {...(draftOf?.edit
        ? {
            onEdit: (key, value, original) => latestDrafts.current?.[item.kind]?.edit?.(key, value, original),
          }
        : {})}
    />
  ) : shownDraft?.error ? (
    <InlineAlert tone="error">{shownDraft.error}</InlineAlert>
  ) : (
    <InlineAlert loading>Laying out the draft…</InlineAlert>
  )
  // *What goes in*: one shape for every output, its own parts first (where it has a list of them), then its options,
  // then what it reads.
  const contentsView = (
    // One shape for every output: its own parts first (where it has a list of them), then its options,
    // then what it reads.
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 pb-2">
      {sections
        .filter((section) => section.contents)
        .map((section) => (
          <ContentsSection
            key={section.title}
            section={section}
            onGoToStep={onGoToStep}
            onAction={onAction || packagePane ? act : undefined}
            viewsEditor={viewsPane}
            editing={editing === section.title}
            onEditing={(on) => setEditing(on ? section.title : null)}
            controls={contents?.[item.kind]}
            list={draftOf ? contentsPreview(section) : undefined}
          />
        ))}
      {options[item.kind] && (
        <section className="space-y-1.5" aria-label="Options">
          <h4 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Options</h4>
          {options[item.kind]}
        </section>
      )}
      {sections
        .filter((section) => !section.contents)
        .map((section) => (
          <ContentsSection
            key={section.title}
            section={section}
            onGoToStep={onGoToStep}
            onAction={onAction || packagePane ? act : undefined}
            viewsEditor={viewsPane}
            editing={editing === section.title}
            onEditing={(on) => setEditing(on ? section.title : null)}
          />
        ))}
    </div>
  )
  // The file itself, from the same bytes its download writes; side by side, a preview that would first run the
  // assessment, capture views or wait for renders is written only on *Build preview*.
  // What writing the output does first (a run, a capture, the inventory read), and its progress.
  const preparationNote =
    !unavailable && preparation.note && !(previewShown && preparation.noteIsSkipped && current) ? (
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
    ) : null
  // Side by side, a preview that has to run, capture or draw first waits for *Build preview*: one line and the button,
  // with what writing it does first behind the (i).
  const buildOnRequest = previewOnRequest && !current?.preview && !unavailable && !recordingOf
  const previewView = buildOnRequest ? (
    <div className={cn(insetBox({ padding: 'sm' }), 'flex flex-wrap items-center gap-2 border-dashed text-xs')}>
      <span className="text-muted-foreground">Not built yet.</span>
      <Button variant="outline" size="sm" onClick={() => setPreviewAsked(item.kind)}>
        Build preview
      </Button>
      <InfoTip label="What building the preview does first">
        {preparation.note ??
          (preparation.capture.length
            ? 'It first captures the views of interest it draws, standing at each.'
            : preparation.render
              ? 'It first waits for the figures another engine still owes it.'
              : preparation.run
                ? 'It first runs the visibility assessment.'
                : 'It draws its figures from the road view, which moves it while they are taken.')}{' '}
        So it is written when you ask, as Download would.
      </InfoTip>
    </div>
  ) : unavailable ? (
    <p className={cn(insetBox({ padding: 'lg' }), 'border-dashed text-xs text-muted-foreground')}>{unavailable}</p>
  ) : recordingOf ? (
    <RecordingPane
      recording={recordingOf}
      title={item.label}
      blocked={recordBlocked}
      onRecord={() => void startRecording()}
    />
  ) : current?.preview ? (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {current.file.previewOf && <InlineAlert>{current.file.previewOf}</InlineAlert>}
      {current.missing && <InlineAlert tone="warning">{current.missing}</InlineAlert>}
      <div className="min-h-0 flex-1">
        <PreviewView preview={current.preview} title={item.label} />
      </div>
    </div>
  ) : outdated?.preview && (outdated.request as { kind?: string }).kind === item.kind ? (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <InlineAlert loading>
        <span role="status">
          Out of date: the page changed while this was written. Writing it again, with the pictures already drawn kept.
        </span>
      </InlineAlert>
      <div className="min-h-0 flex-1">
        <PreviewView preview={outdated.preview} title={item.label} />
      </div>
    </div>
  ) : current?.error ? (
    <InlineAlert tone="error">{current.error}</InlineAlert>
  ) : (
    <InlineAlert loading>{previewStage?.request === request ? previewStage.text : 'Preparing preview…'}</InlineAlert>
  )
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
      contentProps={{ 'data-testid': 'visuals-export-dialog', style: { maxWidth: DIALOG_MAX_WIDTH } }}
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
                  const shown = formatOf(entry)
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
            <section ref={paneRef} aria-label="Views" className="flex min-w-0 flex-col gap-3 p-3 sm:min-h-0 sm:p-5">
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
            <section ref={paneRef} aria-label="Package" className="flex min-w-0 flex-col gap-3 p-3 sm:min-h-0 sm:p-5">
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
              ref={paneRef}
              aria-label={`${item.label} export`}
              className="flex min-w-0 flex-col gap-3 p-3 sm:min-h-0 sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-1.5">
                  <h3 className="min-w-0 truncate text-sm font-semibold">
                    {item.label} <span className="font-normal text-muted-foreground">{format.extension}</span>
                  </h3>
                  <InfoTip label={`About ${item.label}`}>{item.description}</InfoTip>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  {/* The previewed picture itself, at print resolution: copying starts no run, capture or render. */}
                  {!unavailable && current?.file?.copyPng && (
                    <CopyImageButton
                      size="default"
                      aria-label={`Copy ${item.label} as an image`}
                      png={current.file.copyPng}
                    />
                  )}
                  {canSaveAs && (
                    <Button
                      variant="outline"
                      disabled={!!unavailable || saving || takeRunning || (!!recordingOf && !recordingOf.file)}
                      aria-label={`Save ${item.label} as…`}
                      onClick={saveAs}
                    >
                      <Save className="size-4" />
                      Save as…
                    </Button>
                  )}
                  <Button
                    disabled={!!unavailable || saving || takeRunning || (!!recordingOf && !recordingOf.file)}
                    aria-label={`Download ${item.label}`}
                    onClick={() => void download()}
                  >
                    {saving ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                    {item.group === 'files' ? 'Save' : 'Download'}
                  </Button>
                </div>
              </div>
              {(!sideBySide || item.formats.length > 1) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {!sideBySide && (
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
                  )}
                  {item.formats.length > 1 && (
                    <StyledSelect
                      aria-label={`${item.label} format`}
                      className="w-auto max-w-full rounded-md border bg-background px-2 py-1 text-xs"
                      value={format.id}
                      onValueChange={(id) => chooseFormat(item.kind, id)}
                      options={item.formats.map((entry) => ({ value: entry.id, label: entry.label }))}
                    />
                  )}
                </div>
              )}
              {/* The draft and the file look alike in one viewer; this says which is which. */}
              {draftOf && shownView !== 'contents' && !unavailable && (
                <p className="text-2xs text-muted-foreground" data-testid="visuals-export-view-note">
                  {shownView === 'draft'
                    ? 'The draft: laid out at once, with a stand-in where a picture is not drawn yet. Nothing is captured or run for it, and its tints are not in the file.'
                    : 'The file Download writes: views of interest are captured and the assessment run first where they are missing.'}
                </p>
              )}
              {status && (
                <InlineAlert tone={status.tone === 'info' ? 'success' : status.tone}>
                  <span role="status">{status.text}</span>
                </InlineAlert>
              )}
              {saving && saveStage && (
                <InlineAlert loading>
                  <span role="status">{saveStage}</span>
                  <TextButton className="ml-2 text-2xs" onClick={stopSaving}>
                    Stop
                  </TextButton>
                </InlineAlert>
              )}
              {/* Side by side the note sits in the preview column, never across the pane. */}
              {!sideBySide && preparationNote}
              {unavailable && (
                <p
                  role="status"
                  className="rounded-md border border-warning-border bg-warning-surface p-2 text-xs text-warning-foreground"
                >
                  {unavailable}
                </p>
              )}
              {takeRunning && runningTake && !(runningTake === recordingOf && previewShown) && (
                <InlineAlert loading>
                  <span role="status">
                    Recording the road view video
                    {runningTake.progress ? `, ${runningTake.progress}` : ''}: other files are written once it ends,
                    since it moves the road view.
                  </span>
                  <TextButton
                    className="ml-2 text-2xs"
                    onClick={runningTake.status === 'preparing' ? runningTake.cancel : runningTake.stop}
                  >
                    {runningTake.status === 'preparing' ? 'Cancel' : 'Stop'}
                  </TextButton>
                </InlineAlert>
              )}
              {!unavailable && recordingOf && !recordingOf.file && !previewShown && (
                <InlineAlert>
                  Nothing recorded yet: Preview records it, then Download and Save as… write that recording.
                </InlineAlert>
              )}
              {/* Side by side, what goes in and the file each scroll in their column; as tabs, the one shown scrolls in
                  the pane; stacked on a phone it flows with the dialog. */}
              {sideBySide ? (
                <div
                  className="grid min-h-0 flex-1 grid-cols-[minmax(20rem,2fr)_minmax(0,3fr)] gap-4"
                  data-layout="side-by-side"
                >
                  <div className="min-h-0 min-w-0 overflow-x-clip overflow-y-auto overscroll-none pr-1">
                    {contentsView}
                  </div>
                  <div className="flex min-h-0 min-w-0 flex-col gap-2" role="group" aria-label={`${item.label} file`}>
                    {!buildOnRequest && preparationNote}
                    <div className="min-h-0 flex-1">{previewView}</div>
                  </div>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-x-clip sm:overflow-y-auto overscroll-none">
                  {shownView === 'draft' && !unavailable
                    ? draftView
                    : shownView === 'contents'
                      ? contentsView
                      : previewView}
                </div>
              )}
            </section>
          )}
        </div>
      </PreparerProfileHostProvider>
    </PanelDialog>
  )
}
