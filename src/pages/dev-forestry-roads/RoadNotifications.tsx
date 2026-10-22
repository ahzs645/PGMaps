import type { ReactNode } from 'react'
import { CircleAlert, LoaderCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface RoadToast {
  id: string
  message: string
  tone: 'loading' | 'error'
  onDismiss: () => void
  action?: ReactNode
}

/** Host-owned notifications; dismissing one never cancels the underlying work. */
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
          className="pointer-events-auto flex items-start gap-3 rounded-xl border bg-background p-3 text-sm text-foreground shadow-xl"
        >
          {item.tone === 'loading' ? (
            <LoaderCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
          ) : (
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          )}
          <div className="min-w-0 flex-1">
            <p role={item.tone === 'error' ? 'alert' : 'status'} className="text-xs leading-5">
              {item.message}
            </p>
            {item.action}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={item.tone === 'loading' ? 'Dismiss loading notification' : 'Dismiss error notification'}
            onClick={item.onDismiss}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
    </section>
  )
}
