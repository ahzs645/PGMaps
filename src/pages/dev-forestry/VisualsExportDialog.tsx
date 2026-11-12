import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Download, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { insetBox } from '@/components/ui/inset-box'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { ResultRow } from '@/components/ui/result-list'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TextButton } from '@/components/ui/text-button'
import { downloadBlob } from '@/lib/download'
import { cn } from '@/lib/utils'

import { VIA_STEPS, type ViaStepId } from './via'
import {
  exportContents,
  exportUnavailable,
  findVisualsExport,
  VISUALS_EXPORT_GROUP_LABELS,
  VISUALS_EXPORTS,
  type ExportContext,
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
  | { request: object; file: BuiltFile; preview: Preview; error?: undefined }
  | { request: object; file?: undefined; preview?: undefined; error: string }

const stepLabel = (id: ViaStepId) => {
  const step = VIA_STEPS.find((entry) => entry.id === id)
  return step ? `Step ${step.number}` : id
}

function ContentsSection({ section, onGoToStep }: { section: ExportSection; onGoToStep?: (id: ViaStepId) => void }) {
  const empty = !section.rows?.length && !section.items?.length
  return (
    <section className="space-y-1.5" aria-label={section.title}>
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{section.title}</h4>
        {section.step && onGoToStep && (
          <TextButton className="text-2xs" onClick={() => onGoToStep(section.step!)}>
            Change in {stepLabel(section.step)}
          </TextButton>
        )}
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
              <p className="font-medium text-foreground">{item.title}</p>
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
  portalContainer?: HTMLElement | null
}) {
  const [selected, setSelected] = useState<VisualsExport>(initialOutput)
  const [view, setView] = useState<'contents' | 'preview'>('contents')
  const [formats, setFormats] = useState<Partial<Record<VisualsExport, string>>>({})
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)
  // Open on the requested output, including when the previous session used another.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSelected(initialOutput)
      setView('contents')
      setStatus(null)
    }
  }
  const item = findVisualsExport(selected)
  const format = item.formats.find((entry) => entry.id === formats[item.kind]) ?? item.formats[0]
  const unavailable = exportUnavailable(item.kind, context)
  const sections = useMemo(() => exportContents(item.kind, context), [item.kind, context])

  // A new object per selection or content change: a preview is current only for its own request.
  const request = useMemo(() => ({ kind: item.kind, format: format.id, version }), [item.kind, format.id, version])
  const [result, setResult] = useState<PreviewResult | null>(null)
  const latestBuild = useRef(build)
  useEffect(() => {
    latestBuild.current = build
  })
  useEffect(() => {
    if (!open || unavailable || view !== 'preview') return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      latestBuild
        .current(request.kind, request.format, controller.signal)
        .then(async (file) => {
          const preview = await previewOf(file)
          if (controller.signal.aborted) {
            if ('url' in preview) URL.revokeObjectURL(preview.url)
          } else setResult({ request, file, preview })
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setResult({ request, error: error instanceof Error ? error.message : 'Could not prepare a preview.' })
        })
    }, PREVIEW_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, request, unavailable, view])
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
    setStatus(null)
    // Stacked on a phone, the pane sits under the list; bring it up. Side by side this does nothing.
    requestAnimationFrame(() => pane.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }
  const download = async () => {
    setSaving(true)
    setStatus(null)
    try {
      // The previewed file when it is this one; otherwise written now.
      const file = current?.file ?? (await build(item.kind, format.id, new AbortController().signal))
      downloadBlob(file.blob, file.fileName)
      setStatus({ tone: 'info', text: `Saved ${file.fileName}.` })
    } catch (error) {
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : 'The file could not be written.' })
    } finally {
      setSaving(false)
    }
  }

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
                    accent="teal"
                    selected={entry.kind === item.kind}
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
            <InlineAlert tone={status.tone === 'error' ? 'error' : 'success'}>
              <span role="status">{status.text}</span>
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
                  <ContentsSection key={section.title} section={section} onGoToStep={onGoToStep} />
                ))}
              </div>
            ) : unavailable ? (
              <p className={cn(insetBox({ padding: 'lg' }), 'border-dashed text-xs text-muted-foreground')}>
                {unavailable}
              </p>
            ) : current?.preview ? (
              <PreviewView preview={current.preview} title={item.label} />
            ) : current?.error ? (
              <InlineAlert tone="error">{current.error}</InlineAlert>
            ) : (
              <InlineAlert loading>Preparing preview…</InlineAlert>
            )}
          </div>
        </section>
      </div>
    </PanelDialog>
  )
}
