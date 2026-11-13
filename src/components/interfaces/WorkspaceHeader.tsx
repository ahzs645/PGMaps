import { Fragment, type ReactNode } from 'react'
import { CommandButton, type CommandPresentation } from './CommandButton'
import { CommandMenu } from './CommandMenu'
import { isWorkspaceCommand, resolveCommand, type CommandState, type WorkspaceCommand } from './workspaceCommands'
import type { WorkspaceWidget } from './workspaceLayouts'
import { Ellipsis } from 'lucide-react'
import { ToolbarPopover } from '@/components/ui/toolbar-popover'
import { cn } from '@/lib/utils'

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
  'detachedPanels',
  'branding',
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
  branding: 'branding',
}

const MOBILE_HEADER_TOOLS = new Set<HeaderTool>(['controls', 'presets', 'export', 'detachedPanels'])

/**
 * A header bar renderer. It owns no commands: labels and icons come from the registry, behaviour
 * and state from the workspace, and widgets are the same nodes the ribbon places.
 */
export function WorkspaceHeader({
  brand,
  heading,
  status,
  roadSwitcher,
  help,
  projectInfo,
  tools,
  widgets,
  states,
  presentations,
  disabled,
  onCommand,
}: {
  /**
   * With a brand the header is two lines from the tablet width up, the brand alone in its own column
   * beside both: `heading` and the road switcher on the first; the buttons and `status` on the second. Below it the phone line is unchanged.
   * The heading's desktop block places itself in the first line's second column (`md:col-start-2`).
   */
  brand?: ReactNode
  heading: ReactNode
  /** The save line and warnings, at the end of the second line. Hidden on a phone, where `projectInfo` carries it. */
  status?: ReactNode
  /** Kept on the header's line: a row of its own would fold the charts' legends. */
  roadSwitcher?: ReactNode
  help?: ReactNode
  /** Project name and save feedback inside the phone's More panel. */
  projectInfo?: ReactNode
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
  const twoLines = Boolean(brand)
  return (
    <header
      className={cn(
        'road-workspace-header flex shrink-0 flex-wrap items-center justify-between gap-2',
        // The brand spans both lines. Line 1: heading · switcher · help. Line 2: buttons under the heading, status at the end.
        twoLines && 'md:grid md:grid-cols-[auto_1fr_auto_auto] md:gap-x-3 md:gap-y-1',
      )}
      data-testid="road-workspace-header"
      data-lines={twoLines ? 2 : undefined}
    >
      {/* The brand has its column to itself, across both lines: nothing sits under it. */}
      {brand && (
        <div className="road-workspace-brand hidden items-center md:col-start-1 md:row-span-2 md:row-start-1 md:flex">
          {brand}
        </div>
      )}
      {heading}
      {twoLines
        ? roadSwitcher && (
            <div className="contents md:col-start-3 md:row-start-1 md:flex md:min-w-0">{roadSwitcher}</div>
          )
        : roadSwitcher}
      <span className={twoLines ? 'hidden md:col-start-4 md:row-start-1 md:flex' : 'hidden md:contents'}>{help}</span>
      {status && (
        <div className="hidden min-w-0 justify-end md:col-span-2 md:col-start-3 md:row-start-2 md:flex">{status}</div>
      )}
      <div
        className={cn(
          'road-workspace-header-tools flex items-center gap-1',
          twoLines && 'md:col-start-2 md:row-start-2 md:justify-self-start',
        )}
      >
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
          return !MOBILE_HEADER_TOOLS.has(tool) || HEADER_OVERFLOW[tool] ? (
            <span key={tool} className={HEADER_OVERFLOW[tool] ? 'hidden lg:contents' : 'hidden md:contents'}>
              {node}
            </span>
          ) : (
            <Fragment key={tool}>{node}</Fragment>
          )
        })}
        <div className="md:hidden">
          <ToolbarPopover
            label="More workspace commands"
            icon={<Ellipsis className="size-4" />}
            align="end"
            width={280}
            buttonClassName="size-10"
          >
            {(close) => (
              <div className="grid gap-1 p-2">
                {projectInfo && <div className="min-w-0 border-b pb-2">{projectInfo}</div>}
                {tools
                  .filter((tool) => !MOBILE_HEADER_TOOLS.has(tool) && !(projectInfo && tool === 'saveState'))
                  .map((tool) =>
                    isWorkspaceCommand(tool) || tool === 'interfaceSwitch' ? (
                      <CommandButton
                        key={tool}
                        id={tool === 'interfaceSwitch' ? 'chooseInterface' : tool}
                        surface="sidebar"
                        state={states[tool === 'interfaceSwitch' ? 'chooseInterface' : tool]}
                        disabled={disabled}
                        onRun={(id) => {
                          close()
                          onCommand(id)
                        }}
                      />
                    ) : widgets[tool] ? (
                      <div key={tool} className="flex items-center gap-2 text-xs">
                        {widgets[tool]}
                        {tool === 'history' && <span>Edit history and checkpoints</span>}
                      </div>
                    ) : null,
                  )}
                {help && (
                  <div className="flex items-center gap-2 border-t pt-1 text-xs">
                    {help}
                    <span>Workflow help</span>
                  </div>
                )}
              </div>
            )}
          </ToolbarPopover>
        </div>
        {overflow.length > 0 && (
          <span className="hidden md:max-lg:contents">
            <CommandMenu commands={overflow} states={states} disabled={disabled} onCommand={onCommand} />
          </span>
        )}
      </div>
    </header>
  )
}
