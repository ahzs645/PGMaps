import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ForestryBackLink } from '@/components/dev/ForestryBackLink'
import { InterfaceChooser } from '@/components/interfaces/InterfaceChooser'
import { RibbonPaneColumns, RibbonPaneHost } from '@/components/interfaces/RibbonTaskPane'
import { WorkspaceHeader } from '@/components/interfaces/WorkspaceHeader'
import { WorkspaceTools } from '@/components/interfaces/WorkspaceTools'
import { useRibbonPreferences } from '@/components/interfaces/ribbonPreferences'
import { useWorkflowPlacement } from '@/components/interfaces/useWorkflowPlacement'
import { useWorkspaceLayout } from '@/components/interfaces/useWorkspaceLayout'
import { workspaceFrameProps } from '@/components/interfaces/workspaceFrame'
import { preferences, type Command, type Editor, type Layout } from './layouts'

export interface Catalog {
  layouts: Layout[]
  initial: Layout
  fallback: boolean
}
export function Frame({
  layouts,
  initial,
  fallback,
  editors,
  children,
  onOpen,
  onSave,
  busy,
}: Catalog & {
  editors: Record<Editor, ReactNode>
  children: ReactNode
  onOpen: () => void
  onSave: () => void
  busy: boolean
}) {
  const { active, selectLayout, collapsed, setCollapsed } = useWorkspaceLayout(initial, {
    defaultPane: 'map',
    storeInterface: preferences.storeInterface,
  })
  const ribbon = useRibbonPreferences(active)
  const {
    selectWorkflow,
    groupName,
    folded,
    minimized,
    toggleFold,
    toggleMinimized,
    selectGroup,
    editorHost,
    inRibbon,
    attachEditor,
    workflow,
  } = useWorkflowPlacement(active, false, 'blocks')
  const [choosing, setChoosing] = useState(false)
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  const [docked, setDocked] = useState(false)
  function command(id: Command) {
    switch (id) {
      case 'open':
        return onOpen()
      case 'export':
        return onSave()
      case 'chooseInterface':
        return setChoosing(true)
      case 'controls':
        return setCollapsed(!collapsed)
      default:
        setCollapsed(false)
        selectWorkflow(id)
    }
  }
  const states = {
    blocks: { pressed: workflow === 'blocks' },
    landscape: { pressed: workflow === 'landscape' },
    review: { pressed: workflow === 'review' },
    controls: { pressed: !collapsed },
    open: { disabled: busy },
    export: { disabled: busy },
  }
  const heading = (
    <div className="flex items-center gap-2">
      <ForestryBackLink />
      <h1 className="text-base font-semibold">Block planning</h1>
    </div>
  )
  return (
    <RibbonPaneHost.Provider value={{ slot, docked, onDockChange: setDocked }}>
      <main
        {...workspaceFrameProps(active)}
        className="lp-workspace relative flex h-full min-h-0 flex-col overflow-hidden bg-background pt-16 md:pt-1"
      >
        {ribbon.toolbar ? (
          <WorkspaceTools
            toolbar={ribbon.toolbar}
            disabled={false}
            states={states}
            onCommand={command}
            widgets={{}}
            leading={heading}
            groupName={groupName}
            folded={folded}
            minimized={minimized}
            onToggleFold={toggleFold}
            onToggleMinimized={toggleMinimized}
            onGroupChange={selectGroup}
            onReorderTabs={ribbon.reorderTabs}
            editorsAvailable
            editorHost={editorHost}
            editorMount={inRibbon ? attachEditor : undefined}
            narrowMenu={['chooseInterface']}
          />
        ) : (
          <WorkspaceHeader
            heading={heading}
            projectInfo="Block planning"
            tools={
              active.headerTools ?? ['controls', 'blocks', 'landscape', 'review', 'open', 'export', 'chooseInterface']
            }
            states={states}
            presentations={{}}
            widgets={{}}
            onCommand={command}
          />
        )}
        {fallback && <p role="status">Using the built-in guided layout.</p>}
        {choosing && (
          <InterfaceChooser
            layouts={layouts}
            current={active}
            onCancel={() => setChoosing(false)}
            onChoose={(next) => {
              selectLayout(next)
              setChoosing(false)
            }}
          />
        )}
        <fieldset disabled={busy} className="lp-canvas-frame min-h-0 min-w-0 flex-1">
          <RibbonPaneColumns
            viewsLabel="planning map"
            docked={docked}
            storageKey={'pgmaps-block-planning-pane-' + active.id}
            slotRef={setSlot}
          >
            <div className="flex h-full min-h-0 w-full flex-col gap-2 overflow-y-auto md:flex-row md:overflow-hidden">
              {!inRibbon && !collapsed && (
                <aside
                  aria-label="Planning editor"
                  className="w-full shrink-0 border-r p-3 md:w-[min(34vw,30rem)] md:overflow-auto"
                  ref={attachEditor}
                />
              )}
              <section aria-label="Plan map and projections" className="min-w-0 flex-1 p-3 md:overflow-auto">
                {children}
              </section>
            </div>
          </RibbonPaneColumns>
        </fieldset>
        {createPortal(<div className="space-y-3">{editors[workflow]}</div>, editorHost)}
      </main>
    </RibbonPaneHost.Provider>
  )
}
