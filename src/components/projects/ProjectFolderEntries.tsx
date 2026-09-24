import { ArrowRight, Folder } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { collectionHref, type ProjectCollectionSummary } from '@/lib/projectCollections'
import { cn } from '@/lib/utils'

/** Folders sit in the catalog list as ordinary entries, styled like their project neighbours. */

export function folderCountLabel({ count, total }: ProjectCollectionSummary) {
  if (count === total) return `${total} ${total === 1 ? 'project' : 'projects'}`
  return `${count} matching · ${total} total`
}

function FolderTile({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md border border-cyan-600/40 bg-cyan-600/10 text-cyan-700 dark:text-cyan-300',
        className,
      )}
    >
      <Folder className="h-4 w-4" aria-hidden="true" />
    </span>
  )
}

export function FolderBadge() {
  return (
    <Badge tone="cyan" variant="outline" size="sm" className="font-semibold">
      Folder
    </Badge>
  )
}

/** Desktop catalog table row. Every cell links to the folder. */
export function ProjectFolderRow({ summary }: { summary: ProjectCollectionSummary }) {
  const { collection } = summary
  const href = collectionHref(collection.slug)
  return (
    <tr data-entry="folder" className="align-top transition-colors hover:bg-muted/30">
      <td className="px-4 py-3">
        <Link to={href} className="flex w-full min-w-0 items-start gap-3 text-left">
          <FolderTile className="h-9 w-9" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">{collection.title}</span>
            <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{collection.description}</span>
          </span>
        </Link>
      </td>
      <td className="px-3 py-3">
        <FolderBadge />
      </td>
      <td className="px-3 py-3 text-xs leading-5 text-muted-foreground">
        <div>
          <span className="font-medium text-foreground">{summary.total}</span> projects
        </div>
        {summary.count !== summary.total && (
          <div>
            <span className="font-medium text-foreground">{summary.count}</span> matching
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          to={href}
          aria-label={`Open ${collection.title} folder`}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Open
          <ArrowRight className="h-4 w-4" />
        </Link>
      </td>
    </tr>
  )
}

/** Mobile and tablet catalog card. The whole card is one tap target. */
export function ProjectFolderCard({ summary }: { summary: ProjectCollectionSummary }) {
  const { collection } = summary
  return (
    <article data-entry="folder" className="overflow-hidden rounded-lg border bg-background shadow-sm">
      <Link
        to={collectionHref(collection.slug)}
        className="block p-3 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start gap-3">
          <FolderTile className="h-9 w-9" />
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <FolderBadge />
              <span className="text-xs font-medium text-muted-foreground">{folderCountLabel(summary)}</span>
            </div>
            <h2 className="text-sm font-bold leading-tight text-foreground">{collection.title}</h2>
          </div>
        </div>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{collection.description}</p>
        <span className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-3 min-h-11 w-full')}>
          Open folder
          <ArrowRight className="h-4 w-4" />
        </span>
      </Link>
    </article>
  )
}
