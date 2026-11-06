import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The way back to the forestry hub. `icon` sits in a tool's sidebar or workspace header;
 * `text` heads a scrolling page, where there is room to spell it out.
 */
export function ForestryBackLink({ variant = 'icon', className }: { variant?: 'icon' | 'text'; className?: string }) {
  if (variant === 'text')
    return (
      <Link
        to="/dev/forestry"
        className={cn(
          'mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground',
          className,
        )}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Forestry tools
      </Link>
    )
  return (
    <Button variant="ghost" size="icon" className="size-8 shrink-0" asChild>
      <Link to="/dev/forestry" aria-label="Back to forestry tools" title="Forestry tools">
        <ArrowLeft className="size-4" aria-hidden="true" />
      </Link>
    </Button>
  )
}
