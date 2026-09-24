import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { ExternalLink as ExternalLinkIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const toneClasses = {
  accent: 'text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300',
  muted: 'text-muted-foreground hover:text-foreground',
  danger: 'text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300',
  primary: 'text-primary hover:text-primary/80',
} as const

type TextButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: keyof typeof toneClasses
}

/**
 * A link-styled button for small actions (All, None, Reset, Clear, Show more).
 * Grows to a finger-sized hit area on touch screens without moving the text.
 */
export const TextButton = forwardRef<HTMLButtonElement, TextButtonProps>(function TextButton(
  { tone = 'accent', className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center gap-1 rounded text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 touch:min-h-9 touch:px-1.5',
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  )
})

type SelectAllActionsProps = {
  onAll: () => void
  onNone: () => void
  /** Disable "All" when everything is already selected, and so on. */
  allSelected?: boolean
  noneSelected?: boolean
  className?: string
}

/** The "All / None" pair for a filter group heading. */
export function SelectAllActions({ onAll, onNone, allSelected, noneSelected, className }: SelectAllActionsProps) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-2', className)}>
      <TextButton onClick={onAll} disabled={allSelected}>
        All
      </TextButton>
      <TextButton tone="muted" onClick={onNone} disabled={noneSelected}>
        None
      </TextButton>
    </span>
  )
}

type ExternalLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'target' | 'rel'> & {
  href: string
  children?: ReactNode
  /** `button`: bordered, for footers and cards. `link`: inline text. */
  variant?: 'button' | 'link'
  /** Hide the trailing arrow icon. */
  hideIcon?: boolean
}

/**
 * Opens a source page in a new tab. Always `noopener noreferrer`, and the
 * default label is "View source" so every section says the same thing.
 */
export function ExternalLink({ href, children = 'View source', variant = 'link', hideIcon = false, className, ...props }: ExternalLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-1 transition-colors',
        variant === 'button'
          ? 'justify-center whitespace-nowrap rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent touch:min-h-10'
          : 'text-xs font-medium text-sky-700 hover:underline dark:text-sky-400',
        className,
      )}
      {...props}
    >
      {children}
      {!hideIcon && <ExternalLinkIcon className="h-3 w-3 shrink-0" aria-hidden="true" />}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
