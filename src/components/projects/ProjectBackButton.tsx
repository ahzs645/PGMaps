import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * "All projects" — the way back to the catalog from every project renderer
 * (workspace, story layouts, map explorer), so the label and look match.
 */
export function ProjectBackButton({ onBack, className }: { onBack: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-md border bg-background px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted touch:h-10',
        className,
      )}
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
      All projects
    </button>
  )
}
