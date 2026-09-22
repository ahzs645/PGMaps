import { useRef } from 'react'
import type { ReactNode } from 'react'
import type { ForestryScene } from './scene'
import type { AnalysisState } from './useVisibilityAnalysis'
import type { DrawMode } from './Sidebar'
import { previewInputError, type SavedDriveView } from './previewState'
import { lineLengthMeters } from './visibility'

const button = 'rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50'
type Props = {
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
  const blocks = props.scene.targets.filter((t) => t.role === 'block')
  const error = previewInputError(props.scene)
  const busy = props.preparing || props.analysis.status === 'running'
  const progress = props.analysis.progress
  return (
    <section className="space-y-4 p-4" aria-label="Drive preview setup">
      <div>
        <h2 className="text-base font-semibold">See the change from the road</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose your road and cutblocks, then compare the view before and after harvest.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={button} onClick={props.onSample} disabled={busy}>
          Try sample drive
        </button>
        <button className={button} onClick={props.onNew} disabled={busy || props.active}>
          Start with my site
        </button>
      </div>
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
      <div className="rounded-lg border p-3 space-y-2">
        <h3 className="text-sm font-semibold">1. Road</h3>
        <p className="break-words text-xs">
          {props.scene.viewpoint.coordinates.length > 1
            ? `${props.scene.viewpoint.name} · ${(lineLengthMeters(props.scene.viewpoint.coordinates) / 1000).toFixed(2)} km`
            : 'No road selected'}
        </p>
        <div className="flex gap-2">
          <button className={button} disabled={busy || props.active} onClick={() => props.onDraw('corridor')}>
            Draw road
          </button>
          <button className={button} disabled={busy || props.active} onClick={() => select('road')}>
            Import road
          </button>
        </div>
      </div>
      <div className="rounded-lg border p-3 space-y-2">
        <h3 className="text-sm font-semibold">2. Cutblocks</h3>
        <p className="break-words text-xs">
          {blocks.length ? blocks.map((b) => b.name).join(', ') : 'No cutblocks selected'}
        </p>
        <div className="flex gap-2">
          <button className={button} disabled={busy || props.active} onClick={() => props.onDraw('block')}>
            Draw cutblock
          </button>
          <button className={button} disabled={busy || props.active} onClick={() => select('blocks')}>
            Import cutblocks
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          GeoJSON or zipped shapefiles. Imports replace the selected road or proposed cutblocks.
        </p>
      </div>
      {props.drawMode !== 'none' && (
        <div className="rounded border bg-muted p-3 text-xs" role="status">
          <p>
            Click the map to trace the {props.drawMode === 'corridor' ? 'road' : 'cutblock'}. {props.pointCount} points
            added.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              className={button}
              disabled={props.pointCount < (props.drawMode === 'corridor' ? 2 : 3)}
              onClick={props.onFinish}
            >
              Finish drawing
            </button>
            <button className={button} onClick={() => props.onDraw('none')}>
              Cancel drawing
            </button>
          </div>
        </div>
      )}
      {!props.active && (
        <div className="space-y-2">
          <button
            className={`${button} w-full bg-primary text-primary-foreground hover:bg-primary/90`}
            disabled={!!error || busy || props.drawMode !== 'none'}
            onClick={props.onPreview}
          >
            {props.analysis.status === 'error' ? 'Retry preview' : busy ? 'Preparing preview…' : 'Preview drive'}
          </button>
          {error && <p className="text-xs text-muted-foreground">{error}</p>}
          {busy && (
            <div role="status" className="text-xs">
              <p>
                {progress?.phase === 'terrain' ? 'Loading terrain' : 'Finding candidate views'}
                {progress && progress.total > 0
                  ? ` · ${Math.round((100 * progress.completed) / progress.total)}%`
                  : '…'}
              </p>
              <button className={`${button} mt-2`} onClick={props.onCancel}>
                Cancel preparation
              </button>
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
        <h3 className="font-semibold text-sm">Saved comparisons</h3>
        <p className="text-muted-foreground">
          Save a viewpoint from the drive. Reopen it to compare both harvest phases from the same position.
        </p>
        {props.onReopenPrevious && (
          <button className={button} onClick={props.onReopenPrevious}>
            Reopen previous saved preview
          </button>
        )}
        {props.views.map((view) => (
          <div key={view.id} className="flex items-center gap-2">
            <button className={`${button} flex-1 text-left`} disabled={busy} onClick={() => props.onRestore(view)}>
              {view.name} · {(view.positionMeters / 1000).toFixed(2)} km
            </button>
            <button className={button} aria-label={`Remove ${view.name}`} onClick={() => props.onRemoveView(view.id)}>
              ×
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={!!error} onClick={props.onExport}>
            Download preview
          </button>
          <button className={button} disabled={busy} onClick={() => select('preview')}>
            Open saved preview
          </button>
        </div>
        {props.storageWarning && <p role="alert">{props.storageWarning}</p>}
        <p className="text-[11px] text-muted-foreground">
          The file includes geometry and viewpoints. Terrain and inventory need an internet connection when reopened.
        </p>
      </div>
    </section>
  )
}
