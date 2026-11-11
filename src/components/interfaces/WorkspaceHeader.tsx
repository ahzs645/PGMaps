import { Fragment, type ReactNode } from 'react'
import { CommandButton, type CommandPresentation } from './CommandButton'
import { isWorkspaceCommand, type CommandState, type WorkspaceCommand } from './workspaceCommands'
import type { WorkspaceWidget } from './workspaceLayouts'

export type HeaderTool = WorkspaceCommand | WorkspaceWidget

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
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2" data-testid="road-workspace-header">
      {heading}
      {roadSwitcher}
      <div className="flex flex-wrap items-center gap-1">
        {tools.map((tool) =>
          isWorkspaceCommand(tool) ? (
            <CommandButton
              key={tool}
              id={tool}
              surface="header"
              state={states[tool]}
              disabled={disabled}
              presentation={presentations[tool]}
              onRun={onCommand}
            />
          ) : (
            <Fragment key={tool}>{widgets[tool]}</Fragment>
          ),
        )}
      </div>
    </header>
  )
}
