import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { FileButton } from '@/components/ui/file-button'
import { ToolSection } from '@/components/ui/tool-section'
import { InlineAlert } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'
import { formatKm } from './measureFormat'
import type { ForestryScene } from './scene'
import type { AnalysisState } from './useVisibilityAnalysis'
import type { DrawMode } from './Sidebar'
import { previewInputError, type SavedDriveView } from './previewState'

const DRAFT_NOUNS: Record<Exclude<DrawMode, 'none'>, string> = {
  spot: 'viewpoint',
  corridor: 'road',
  block: 'cutblock',
  landscape: 'landform',
  'tree-free': 'area to draw without timber',
  'wildlife-tree-patch': 'wildlife tree patch',
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
  const error = previewInputError(props.scene)
  const busy = props.preparing || props.analysis.status === 'running'
  const progress = props.analysis.progress
  if (props.part === 'setup') {
    // Step 1's road, cutblock and landform controls live in the sidebar's own
    // sections; this is only the tracing in progress, whichever they started.
    if (props.drawMode === 'none') return null
    return (
      <section aria-label="Drawing">
        <InlineAlert>
          <p role="status">
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
            <ActionButton onClick={() => props.onDraw('none')}>Cancel drawing</ActionButton>
          </div>
        </InlineAlert>
      </section>
    )
  }
  const showStatus = !props.active || props.analysis.status === 'error' || !!props.message || !!props.children
  return (
    <>
      {showStatus && (
        <section className="space-y-2 px-3 py-3" aria-label="Drive preview">
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
                <InlineAlert loading>
                  <p>
                    {progress?.phase === 'terrain' ? 'Loading terrain' : 'Finding candidate views'}
                    {progress && progress.total > 0
                      ? ` · ${Math.round((100 * progress.completed) / progress.total)}%`
                      : '…'}
                  </p>
                  <ActionButton className="mt-2" onClick={props.onCancel}>
                    Cancel preparation
                  </ActionButton>
                </InlineAlert>
              )}
            </div>
          )}
          {props.analysis.status === 'error' && (
            <InlineAlert tone="error">
              Preview could not be prepared: {props.analysis.error}. Check the connection, then retry.
            </InlineAlert>
          )}
          {props.message && (
            <InlineAlert>
              <p role="status" className="break-words">
                {props.message}
              </p>
            </InlineAlert>
          )}
          {props.children}
        </section>
      )}
      <ToolSection
        title="Saved views"
        className="space-y-2 text-xs"
        help={
          <>
            Your record of each viewpoint (handbook 3.2). Save a view from the road view&rsquo;s bar; it is named with
            its planning-note caption. Reopen one to compare both harvest phases from the same spot. The downloaded
            preview holds the geometry and views; terrain and inventory need a connection when it is reopened.
          </>
        }
      >
        {!props.views.length && (
          <p className="text-2xs text-muted-foreground">None yet. Save one from the road view&rsquo;s bar.</p>
        )}
        {props.onReopenPrevious && (
          <ActionButton onClick={props.onReopenPrevious}>Reopen previous saved preview</ActionButton>
        )}
        {props.views.map((view) => (
          <div key={view.id} className="flex items-center gap-2">
            <ActionButton
              className="h-auto min-h-9 flex-1 justify-start whitespace-normal py-2 text-left touch:h-auto touch:min-h-10"
              disabled={busy}
              onClick={() => props.onRestore(view)}
            >
              {view.name} · {formatKm(view.positionMeters)}
            </ActionButton>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 touch:size-10"
              aria-label={`Remove ${view.name}`}
              onClick={() => props.onRemoveView(view.id)}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-1.5">
          <ActionButton disabled={!!error} onClick={props.onExport}>
            Save views…
          </ActionButton>
          <FileButton
            label="Import preview geometry"
            accept=".json,.geojson,.zip"
            className="touch:h-10"
            disabled={busy}
            onFiles={([file]) => props.onImport(file, 'preview')}
          >
            Open saved preview
          </FileButton>
        </div>
        {props.storageWarning && <InlineAlert tone="warning">{props.storageWarning}</InlineAlert>}
      </ToolSection>
    </>
  )
}
