import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useParams } from 'react-router-dom'
import { projectCatalogDestination } from '@/lib/projectCollections'

/**
 * Return to the project’s catalog folder, or the catalog for ungrouped projects.
 */
export function ProjectBackButton({ onBack, className }: { onBack: () => void; className?: string }) {
  const { projectSlug } = useParams<{ projectSlug?: string }>()
  const destination = projectCatalogDestination(projectSlug)
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
      {destination.label}
    </button>
  )
}
