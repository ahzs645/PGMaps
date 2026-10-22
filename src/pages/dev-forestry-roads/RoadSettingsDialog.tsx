import type { ReactNode } from 'react'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { Button } from '@/components/ui/button'

/** Common settings surface for optional road engineering tools. */
export function RoadSettingsDialog({
  title,
  open,
  onOpenChange,
  busy,
  children,
}: {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  busy: boolean
  children: ReactNode
}) {
  return (
    <PanelDialog
      title={title}
      open={open}
      onOpenChange={onOpenChange}
      subtitle="Changes update the connected road views and save on this device."
      portalContainer={document.fullscreenElement as HTMLElement | null}
      footer={
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      }
    >
      <fieldset disabled={busy} className="space-y-5">
        {children}
      </fieldset>
    </PanelDialog>
  )
}
