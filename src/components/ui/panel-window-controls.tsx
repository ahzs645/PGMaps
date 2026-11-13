import type { ComponentProps } from 'react'
import { useTheme } from 'next-themes'
import { PanelWindowControls as ToolkitPanelWindowControls } from '@pgmaps/geo-toolkit/ui/panel-window-workspace'

const toolbarVisibility = (open: boolean) =>
  window.dispatchEvent(new CustomEvent('pgmaps:mobile-toolbar-visibility', { detail: { hidden: open } }))

/** Host theme and mobile chrome policy for the shared detached-panel manager. */
export function PanelWindowControls(props: ComponentProps<typeof ToolkitPanelWindowControls>) {
  const { resolvedTheme } = useTheme()
  return (
    <ToolkitPanelWindowControls
      {...props}
      dialogOptions={{
        theme: resolvedTheme === 'dark' ? 'dark' : 'light',
        onOpenEffect: toolbarVisibility,
        ...props.dialogOptions,
      }}
    />
  )
}
