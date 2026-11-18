import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
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
  view: 'view of interest',
}

function ActionButton({ className, ...props }: ButtonProps) {
  return <Button variant="outline" size="sm" className={cn('touch:h-10', className)} {...props} />
}
type Props = {
  /**
   * `setup` is handbook step 1's half — the tracing in progress. `visit` is
   * step 2's — preparing the eye-level view. The views saved from it are listed
   * with the views of interest (`ViewsOfInterestPanel`, `UnlistedSavedViews`).
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
  onDraw: (mode: DrawMode) => void
  drawMode: DrawMode
  pointCount: number
  onFinish: () => void
  message: string | null
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
              : props.drawMode === 'view'
                ? 'Click the plan where the view of interest stands.'
                : `Click the map to trace the ${DRAFT_NOUNS[props.drawMode]}. ${props.pointCount} points added — double-click or Finish to ${props.drawMode === 'corridor' ? 'end the line' : 'close the shape'}.`}
          </p>
          <div className="mt-2 flex gap-2">
            {props.drawMode !== 'spot' && props.drawMode !== 'view' && (
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
  const showStatus = busy || props.analysis.status === 'error' || !!props.message || !!props.children
  return (
    <>
      {showStatus && (
        <section className="space-y-2 px-3 py-3" aria-label="Drive preview">
          {!props.active && (
            <div className="space-y-2">
              {/* The road view opens from the plan map's *Look from the road* tool; here, only a failed one's retry. */}
              {props.analysis.status === 'error' && (
                <Button
                  size="sm"
                  className="w-full touch:h-10"
                  disabled={!!error || busy || props.drawMode !== 'none'}
                  onClick={props.onPreview}
                >
                  Retry
                </Button>
              )}
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
    </>
  )
}

/**
 * Saved views that are not a view of interest's capture, shown under the views of interest in step 2: a save made with
 * no cutblock to face or with the list full (`handSaveLink`), or one whose view has since been removed. Every other
 * saved view is reopened from its view's row. Also where the page says browser storage cannot keep the views.
 */
export function UnlistedSavedViews(props: {
  views: readonly SavedDriveView[]
  busy: boolean
  onRestore: (view: SavedDriveView) => void
  onRemove: (id: string) => void
  storageWarning: string | null
}) {
  if (!props.views.length && !props.storageWarning) return null
  return (
    <section className="space-y-1.5 border-t border-border/60 pt-2" aria-label="Saved views not listed">
      {props.views.length > 0 && (
        <>
          <p className="flex items-center gap-1 text-2xs font-medium text-foreground">
            Saved, not listed as a view
            <InfoTip label="About saved views not listed">
              A view saved from the road view&rsquo;s bar is listed above as a view of interest, and its row reopens it.
              These could not be listed: there was no cutblock to face, the list was full, or the view they were saved
              for has been removed. Reopen one to look again; saved there once a cutblock is in place, it is listed.
            </InfoTip>
          </p>
          {props.views.map((view) => (
            <div key={view.id} className="flex items-center gap-2">
              <ActionButton
                className="h-auto min-h-9 flex-1 justify-start whitespace-normal py-2 text-left touch:h-auto touch:min-h-10"
                disabled={props.busy}
                onClick={() => props.onRestore(view)}
              >
                {view.name} · {formatKm(view.positionMeters)}
              </ActionButton>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 touch:size-10"
                aria-label={`Remove ${view.name}`}
                onClick={() => props.onRemove(view.id)}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          ))}
        </>
      )}
      {props.storageWarning && <InlineAlert tone="warning">{props.storageWarning}</InlineAlert>}
    </section>
  )
}
