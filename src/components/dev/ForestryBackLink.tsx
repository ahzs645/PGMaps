import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageBackLink } from './PageBackLink'

/**
 * The way back to the forestry hub. `icon` sits in a tool's sidebar or workspace header;
 * `text` heads a scrolling page, where there is room to spell it out.
 */
export function ForestryBackLink({ variant = 'icon', className }: { variant?: 'icon' | 'text'; className?: string }) {
  // `className` styles the text link only; the icon button keeps its own size.
  if (variant === 'text')
    return (
      <PageBackLink to="/dev/forestry" className={className}>
        Forestry tools
      </PageBackLink>
    )
  return (
    <Button variant="ghost" size="icon" className="size-8 shrink-0" asChild>
      <Link to="/dev/forestry" aria-label="Back to forestry tools" title="Forestry tools">
        <ArrowLeft className="size-4" aria-hidden="true" />
      </Link>
    </Button>
  )
}
