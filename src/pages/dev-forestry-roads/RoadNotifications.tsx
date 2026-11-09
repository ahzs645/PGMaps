import type { ReactNode } from 'react'
import { Notification } from '@/components/ui/notification'

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

/**
 * Road jobs and failures in the app's shared notification stack.
 * Loading stays visible until the job finishes; errors can be dismissed.
 */
export function RoadNotifications({ items }: { items: RoadToast[] }) {
  return (
    <>
      {items.map((item) =>
        item.tone === 'loading' ? (
          <Notification
            key={item.id}
            id={item.id}
            data-testid="workspace-toast-loading"
            tone="loading"
            title={item.title}
            message={item.message}
            action={item.action}
            progress={
              item.progress && {
                value: item.progress.step,
                max: item.progress.total,
                label: item.title ?? item.message,
              }
            }
          />
        ) : (
          <Notification
            key={item.id}
            id={item.id}
            data-testid="workspace-toast-error"
            tone="error"
            message={item.message}
            action={item.action}
            onDismiss={item.onDismiss}
            dismissLabel="Dismiss error notification"
          />
        ),
      )}
    </>
  )
}
