import { useTheme } from 'next-themes'
import { DialogShell as ToolkitDialogShell, PanelDialog as ToolkitPanelDialog, type DialogShellProps } from '@pgmaps/geo-toolkit/ui/dialog-shell'
export * from '@pgmaps/geo-toolkit/ui/dialog-shell'
const toolbarVisibility = (hidden: boolean) => window.dispatchEvent(new CustomEvent('pgmaps:mobile-toolbar-visibility', { detail: { hidden } }))
export function DialogShell(props: DialogShellProps) { const { resolvedTheme } = useTheme(); return <ToolkitDialogShell {...props} theme={props.theme ?? (resolvedTheme === 'dark' ? 'dark' : 'light')} onOpenEffect={props.onOpenEffect ?? toolbarVisibility} /> }
export function PanelDialog(props: DialogShellProps) { const { resolvedTheme } = useTheme(); return <ToolkitPanelDialog {...props} theme={props.theme ?? (resolvedTheme === 'dark' ? 'dark' : 'light')} onOpenEffect={props.onOpenEffect ?? toolbarVisibility} /> }
