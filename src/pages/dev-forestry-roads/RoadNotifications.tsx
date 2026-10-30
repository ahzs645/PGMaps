import type { ReactNode } from 'react'
import { CircleAlert, LoaderCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type RoadToast = {
  id: string
  message: string
  action?: ReactNode
} & ({ tone: 'loading' } | { tone: 'error'; onDismiss: () => void })

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
          className="pointer-events-auto space-y-1 rounded-xl border bg-background p-3 text-sm text-foreground shadow-xl"
        >
          <div className="flex items-center gap-3">
            {item.tone === 'loading' ? (
              <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin text-primary" />
            ) : (
              <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-destructive" />
            )}
            <p
              role={item.tone === 'error' ? 'alert' : 'status'}
              className="min-w-0 flex-1 break-words text-xs leading-5"
            >
              {item.message}
            </p>
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
          {item.action && <div className="pl-7">{item.action}</div>}
        </div>
      ))}
    </section>
  )
}
