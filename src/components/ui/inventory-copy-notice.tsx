import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { Notification } from '@/components/ui/notification'
import { DEFAULT_LOCALE } from '@/lib/format'
import { onInventoryCopyUsed } from '@/lib/offline/inventoryCopies'

/**
 * Says so whenever an inventory read was answered from a kept copy (docs/app-updates-and-caching.md,
 * **Inventory copies**): how many reads, and the day the oldest of them was read. Mounted once in
 * the shell, so it shows on whichever page made the read and from its workers too. It only appears
 * with the option on and a source out of reach; a copy is never used silently.
 */
export function InventoryCopyNotice() {
  const [used, setUsed] = useState<{ urls: string[]; oldest: string } | null>(null)

  useEffect(
    () =>
      onInventoryCopyUsed(({ url, readAt }) =>
        setUsed((before) => ({
          urls: before?.urls.includes(url) ? before.urls : [...(before?.urls ?? []), url],
          oldest: before && before.oldest < readAt ? before.oldest : readAt,
        })),
      ),
    [],
  )

  if (!used) return null
  const count = used.urls.length
  const day = new Date(used.oldest).toLocaleDateString(DEFAULT_LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  return (
    <Notification
      id="inventory-copies-in-use"
      tone="warning"
      icon={<History />}
      data-testid="inventory-copy-notice"
      aria-label="Inventory read from kept copies"
      title="Inventory from kept copies"
      message={`The BC inventory could not be reached, so ${count === 1 ? 'one read' : `${count} reads`} came from ${
        count === 1 ? 'a copy' : 'copies'
      } kept in this browser, ${count === 1 ? 'read' : 'the oldest read'} on ${day}. Figures made now rest on that copy; read again online before relying on them.`}
      onDismiss={() => setUsed(null)}
      dismissLabel="Dismiss"
    />
  )
}
