import { useTheme } from 'next-themes'
import type { ComponentProps } from 'react'
import { RecordDialog as ToolkitRecordDialog } from '@pgmaps/geo-toolkit/ui/record-dialog'
export * from '@pgmaps/geo-toolkit/ui/record-dialog'
const toolbarVisibility = (hidden: boolean) => window.dispatchEvent(new CustomEvent('pgmaps:mobile-toolbar-visibility', { detail: { hidden } }))
export function RecordDialog(props: ComponentProps<typeof ToolkitRecordDialog>) { const { resolvedTheme } = useTheme(); return <ToolkitRecordDialog {...props} theme={props.theme ?? (resolvedTheme === 'dark' ? 'dark' : 'light')} onOpenEffect={props.onOpenEffect ?? toolbarVisibility} /> }
