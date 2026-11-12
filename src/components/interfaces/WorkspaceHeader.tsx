import { Fragment, type ReactNode } from 'react'
import { CommandButton, type CommandPresentation } from './CommandButton'
import { CommandMenu } from './CommandMenu'
import { isWorkspaceCommand, resolveCommand, type CommandState, type WorkspaceCommand } from './workspaceCommands'
import type { WorkspaceWidget } from './workspaceLayouts'

type HeaderTool = WorkspaceCommand | WorkspaceWidget

/**
 * The header's tools when a layout names none: the workbench's original line. A layout can
 * rearrange them with `headerTools` (see `docs/forestry-road-design/workspace-layouts.md`).
 */
export const DEFAULT_HEADER_TOOLS: HeaderTool[] = [
  'interfaceSwitch',
  'startDesign',
  'history',
  'loadMapped',
  'summarySettings',
  'presets',
  'saveState',
  'controls',
  'undo',
  'redo',
  'projects',
  'open',
  'export',
  'fullscreen',
]

/**
 * Tools that fold into the header's More menu between 768 and 1023 px, where the line holding
 * the title, the road switcher and every button would otherwise wrap to two. Each maps to the
 * registry command the menu runs; the interface switch is a widget on the line and a command there.
 */
const HEADER_OVERFLOW: Partial<Record<HeaderTool, WorkspaceCommand>> = {
  interfaceSwitch: 'chooseInterface',
  summarySettings: 'summarySettings',
  projects: 'projects',
  fullscreen: 'fullscreen',
}

/**
 * A header bar renderer. It owns no commands: labels and icons come from the registry, behaviour
 * and state from the workspace, and widgets are the same nodes the ribbon places.
 */
export function WorkspaceHeader({
  heading,
  roadSwitcher,
  tools,
  widgets,
  states,
  presentations,
  disabled,
  onCommand,
}: {
  heading: ReactNode
  /** Kept on the header's line: a row of its own would fold the charts' legends. */
  roadSwitcher?: ReactNode
  tools: readonly HeaderTool[]
  widgets: Partial<Record<WorkspaceWidget, ReactNode>>
  states: Partial<Record<WorkspaceCommand, CommandState>>
  presentations: Partial<Record<WorkspaceCommand, CommandPresentation>>
  disabled?: boolean
  onCommand: (id: WorkspaceCommand) => void
}) {
  const overflow = tools.flatMap((tool) => {
    const id = HEADER_OVERFLOW[tool]
    return id && !resolveCommand(id, states[id]).hidden && (isWorkspaceCommand(tool) || widgets[tool]) ? [id] : []
  })
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2" data-testid="road-workspace-header">
      {heading}
      {roadSwitcher}
      <div className="flex flex-wrap items-center gap-1">
        {tools.map((tool) => {
          const node = isWorkspaceCommand(tool) ? (
            <CommandButton
              id={tool}
              surface="header"
              state={states[tool]}
              disabled={disabled}
              presentation={presentations[tool]}
              onRun={onCommand}
            />
          ) : (
            widgets[tool]
          )
          return HEADER_OVERFLOW[tool] ? (
            <span key={tool} className="contents md:max-lg:hidden">
              {node}
            </span>
          ) : (
            <Fragment key={tool}>{node}</Fragment>
          )
        })}
        {overflow.length > 0 && (
          <span className="hidden md:max-lg:contents">
            <CommandMenu commands={overflow} states={states} disabled={disabled} onCommand={onCommand} />
          </span>
        )}
      </div>
    </header>
  )
}
