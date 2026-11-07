import type { ReactNode } from 'react'
import { CircleAlert, LoaderCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type RoadToast = {
  id: string
  message: string
  action?: ReactNode
} & (
  | {
      tone: 'loading'
      /** The job as a whole, when `message` is its current step. */
      title?: string
      progress?: { step: number; total: number }
    }
  | { tone: 'error'; onDismiss: () => void }
)

/** Loading stays visible until the job finishes; errors can be dismissed. */
export function RoadNotifications({ items }: { items: RoadToast[] }) {
  return (
    <section
      aria-label="Workspace notifications"
      className="pointer-events-none fixed inset-x-3 top-4 z-[2200] mx-auto flex max-w-lg flex-col gap-2"
    >
      {items.map((item) => (
        <div
          key={item.id}
          data-testid={`workspace-toast-${item.tone}`}
          className="pointer-events-auto space-y-2 rounded-xl border bg-background p-3 text-sm text-foreground shadow-xl"
        >
          <div className="flex items-center gap-3">
            {item.tone === 'loading' ? (
              <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin text-primary" />
            ) : (
              <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-destructive" />
            )}
            <div className="min-w-0 flex-1">
              {item.tone === 'loading' && item.title && <p className="text-xs font-semibold leading-5">{item.title}</p>}
              <p
                role={item.tone === 'error' ? 'alert' : 'status'}
                className={`break-words text-xs leading-5 ${item.tone === 'loading' && item.title ? 'text-muted-foreground' : ''}`}
              >
                {item.message}
              </p>
            </div>
            {item.tone === 'loading' && item.progress && (
              <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                {item.progress.step} of {item.progress.total}
              </span>
            )}
            {item.action}
            {item.tone === 'error' && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label="Dismiss error notification"
                onClick={item.onDismiss}
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
          {item.tone === 'loading' && item.progress && (
            <div
              role="progressbar"
              aria-label={item.title ?? item.message}
              aria-valuemin={0}
              aria-valuemax={item.progress.total}
              aria-valuenow={item.progress.step}
              className="h-1 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${(item.progress.step / item.progress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </section>
  )
}
