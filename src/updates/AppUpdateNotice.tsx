import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppUpdate } from './useAppUpdate'

export function AppUpdateNotice() {
  const { availableVersion, updateAvailable, dismissUpdate, applyUpdate } = useAppUpdate()

  if (!updateAvailable) return null

  return (
    <aside
      role="status"
      aria-live="polite"
      aria-label="Application update available"
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-[1300] rounded-xl border border-cyan-500/30 bg-background/95 p-4 text-foreground shadow-2xl backdrop-blur sm:inset-x-auto sm:right-4 sm:w-[24rem]"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-700 dark:text-cyan-300">
          <RefreshCw className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">PGMaps update ready</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Reload to use the latest maps and application changes
            {availableVersion ? ` (${availableVersion.slice(0, 8)})` : ''}.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={dismissUpdate}>
              Later
            </Button>
            <Button type="button" size="sm" onClick={applyUpdate}>
              <RefreshCw aria-hidden="true" />
              Reload
            </Button>
          </div>
        </div>
      </div>
    </aside>
  )
}
