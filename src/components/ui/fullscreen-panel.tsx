import type { ComponentProps } from 'react'
import { useTheme } from 'next-themes'
import { FullscreenPanel as ToolkitFullscreenPanel } from '@pgmaps/geo-toolkit/ui/fullscreen-panel'
export * from '@pgmaps/geo-toolkit/ui/fullscreen-panel'

const toolbarVisibility = (hidden: boolean) =>
  window.dispatchEvent(new CustomEvent('pgmaps:mobile-toolbar-visibility', { detail: { hidden } }))

/** Supply PG Maps theme and mobile chrome policy to the package-owned panel. */
export function FullscreenPanel(props: ComponentProps<typeof ToolkitFullscreenPanel>) {
  const { resolvedTheme } = useTheme()
  return (
    <ToolkitFullscreenPanel
      {...props}
      dialogOptions={{
        theme: resolvedTheme === 'dark' ? 'dark' : 'light',
        onOpenEffect: toolbarVisibility,
        ...props.dialogOptions,
      }}
    />
  )
}
