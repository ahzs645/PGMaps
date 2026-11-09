import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Notification } from '@/components/ui/notification'
import { useAppUpdate } from './useAppUpdate'

export function AppUpdateNotice() {
  const { availableVersion, updateAvailable, dismissUpdate, applyUpdate } = useAppUpdate()

  if (!updateAvailable) return null

  return (
    <Notification
      id="app-update"
      tone="info"
      icon={<RefreshCw />}
      aria-label="Application update available"
      title="PGMaps update ready"
      message={`Reload to use the latest maps and application changes${availableVersion ? ` (${availableVersion.slice(0, 8)})` : ''}.`}
      actions={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={dismissUpdate}>
            Later
          </Button>
          <Button type="button" size="sm" onClick={applyUpdate}>
            <RefreshCw aria-hidden="true" />
            Reload
          </Button>
        </>
      }
    />
  )
}
