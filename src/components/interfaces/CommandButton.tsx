import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { resolveCommand, type CommandState, type WorkspaceCommand } from './workspaceCommands'

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
  captionFrom?: 'always' | 'lg' | '2xl' | false
  emphasis?: 'primary'
  keyShortcuts?: string
  /** Replaces the icon, e.g. a open/closed panel glyph that follows the state. */
  icon?: ReactNode
  caption?: ReactNode
  expanded?: boolean
}

type Surface = 'ribbon' | 'quick' | 'header' | 'sidebar'

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
  if (surface === 'sidebar') {
    return (
      <Button
        size="sm"
        variant={presentation.emphasis === 'primary' ? 'default' : 'outline'}
        className="min-w-0 gap-1 px-1"
        data-command={id}
        aria-label={presentation.ariaLabel}
        aria-pressed={command.pressed}
        title={presentation.title}
        disabled={command.disabled}
        onClick={() => onRun(id)}
      >
        {presentation.icon ?? <Icon className="size-3" aria-hidden="true" />}
        {presentation.caption ?? presentation.shortLabel ?? command.label}
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
        title={presentation.title ?? command.label}
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
      title={quick ? command.label : undefined}
    >
      <Icon size={quick ? 16 : 18} strokeWidth={1.65} aria-hidden="true" />
      {!quick && command.label}
    </button>
  )
}
