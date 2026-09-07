import { ArrowRight, Folder } from 'lucide-react'
import { Link } from 'react-router-dom'
import { collectionHref, type ProjectCollectionSummary } from '@/lib/projectCollections'

export function ProjectCollectionCards({ collections }: { collections: ProjectCollectionSummary[] }) {
  if (!collections.length) return null
  return (
    <nav aria-label="Project folders" className="grid gap-3 border-b p-3 sm:p-4">
      {collections.map(({ collection, count, total }) => (
        <Link
          key={collection.slug}
          to={collectionHref(collection.slug)}
          className="flex min-w-0 items-start gap-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4 transition-colors hover:bg-cyan-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Folder className="mt-0.5 h-6 w-6 shrink-0 text-cyan-700 dark:text-cyan-300" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Project folder</span>
            <span className="mt-1 block text-base font-bold">{collection.title}</span>
            <span className="mt-1 block text-sm leading-6 text-muted-foreground">{collection.description}</span>
            <span className="mt-2 block text-xs font-medium">
              {count === total
                ? `${total} projects`
                : `${count} matching ${count === 1 ? 'project' : 'projects'} · ${total} total`}
            </span>
          </span>
          <ArrowRight className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
        </Link>
      ))}
    </nav>
  )
}
