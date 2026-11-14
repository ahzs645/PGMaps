import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { commandTooltip, resolveCommand, type CommandState, type WorkspaceCommand } from './workspaceCommands'

/**
 * How a renderer presents one registry command. The label and icon always come from
 * `workspaceCommands`; a presentation only decides size, emphasis and when the caption shows.
 */
export interface CommandPresentation {
  /** Accessible name when it should say more than the caption, e.g. "Undo road edit". */
  ariaLabel?: string
  title?: string
  /** Caption shown instead of the registry label where space is short, e.g. "Save". */
  shortLabel?: string
  /** When the caption shows: always (text button), from a breakpoint beside the icon, or never (icon only). */
  captionFrom?: 'always' | 'lg' | 'xl' | '2xl' | false
  emphasis?: 'primary'
  keyShortcuts?: string
  /** Replaces the icon, e.g. a open/closed panel glyph that follows the state. */
  icon?: ReactNode
  caption?: ReactNode
  expanded?: boolean
  /** Sidebar only: a caption-only button, e.g. in a tight grid of source choices. */
  hideIcon?: boolean
  /** Sidebar only: extra classes for the button's place in its panel. */
  className?: string
}

/**
 * `header` is the bordered button of the phone header and the ribbon's tab row. `toolbar` is the
 * quiet one the desktop header line groups into clusters: no border of its own, 28 px, and the one
 * `emphasis: 'primary'` command filled.
 */
type Surface = 'ribbon' | 'quick' | 'header' | 'toolbar' | 'sidebar'

/** Width and caption visibility per `captionFrom`, as whole class names so Tailwind keeps them. */
const TOOLBAR_CAPTION = {
  lg: { button: 'lg:w-auto lg:px-2', caption: 'sr-only lg:not-sr-only' },
  xl: { button: 'xl:w-auto xl:px-2', caption: 'sr-only xl:not-sr-only' },
  '2xl': { button: '2xl:w-auto 2xl:px-2', caption: 'sr-only 2xl:not-sr-only' },
} as const

export function CommandButton({
  id,
  state,
  disabled,
  surface,
  primary,
  presentation = {},
  onRun,
}: {
  id: WorkspaceCommand
  state?: CommandState
  disabled?: boolean
  surface: Surface
  primary?: boolean
  presentation?: CommandPresentation
  onRun: (id: WorkspaceCommand) => void
}) {
  const command = resolveCommand(id, state, disabled)
  if (command.hidden) return null
  const Icon = command.icon
  // A presentation's own title wins; otherwise every surface reads the same tooltip from the registry.
  const tooltip = presentation.title ?? commandTooltip(command)
  if (surface === 'sidebar') {
    return (
      <Button
        size="sm"
        variant={presentation.emphasis === 'primary' ? 'default' : 'outline'}
        className={cn('min-w-0 gap-1 px-1', presentation.className)}
        data-command={id}
        aria-label={presentation.ariaLabel}
        aria-pressed={command.pressed}
        title={presentation.title ?? (command.description || command.reason ? tooltip : undefined)}
        disabled={command.disabled}
        onClick={() => onRun(id)}
      >
        {!presentation.hideIcon && (presentation.icon ?? <Icon className="size-3" aria-hidden="true" />)}
        {presentation.caption ?? presentation.shortLabel ?? command.label}
      </Button>
    )
  }
  if (surface === 'toolbar') {
    const captionFrom = presentation.captionFrom ?? false
    const caption = presentation.caption ?? presentation.shortLabel ?? command.label
    const primary = presentation.emphasis === 'primary'
    const responsive = captionFrom && captionFrom !== 'always' ? TOOLBAR_CAPTION[captionFrom] : undefined
    return (
      <Button
        variant={primary ? 'default' : 'ghost'}
        size={captionFrom === 'always' ? 'xs' : 'icon-xs'}
        className={cn(
          'max-w-[14rem] shrink-0 gap-1.5 text-xs',
          responsive?.button,
          !primary && 'text-foreground/80 hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground',
        )}
        data-command={id}
        aria-label={presentation.ariaLabel}
        aria-pressed={command.pressed}
        aria-expanded={presentation.expanded}
        aria-keyshortcuts={presentation.keyShortcuts}
        title={tooltip}
        disabled={command.disabled}
        onClick={() => onRun(id)}
      >
        {presentation.icon ?? <Icon className="size-4" aria-hidden="true" />}
        {captionFrom === 'always' && <span className="truncate">{caption}</span>}
        {responsive && <span className={responsive.caption}>{caption}</span>}
        {captionFrom === false && !presentation.ariaLabel && <span className="sr-only">{caption}</span>}
      </Button>
    )
  }
  if (surface === 'header') {
    const captionFrom = presentation.captionFrom ?? false
    const caption = presentation.caption ?? presentation.shortLabel ?? command.label
    return (
      <Button
        variant={presentation.emphasis === 'primary' ? 'default' : 'outline'}
        size="sm"
        className={cn(
          captionFrom === 'always' ? 'h-8' : 'size-8 px-0',
          captionFrom === 'lg' && 'lg:w-auto lg:px-3',
          captionFrom === '2xl' && '2xl:w-auto 2xl:max-w-[14rem] 2xl:px-3',
        )}
        data-command={id}
        aria-label={presentation.ariaLabel}
        aria-pressed={command.pressed}
        aria-expanded={presentation.expanded}
        aria-keyshortcuts={presentation.keyShortcuts}
        title={tooltip}
        disabled={command.disabled}
        onClick={() => onRun(id)}
      >
        {captionFrom !== 'always' &&
          (presentation.icon ?? (
            <Icon
              className={cn(
                'size-4',
                captionFrom === 'lg' && 'lg:mr-1 lg:size-3',
                captionFrom === '2xl' && '2xl:mr-1 2xl:size-3',
              )}
              aria-hidden="true"
            />
          ))}
        {captionFrom === 'always' && caption}
        {captionFrom === 'lg' && <span className="sr-only lg:not-sr-only">{caption}</span>}
        {captionFrom === '2xl' && <span className="hidden truncate 2xl:inline">{caption}</span>}
        {/* The bordered button has no caption step at xl: it stays an icon, named for screen readers. */}
        {captionFrom === 'xl' && !presentation.ariaLabel && <span className="sr-only">{caption}</span>}
        {captionFrom === false && !presentation.ariaLabel && <span className="sr-only">{caption}</span>}
      </Button>
    )
  }
  const quick = surface === 'quick'
  return (
    <button
      type="button"
      className={quick ? 'lp-quick-command' : 'lp-command'}
      data-ribbon-item={id}
      data-primary={primary || undefined}
      onClick={() => onRun(id)}
      disabled={command.disabled}
      aria-pressed={command.pressed}
      aria-label={quick ? `Quick access: ${command.label}` : undefined}
      aria-keyshortcuts={presentation.keyShortcuts}
      title={tooltip}
    >
      <Icon size={quick ? 16 : 18} strokeWidth={1.65} aria-hidden="true" />
      {!quick &&
        (command.captions.length > 1 ? (
          // The captions stack in one cell; only the current one shows, the others hold its width.
          <span className="lp-command-caption">
            <span>{command.label}</span>
            {command.captions
              .filter((caption) => caption !== command.label)
              .map((caption) => (
                <span key={caption} className="lp-caption-reserve" aria-hidden="true">
                  {caption}
                </span>
              ))}
          </span>
        ) : (
          command.label
        ))}
    </button>
  )
}
