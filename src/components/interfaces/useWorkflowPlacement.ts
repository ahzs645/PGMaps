import { useCallback, useState } from 'react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import type { WorkflowEditor, WorkspaceLayout } from './workspaceLayouts'

/** Route both ribbon clicks and links inside editors through the layout's editor assignments. */
export function useWorkflowPlacement(layout: WorkspaceLayout, investigation: boolean) {
  // A fixed portal container keeps every editor (including pending optimizations and drafts)
  // mounted when its host moves between the ribbon and the resizable sidebar.
  const [editorHost] = useState(() => {
    const node = document.createElement('div')
    node.className = 'contents'
    return node
  })
  const attachEditor = useCallback(
    (slot: HTMLDivElement | null) => {
      if (slot) slot.appendChild(editorHost)
    },
    [editorHost],
  )
  const toolbar = layout.toolbar
  const shortLandscape = useMediaQuery('(orientation: landscape) and (max-height: 480px)')
  const minimizeOnCanvas =
    !!toolbar?.compact && toolbar.dock === 'top' && shortLandscape && toolbar.minimizeOnShortScreens !== false
  const [location, setLocation] = useState<{
    layoutId: string
    group?: string
    folded?: boolean
    minimized?: boolean
    workflow: WorkflowEditor
    sidebar: boolean
  }>({ layoutId: layout.id, workflow: 'design', sidebar: false })
  const groupName =
    (location.layoutId === layout.id && location.group) || toolbar?.startGroup || toolbar?.groups[0].label
  const group = toolbar?.groups.find((group) => group.label === groupName)
  const inRibbon =
    !investigation &&
    !!toolbar?.groups.some((group) => group.editor) &&
    !(layout.id === location.layoutId && location.sidebar)
  const workflow = (inRibbon && group?.editor) || location.workflow

  const selectGroup = (name: string, folded?: boolean) => {
    const target = toolbar?.groups.find((group) => group.label === name)
    setLocation({
      layoutId: layout.id,
      group: name,
      workflow: target?.editor ?? workflow,
      sidebar: false,
      folded,
      minimized: false,
    })
  }

  const selectWorkflow = useCallback(
    (next: WorkflowEditor) => {
      const target = toolbar?.groups.find((group) => group.editor === next)
      setLocation((previous) => ({
        layoutId: layout.id,
        group: target?.label ?? (previous.layoutId === layout.id ? previous.group : undefined),
        workflow: next,
        sidebar: !target,
        folded: false,
        minimized: false,
      }))
    },
    [layout.id, toolbar],
  )
  const startFolded = !!toolbar?.compact && !!group?.editor && !!(group.sections?.length || group.commands?.length)
  const folded = (location.layoutId === layout.id ? location.folded : undefined) ?? startFolded
  const toggleFold = () =>
    setLocation((previous) => ({
      ...previous,
      layoutId: layout.id,
      group: groupName,
      folded: !folded,
      minimized: false,
    }))
  const minimized = (location.layoutId === layout.id ? location.minimized : undefined) ?? minimizeOnCanvas
  const toggleMinimized = () =>
    setLocation((previous) => ({ ...previous, layoutId: layout.id, group: groupName, minimized: !minimized }))
  const minimizeForCanvas = () => {
    if (minimizeOnCanvas)
      setLocation((previous) =>
        previous.layoutId === layout.id
          ? { ...previous, minimized: true }
          : { layoutId: layout.id, group: groupName, workflow, sidebar: false, minimized: true },
      )
  }
  return {
    groupName,
    workflow,
    inRibbon,
    selectGroup,
    selectWorkflow,
    folded,
    toggleFold,
    minimized,
    toggleMinimized,
    minimizeForCanvas,
    editorHost,
    attachEditor,
  }
}
