import { useEffect, useMemo, useRef, useState } from 'react'
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
  exportUnavailable,
  type ExportContext,
  type ExportGroup,
  type ExportPreview,
  type RoadExport,
} from './exportCatalog'
import { ExportPreviewView } from './ExportPreview'
import type { RoadReportSettings } from './reportSettings'
import { ReportSettingsEditor } from './ReportSettingsEditor'

export type { RoadExport } from './exportCatalog'

const GROUPS = Object.keys(EXPORT_GROUP_LABELS) as ExportGroup[]
// Edits in Sheet setup rebuild the plot book; a short pause keeps typing from rebuilding it per key.
const PREVIEW_DELAY_MS = 250

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
  context,
  buildPreview,
  previewVersion,
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
  context: ExportContext
  /** Builds one output's preview; `signal` aborts when the selection or project changes. */
  buildPreview: (kind: RoadExport, signal: AbortSignal) => Promise<ExportPreview>
  /** Changes whenever the content would: the project, its results or the shown road. */
  previewVersion: unknown
}) {
  const [selected, setSelected] = useState<RoadExport>('project')
  const [view, setView] = useState<'preview' | 'setup'>('preview')
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
  const settingUp = item.kind === 'plotbook' && view === 'setup' && !!onReportSettings
  // A new object per selection or content change: a preview is current only for its own request.
  const request = useMemo(() => ({ kind: item.kind, version: previewVersion }), [item.kind, previewVersion])
  const [result, setResult] = useState<PreviewResult | null>(null)
  const latestBuild = useRef(buildPreview)
  useEffect(() => {
    latestBuild.current = buildPreview
  })
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
  const select = (kind: RoadExport) => {
    setSelected(kind)
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
                      subtitle={reason ?? undefined}
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
            {item.kind === 'plotbook' && onReportSettings && (
              <SegmentedControl
                size="sm"
                fullWidth={false}
                label="Plot book view"
                value={view}
                onChange={setView}
                options={[
                  { value: 'preview', label: 'Preview' },
                  { value: 'setup', label: 'Sheet setup' },
                ]}
              />
            )}
            {/* Side by side the preview scrolls in its pane; stacked on a phone it flows with the dialog. */}
            <div className="min-h-0 flex-1 sm:overflow-y-auto">
              {settingUp ? (
                <ReportSettingsEditor value={reportSettings} onChange={onReportSettings} />
              ) : unavailable ? (
                <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">{unavailable}</p>
              ) : current?.preview ? (
                <ExportPreviewView preview={current.preview} title={item.label} />
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
