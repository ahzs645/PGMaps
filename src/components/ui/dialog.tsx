import * as React from 'react'
import { useTheme } from 'next-themes'
import { DialogContent as ToolkitDialogContent, type DialogContentProps } from '@pgmaps/geo-toolkit/ui/dialog'
export * from '@pgmaps/geo-toolkit/ui/dialog'
const toolbarVisibility = (open: boolean) => {
  window.dispatchEvent(new CustomEvent('pgmaps:mobile-toolbar-visibility', { detail: { hidden: open } }))
}
export const DialogContent = React.forwardRef<React.ElementRef<typeof ToolkitDialogContent>, DialogContentProps>(
  ({ elevated, onOpenEffect, theme, ...props }, ref) => {
    const { resolvedTheme } = useTheme()
    return <ToolkitDialogContent theme={theme ?? (resolvedTheme === 'dark' ? 'dark' : 'light')} ref={ref} elevated={elevated} {...props}
    onOpenEffect={onOpenEffect ?? (elevated ? toolbarVisibility : undefined)} />
  },
)
DialogContent.displayName = 'DialogContent'
