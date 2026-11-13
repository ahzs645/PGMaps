import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { InfoTip } from '@/components/ui/info-tip'
import { CollapsibleSection, SidebarSection } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'

/** A fold's header row answers the pointer with a wash of the text colour, light or dark. */
const FOLD_ROW_HOVER = '[&>div:first-child]:transition-colors [&>div:first-child:hover]:bg-foreground/[0.05]'

export type ToolSectionProps = {
  title: string
  /** The section's explanation, behind an (i) in its heading rather than printed under it. */
  help?: ReactNode
  /** Controls on the heading row, before the (i). */
  actions?: ReactNode
  /**
   * Folds the section to one row that states its current values. Leave it out for a section
   * that is always open. Folded content stays mounted.
   */
  summary?: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Extra attributes for the fold toggle, e.g. a `data-*` hook tests click. */
  toggleProps?: ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string | undefined>
  className?: string
  'aria-label'?: string
  children: ReactNode
} & Record<`data-${string}`, string | undefined>

/**
 * A flat sidebar section for a dense tool sidebar: a title, its explanation behind an (i), and
 * full-width rules between sections instead of cards inside cards. With `summary` it folds to
 * one row that states the section's live values, so a long sidebar reads as a list of what is
 * set. The forestry road designer and visual-quality sidebars are built from it.
 */
export function ToolSection({
  title,
  help,
  actions,
  summary,
  defaultOpen = false,
  open,
  onOpenChange,
  toggleProps,
  className,
  children,
  ...props
}: ToolSectionProps) {
  const heading = (help || actions) && (
    <>
      {actions}
      {help && <InfoTip label={`About ${title.toLowerCase()}`}>{help}</InfoTip>}
    </>
  )
  if (summary !== undefined)
    return (
      <div className={className} {...props}>
        <CollapsibleSection
          className={FOLD_ROW_HOVER}
          label={title}
          summary={summary}
          summaryWhenCollapsedOnly
          defaultOpen={defaultOpen}
          open={open}
          onOpenChange={onOpenChange}
          contentClassName="space-y-2 px-3 pb-3"
          toggleProps={toggleProps}
          actions={heading}
        >
          {children}
        </CollapsibleSection>
      </div>
    )
  return (
    <SidebarSection title={title} className={cn('px-3 py-3', className)} actions={heading} {...props}>
      {children}
    </SidebarSection>
  )
}

export type ToolDisclosureProps = {
  label: ReactNode
  /** One line naming what is inside, shown while folded. */
  summary?: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** The fold's explanation, behind an (i) on its row rather than a paragraph inside it. */
  help?: ReactNode
  actions?: ReactNode
  toggleProps?: ToolSectionProps['toggleProps']
  contentClassName?: string
  children: ReactNode
}

/**
 * A fold inside a `ToolSection`: a hairline above and the label lined up with the section's own
 * content, rather than a bordered card inside the section.
 */
export function ToolDisclosure({ contentClassName, help, actions, ...props }: ToolDisclosureProps) {
  const label = typeof props.label === 'string' ? props.label.toLowerCase() : 'this section'
  return (
    <CollapsibleSection
      {...props}
      actions={
        help || actions ? (
          <>
            {actions}
            {help && <InfoTip label={`About ${label}`}>{help}</InfoTip>}
          </>
        ) : undefined
      }
      summaryWhenCollapsedOnly
      // Consecutive folds share their rules with no gap from a parent's `space-y-*`.
      className={cn('-mx-3 border-b-0 border-t border-border/60 bg-transparent [section+&]:!mt-0', FOLD_ROW_HOVER)}
      contentClassName={cn('space-y-2 px-3 pb-3', contentClassName)}
    />
  )
}
