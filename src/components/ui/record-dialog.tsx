import { useTheme } from 'next-themes'
import type { ComponentProps } from 'react'
import { RecordDialog as ToolkitRecordDialog } from '@pgmaps/geo-toolkit/ui/record-dialog'
export * from '@pgmaps/geo-toolkit/ui/record-dialog'
const toolbarVisibility = (hidden: boolean) =>
  window.dispatchEvent(new CustomEvent('pgmaps:mobile-toolbar-visibility', { detail: { hidden } }))
export function RecordDialog(props: ComponentProps<typeof ToolkitRecordDialog>) {
  const { resolvedTheme } = useTheme()
  return (
    <ToolkitRecordDialog
      {...props}
      theme={props.theme ?? (resolvedTheme === 'dark' ? 'dark' : 'light')}
      onOpenEffect={props.onOpenEffect ?? toolbarVisibility}
      contentProps={{
        ...props.contentProps,
        onKeyDown: (event) => {
          props.contentProps?.onKeyDown?.(event)
          // Handle the focused record before an outer portal window receives Escape.
          if (
            event.key === 'Escape' &&
            !event.defaultPrevented &&
            event.target instanceof Element &&
            event.target.closest('[role="dialog"]') === event.currentTarget
          ) {
            event.preventDefault()
            event.stopPropagation()
            props.onClose()
          }
        },
      }}
    />
  )
}
