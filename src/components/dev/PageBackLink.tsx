import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

/** The way back that heads a scrolling tool page, passed as `ToolPageHeader`'s `back`. */
export function PageBackLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        'mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {children}
    </Link>
  )
}

/** Back to `/dev`, the library every dev tool and hub page is listed in. */
export function DevLibraryBackLink({ className }: { className?: string }) {
  return (
    <PageBackLink to="/dev" className={className}>
      Dev library
    </PageBackLink>
  )
}
