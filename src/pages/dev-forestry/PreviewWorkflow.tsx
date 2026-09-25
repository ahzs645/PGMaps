import { useRef } from 'react'
import type { ReactNode } from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ForestryScene } from './scene'
import type { AnalysisState } from './useVisibilityAnalysis'
import type { DrawMode } from './Sidebar'
import { previewInputError, type SavedDriveView } from './previewState'

const DRAFT_NOUNS: Record<Exclude<DrawMode, 'none'>, string> = {
  spot: 'viewpoint',
  corridor: 'road',
  block: 'cutblock',
  landscape: 'landform',
}

function ActionButton({ className, ...props }: ButtonProps) {
  return <Button variant="outline" size="sm" className={cn('touch:h-10', className)} {...props} />
}
type Props = {
  /**
   * `setup` is handbook step 1's half — the road and the proposal. `visit` is
   * step 2's — preparing the eye-level view and keeping the views taken from it.
   */
  part: 'setup' | 'visit'
  scene: ForestryScene
  analysis: AnalysisState
  active: boolean
  preparing: boolean
  onPreview: () => void
  onCancel: () => void
  onSample: () => void
  onNew: () => void
  onImport: (file: File, kind: 'road' | 'blocks' | 'preview') => void
  onDraw: (mode: DrawMode) => void
  drawMode: DrawMode
  pointCount: number
  onFinish: () => void
  message: string | null
  views: SavedDriveView[]
  onRestore: (view: SavedDriveView) => void
  onRemoveView: (id: string) => void
  onExport: () => void
  storageWarning: string | null
  onReopenPrevious?: () => void
  children?: ReactNode
}
export function PreviewWorkflow(props: Props) {
  const file = useRef<HTMLInputElement>(null)
  const kind = useRef<'road' | 'blocks' | 'preview'>('road')
  const select = (value: typeof kind.current) => {
    kind.current = value
    file.current?.click()
  }
  const error = previewInputError(props.scene)
  const busy = props.preparing || props.analysis.status === 'running'
  const progress = props.analysis.progress
  if (props.part === 'setup') {
    // Step 1's road, cutblock and landform controls live in the sidebar's own
    // sections; this is only the tracing in progress, whichever they started.
    if (props.drawMode === 'none') return null
    return (
      <section aria-label="Drawing">
        {(
          <div className="rounded border bg-muted p-3 text-xs" role="status">
            <p>
              {props.drawMode === 'spot'
                ? 'Click the road to drop the viewpoint.'
                : `Click the map to trace the ${DRAFT_NOUNS[props.drawMode]}. ${props.pointCount} points added — double-click or Finish to ${props.drawMode === 'corridor' ? 'end the line' : 'close the shape'}.`}
            </p>
            <div className="mt-2 flex gap-2">
              {props.drawMode !== 'spot' && (
                <ActionButton
                  disabled={props.pointCount < (props.drawMode === 'corridor' ? 2 : 3)}
                  onClick={props.onFinish}
                >
                  Finish drawing
                </ActionButton>
              )}
              <ActionButton onClick={() => props.onDraw('none')}>
                Cancel drawing
              </ActionButton>
            </div>
          </div>
        )}
      </section>
    )
  }
  return (
    <section className="space-y-4" aria-label="Drive preview">
      <input
        ref={file}
        className="hidden"
        aria-label="Import preview geometry"
        type="file"
        accept=".json,.geojson,.zip"
        onChange={(event) => {
          const selected = event.target.files?.[0]
          if (selected) props.onImport(selected, kind.current)
          event.target.value = ''
        }}
      />
      {!props.active && (
        <div className="space-y-2">
          <Button
            size="sm"
            className="w-full touch:h-10"
            disabled={!!error || busy || props.drawMode !== 'none'}
            onClick={props.onPreview}
          >
            {props.analysis.status === 'error' ? 'Retry' : busy ? 'Preparing the road view…' : 'Look from the road'}
          </Button>
          {error && <p className="text-xs text-muted-foreground">{error}</p>}
          {busy && (
            <div role="status" className="text-xs">
              <p>
                {progress?.phase === 'terrain' ? 'Loading terrain' : 'Finding candidate views'}
                {progress && progress.total > 0
                  ? ` · ${Math.round((100 * progress.completed) / progress.total)}%`
                  : '…'}
              </p>
              <ActionButton className="mt-2" onClick={props.onCancel}>
                Cancel preparation
              </ActionButton>
            </div>
          )}
        </div>
      )}
      {props.analysis.status === 'error' && (
        <p role="alert" className="text-xs text-destructive">
          Preview could not be prepared: {props.analysis.error}. Check the connection, then retry.
        </p>
      )}
      {props.message && (
        <p role="status" className="text-xs break-words">
          {props.message}
        </p>
      )}
      {props.children}
      <div className="rounded-lg border p-3 text-xs space-y-2">
        <h4 className="font-semibold text-sm">Saved views</h4>
        <p className="text-muted-foreground">
          Your record of each viewpoint (handbook 3.2): save a view from the drive and download its image. Reopen it to compare both harvest phases from the same spot.
        </p>
        {props.onReopenPrevious && (
          <ActionButton onClick={props.onReopenPrevious}>
            Reopen previous saved preview
          </ActionButton>
        )}
        {props.views.map((view) => (
          <div key={view.id} className="flex items-center gap-2">
            <ActionButton className="h-auto min-h-9 flex-1 justify-start whitespace-normal py-2 text-left touch:h-auto touch:min-h-10" disabled={busy} onClick={() => props.onRestore(view)}>
              {view.name} · {(view.positionMeters / 1000).toFixed(2)} km
            </ActionButton>
            <ActionButton aria-label={`Remove ${view.name}`} onClick={() => props.onRemoveView(view.id)}>
              ×
            </ActionButton>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <ActionButton disabled={!!error} onClick={props.onExport}>
            Download preview
          </ActionButton>
          <ActionButton disabled={busy} onClick={() => select('preview')}>
            Open saved preview
          </ActionButton>
        </div>
        {props.storageWarning && <p role="alert">{props.storageWarning}</p>}
        <p className="text-[11px] text-muted-foreground">
          The file includes geometry and viewpoints. Terrain and inventory need an internet connection when reopened.
        </p>
      </div>
    </section>
  )
}
