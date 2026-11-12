import type { EditorResult } from './RibbonFinder'
import type { WorkspaceToolbar } from './workspaceLayouts'

/** Read the mounted editors when Find tools opens, including sections inside folded disclosures. */
export function editorSections(host: HTMLElement, tabs: WorkspaceToolbar['groups'], disabled: boolean): EditorResult[] {
  return tabs.flatMap((tab) => {
    if (!tab.editor) return []
    const editor = host.querySelector<HTMLElement>(`[data-workflow-editor="${tab.editor}"]`)
    if (!editor) return []
    return Array.from(editor.querySelectorAll<HTMLElement>('[data-workflow-section]')).flatMap((target) => {
      const hidden = target.closest('[hidden]')
      if (hidden && editor.contains(hidden) && hidden !== editor) return []
      const label = target.dataset.workflowSection!
      return [
        {
          id: label,
          label,
          target,
          tab: tab.label,
          section: 'All settings',
          disabled: disabled || target.matches(':disabled'),
        },
      ]
    })
  })
}

export function revealEditorSection(target: HTMLElement) {
  const editor = target.closest('[data-workflow-editor]')
  if (!editor || !target.isConnected) return
  // Open outer disclosures before nested ones through their own controlled or uncontrolled handlers.
  const ancestors: HTMLElement[] = []
  for (let node = target.parentElement; node && node !== editor; node = node.parentElement) ancestors.unshift(node)
  for (const node of ancestors) {
    if (node instanceof HTMLDetailsElement) node.open = true
    if (node.id) {
      editor
        .querySelector<HTMLButtonElement>(
          `[data-workflow-section][aria-controls="${CSS.escape(node.id)}"][aria-expanded="false"]`,
        )
        ?.click()
    }
  }
  if (target.matches('button[aria-expanded="false"]')) target.click()
  target.focus({ preventScroll: true })
  target.scrollIntoView({ block: 'start', inline: 'nearest' })
}
