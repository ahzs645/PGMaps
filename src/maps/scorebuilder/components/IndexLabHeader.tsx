import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  BookOpen,
  Download,
  Flame,
  Hammer,
  Map as MapIcon,
  Redo2,
  Settings as SettingsIcon,
  Undo2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ScoreBuilderExportFormat } from '../lib/exportRegions'

export type MapLens = 'score' | 'density' | 'correlate'

export interface IndexLabHeaderProps {
  mode: 'build' | 'explore'
  onSwitchToBuild?: () => void
  onSwitchToExplore?: () => void
  title: string
  description: string
  onOpenRecipes: () => void
  onOpenSettings: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  /** Explore only: the map lens segment and the results export menu. */
  lens?: MapLens
  onLensChange?: (lens: MapLens) => void
  onExport?: (format: ScoreBuilderExportFormat) => void
}

const EXPORT_FORMATS: Array<[ScoreBuilderExportFormat, string]> = [
  ['csv', 'Regions CSV'],
  ['geojson', 'Regions GeoJSON'],
  ['png', 'Map image (PNG)'],
  ['pdf', 'PDF report'],
]

const headerButtonClass =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'
const headerIconButtonClass =
  'inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'

/**
 * The single Index Lab toolbar on desktop: view toggle, recipe title, map lens,
 * undo/redo, and the Recipes / Export / Settings actions. Both views render it so
 * nothing moves when swapping between Build and Explore.
 */
export function IndexLabHeader({
  mode,
  onSwitchToBuild,
  onSwitchToExplore,
  title,
  description,
  onOpenRecipes,
  onOpenSettings,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  lens,
  onLensChange,
  onExport,
}: IndexLabHeaderProps) {
  return (
    // On mobile the app navbar is a fixed overlay of floating pills, so the header's
    // solid background extends up behind them instead of leaving a see-through gap.
    <header
      data-index-lab-header="true"
      className="shrink-0 border-b border-border bg-background max-md:pt-[calc(env(safe-area-inset-top)+3.25rem)]"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4">
        <ViewModeToggle mode={mode} onSwitchToBuild={onSwitchToBuild} onSwitchToExplore={onSwitchToExplore} />
        <div className="hidden min-w-0 flex-1 md:block">
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          <p className="line-clamp-1 text-xs text-muted-foreground">{description}</p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {lens && onLensChange && <MapLensToggle lens={lens} onLensChange={onLensChange} />}
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
              className={headerIconButtonClass}
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo (Shift+Ctrl+Z)"
              aria-label="Redo"
              className={headerIconButtonClass}
            >
              <Redo2 className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={onOpenRecipes}
            title="Browse examples, presets, projects, and saved indexes"
            aria-label="Browse recipes"
            className={headerButtonClass}
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Recipes</span>
          </button>
          {onExport && <ExportMenu onExport={onExport} />}
          <button
            type="button"
            onClick={onOpenSettings}
            title="Index settings — methodology, model & filters, robustness"
            aria-label="Index settings"
            className={headerIconButtonClass}
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="w-full min-w-0 md:hidden">
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          <p className="line-clamp-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
    </header>
  )
}

/** Segmented Build / Explore switch shared by both modes' headers. */
export function ViewModeToggle({
  mode,
  onSwitchToBuild,
  onSwitchToExplore,
  className,
}: {
  mode: 'build' | 'explore'
  onSwitchToBuild?: () => void
  onSwitchToExplore?: () => void
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label="Lab view"
      className={cn('inline-flex h-8 items-stretch overflow-hidden rounded-md border border-input bg-background', className)}
    >
      <button
        type="button"
        aria-pressed={mode === 'build'}
        title="Build view — compose the index full-width"
        onClick={mode === 'build' ? undefined : onSwitchToBuild}
        className={cn(
          'inline-flex items-center gap-1 px-2.5 text-xs font-medium transition-colors',
          mode === 'build' ? 'bg-cyan-500 text-white' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Hammer className="h-3.5 w-3.5" />
        Build
      </button>
      <button
        type="button"
        aria-pressed={mode === 'explore'}
        title="Explore view — map-first with regions, density, and correlate"
        onClick={mode === 'explore' ? undefined : onSwitchToExplore}
        className={cn(
          'inline-flex items-center gap-1 border-l border-input px-2.5 text-xs font-medium transition-colors',
          mode === 'explore' ? 'bg-cyan-500 text-white' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <MapIcon className="h-3.5 w-3.5" />
        Explore
      </button>
    </div>
  )
}

/** Score / Density / Correlate map-lens segment. Shared by the desktop header and the phone strip. */
export function MapLensToggle({
  lens,
  onLensChange,
  size = 'sm',
  className,
}: {
  lens: MapLens
  onLensChange: (lens: MapLens) => void
  size?: 'sm' | 'lg'
  className?: string
}) {
  const buttonClass = size === 'lg' ? 'min-h-10 px-3 text-xs font-medium' : 'px-2.5 text-xs font-medium'
  return (
    <div
      role="group"
      aria-label="Map lens"
      className={cn(
        'inline-flex items-stretch overflow-hidden rounded-md border border-input bg-background',
        size === 'lg' ? 'shadow-sm backdrop-blur' : 'h-8',
        className,
      )}
    >
      <button
        type="button"
        aria-pressed={lens === 'score'}
        title="Score lens — map colored by the composite index"
        onClick={() => onLensChange('score')}
        className={cn(
          'inline-flex items-center transition-colors',
          buttonClass,
          lens === 'score' ? 'bg-cyan-500 text-white' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        Score
      </button>
      <button
        type="button"
        aria-pressed={lens === 'density'}
        title="Density lens — map painted by a single metric"
        onClick={() => onLensChange('density')}
        className={cn(
          'inline-flex items-center gap-1 border-l border-input transition-colors',
          buttonClass,
          lens === 'density' ? 'bg-amber-500 text-white' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Flame className="h-3.5 w-3.5" />
        Density
      </button>
      <button
        type="button"
        aria-pressed={lens === 'correlate'}
        title="Correlate lens — map shows the relationship between two metrics"
        onClick={() => onLensChange('correlate')}
        className={cn(
          'inline-flex items-center gap-1 border-l border-input transition-colors',
          buttonClass,
          lens === 'correlate' ? 'bg-cyan-500 text-white' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Activity className="h-3.5 w-3.5" />
        Correlate
      </button>
    </div>
  )
}

function ExportMenu({ onExport }: { onExport: (format: ScoreBuilderExportFormat) => void }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        title="Export results"
        aria-label="Export results"
        aria-expanded={open}
        aria-haspopup="menu"
        className={headerIconButtonClass}
      >
        <Download className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-30 w-44 rounded-md border border-border bg-background p-1 shadow-lg">
          {EXPORT_FORMATS.map(([format, label]) => (
            <button
              key={format}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false)
                onExport(format)
              }}
              className="block w-full rounded px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-muted"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
