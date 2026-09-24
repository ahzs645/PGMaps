import { MapPin } from 'lucide-react'
import type { ProjectSceneDef } from '@/lib/projectPackages'
import { cn } from '@/lib/utils'

/**
 * - `panel`: a card in the narrative sidebar.
 * - `overlay`: a scrolly chapter card floating over the map.
 * - `slide`: one slide in the slides pane. Renders its own root so the
 *   heading's grandparent stays the stacking grid (see `SlidesStory`).
 */
type SceneCardVariant = 'panel' | 'overlay' | 'slide'

const titleClasses: Record<SceneCardVariant, string> = {
  panel: 'mt-2 text-sm md:text-base',
  overlay: 'mt-2 text-sm md:text-lg',
  slide: 'mt-1 text-lg md:text-2xl',
}

const textClasses: Record<SceneCardVariant, string> = {
  panel: 'text-xs leading-6 md:text-sm md:leading-6',
  overlay: 'text-xs leading-6 md:text-sm md:leading-7',
  // Left-aligned body: centred copy in a phone-width column breaks into
  // ragged two- and three-word lines.
  slide: 'text-left text-sm leading-6 md:text-base md:leading-7',
}

function SceneCallout({
  callout,
  variant,
}: {
  callout: NonNullable<ProjectSceneDef['callout']>
  variant: SceneCardVariant
}) {
  return (
    <div
      className={cn('mt-3 rounded-md border bg-muted/30 p-2.5', variant === 'slide' && 'mx-auto max-w-md text-left')}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{callout.label}</div>
      <div className={cn('mt-0.5 text-sm font-bold text-foreground', variant !== 'panel' && 'md:text-base')}>
        {callout.value}
      </div>
      {callout.detail && <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{callout.detail}</div>}
    </div>
  )
}

/** A scene's kicker, title, text, callout and map focus, in each story layout's card. */
export function SceneCard({
  scene,
  index,
  active,
  accent,
  variant,
  onSelect,
}: {
  scene: ProjectSceneDef
  index: number
  active: boolean
  accent: string
  variant: SceneCardVariant
  /** Selects the scene; `panel` and `overlay` cards are buttons. */
  onSelect?: () => void
}) {
  const body = (
    <>
      <h2 className={cn('font-bold leading-snug text-foreground', titleClasses[variant])}>{scene.title}</h2>
      <p className={cn('mt-2 text-muted-foreground', textClasses[variant])}>{scene.text}</p>
      {scene.callout && <SceneCallout callout={scene.callout} variant={variant} />}
    </>
  )

  if (variant === 'slide') {
    return (
      <div aria-hidden={!active} className={cn('col-start-1 row-start-1 text-center', !active && 'invisible')}>
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>
          {scene.kicker ?? scene.label}
        </div>
        {body}
        {scene.focus && (
          <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
            <span>{scene.focus}</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'step' : undefined}
      className={cn(
        'w-full rounded-lg border p-4 text-left',
        variant === 'panel'
          ? cn(
              'bg-background shadow-sm transition-colors',
              active ? 'border-primary bg-primary/5' : 'hover:border-primary/50 hover:bg-muted/50',
            )
          : 'bg-background/90 shadow-lg backdrop-blur md:p-5',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="truncate text-xs font-semibold uppercase tracking-wide"
          style={{ color: active ? accent : undefined }}
        >
          <span className={cn(!active && 'text-muted-foreground')}>{scene.kicker ?? scene.label}</span>
        </span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
      </div>
      {body}
      <div className="mt-3 flex items-center gap-1.5 border-t pt-2.5 text-xs font-medium text-muted-foreground">
        <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
        <span className="truncate">{scene.focus}</span>
      </div>
    </button>
  )
}
