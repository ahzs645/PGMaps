import { useCallback, useState } from 'react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import type { AnyLayout } from './workspaceLayoutSchema'

type EditorOf<L extends AnyLayout> = NonNullable<NonNullable<L['toolbar']>['groups'][number]['editor']>

/**
 * Route both ribbon clicks and links inside editors through the layout's editor assignments.
 * `defaultEditor` is the editor shown before any is chosen; `investigation` (the road designer's
 * access investigation) keeps every editor out of the ribbon.
 */
export function useWorkflowPlacement<L extends AnyLayout>(
  layout: L,
  investigation: boolean,
  defaultEditor: EditorOf<L>,
) {
  type E = EditorOf<L>
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
    workflow: E
    sidebar: boolean
  }>(() => {
    const params = new URLSearchParams(window.location.search)
    const requested =
      params.get('example') === 'training' && params.get('interface') === layout.id
        ? toolbar?.groups.find((item) => item.label === params.get('ribbonTab'))
        : undefined
    return { layoutId: layout.id, group: requested?.label, workflow: defaultEditor, sidebar: false }
  })
  const groupName =
    (location.layoutId === layout.id && location.group) || toolbar?.startGroup || toolbar?.groups[0].label
  const group = toolbar?.groups.find((group) => group.label === groupName)
  const inRibbon =
    !investigation &&
    !!toolbar?.groups.some((group) => group.editor) &&
    !(layout.id === location.layoutId && location.sidebar)
  const workflow = ((inRibbon && group?.editor) || location.workflow) as E

  const selectGroup = (name: string, folded?: boolean) => {
    const target = toolbar?.groups.find((group) => group.label === name)
    setLocation({
      layoutId: layout.id,
      group: name,
      workflow: (target?.editor as E | undefined) ?? workflow,
      sidebar: false,
      folded,
      minimized: false,
    })
  }

  /**
   * Show an editor: its ribbon tab with its settings open, else the sidebar. With `reveal: false`
   * (the tool moving on by itself) the tab changes but an open or folded pane stays as it was.
   */
  const selectWorkflow = useCallback(
    (next: E, options?: { reveal?: boolean }) => {
      const reveal = options?.reveal ?? true
      const target = toolbar?.groups.find((group) => group.editor === next)
      setLocation((previous) => {
        const same = previous.layoutId === layout.id
        return {
          layoutId: layout.id,
          group: target?.label ?? (same ? previous.group : undefined),
          workflow: next,
          sidebar: !target,
          folded: reveal ? false : same ? previous.folded : undefined,
          minimized: reveal ? false : same ? previous.minimized : undefined,
        }
      })
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
