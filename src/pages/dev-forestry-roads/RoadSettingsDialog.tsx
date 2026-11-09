import { useState, type ReactNode } from 'react'
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
  // Mount inside the road workspace, as its other dialogs do. Its own fullscreen pins it above the
  // page (z-menu, 1300), so a dialog on the page body (1200) opened underneath, like a dead button.
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null)
  const container =
    anchor?.closest<HTMLElement>('.road-workspace') ?? (document.fullscreenElement as HTMLElement | null)
  return (
    <>
      <span ref={setAnchor} hidden />
      <PanelDialog
        title={title}
        open={open}
        onOpenChange={onOpenChange}
        subtitle="Changes update the connected road views and save on this device."
        portalContainer={container}
        footer={
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        }
      >
        <fieldset disabled={busy} className="min-w-0 w-full space-y-5">
          {children}
        </fieldset>
      </PanelDialog>
    </>
  )
}
