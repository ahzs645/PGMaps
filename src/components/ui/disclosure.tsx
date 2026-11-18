import type { ComponentProps, ReactNode } from 'react'

import { InfoTip } from '@/components/ui/info-tip'
import { CollapsibleSection } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'

/** A fold's header row answers the pointer with a wash of the text colour, light or dark. */
export const FOLD_ROW_HOVER = '[&>div:first-child]:transition-colors [&>div:first-child:hover]:bg-foreground/[0.05]'

export type DisclosureProps = {
  title: string
  /** One line naming what is inside or what it found, shown while folded. */
  summary?: ReactNode
  /** The fold's explanation, behind an (i) on its row rather than a paragraph inside it. */
  help?: ReactNode
  /** Controls on the header row, before the (i). */
  actions?: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  toggleProps?: ComponentProps<typeof CollapsibleSection>['toggleProps']
  className?: string
  contentClassName?: string
  children: ReactNode
}

const headerActions = (title: string, help: ReactNode, actions: ReactNode) =>
  help || actions ? (
    <>
      {actions}
      {help && <InfoTip label={`About ${title.toLowerCase()}`}>{help}</InfoTip>}
    </>
  ) : undefined

/**
 * A card that folds: a group of controls a reader opens when they want it, in a dialog or a panel that is not a tool
 * sidebar (there, `ToolSection` and `ToolDisclosure`). It is the shared `CollapsibleSection`, so the chevron, the
 * header's hover, the keyboard and the folded content staying mounted are the application's own. Use it instead of a
 * native `<details>`, whose marker and focus ring are the browser's.
 */
export function DisclosureCard({ title, help, actions, className, contentClassName, ...props }: DisclosureProps) {
  return (
    <CollapsibleSection
      {...props}
      label={<span className="text-sm font-semibold">{title}</span>}
      actions={headerActions(title, help, actions)}
      summaryWhenCollapsedOnly
      className={cn('overflow-hidden rounded-md border border-border bg-card', FOLD_ROW_HOVER, className)}
      contentClassName={cn('space-y-3 px-3 pb-3 text-xs', contentClassName)}
    />
  )
}

/**
 * A fold inside a card or among a form's fields: no box of its own, its label in line with the text round it and the
 * chevron at the row's end.
 */
export function DisclosureRow({ title, help, actions, className, contentClassName, ...props }: DisclosureProps) {
  return (
    <CollapsibleSection
      {...props}
      label={title}
      actions={headerActions(title, help, actions)}
      summaryWhenCollapsedOnly
      className={cn(
        'border-b-0 bg-transparent [&>div:first-child]:pr-0 [&>div:first-child>button]:rounded-sm [&>div:first-child>button]:px-0 [&>div:first-child>button]:py-1.5',
        '[&>div:first-child>button:hover]:text-foreground [&>div:first-child>button:hover_svg]:text-foreground',
        className,
      )}
      contentClassName={cn('space-y-2 pb-1 pt-1', contentClassName)}
    />
  )
}
