import { Fragment, type ReactNode } from 'react'
import { CommandButton, type CommandPresentation } from './CommandButton'
import {
  DEFAULT_HEADER_GROUPS,
  isCommandIn,
  resolveCommandIn,
  useWorkspaceKit,
  type CommandState,
  type HeaderGroup,
} from './workspaceKit'
import { ChevronRight, Ellipsis } from 'lucide-react'
import { ToolbarPopover } from '@/components/ui/toolbar-popover'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import './workspaceHeader.css'

/**
 * Where a tool sits from the tablet width up comes from the kit (`DEFAULT_HEADER_GROUPS`, then the
 * kit's `headerGroups`). The project line ends with the `file` group; the toolbar strip holds
 * `panel`, `edit`, `view` and `start` from its left edge, the save `state` with the notices in its
 * middle and `workspace` at its right. A tool not listed (a field, a widget a layout adds) joins
 * the strip after `start`, in a group of its own.
 */
const STRIP_GROUPS: readonly HeaderGroup[] = ['panel', 'edit', 'view', 'start', 'more']

/** The phone's one line keeps these as buttons, in this order, unless the kit names its own. */
const PHONE_HEADER_TOOLS: readonly string[] = ['presets', 'detachedPanels', 'controls', 'export']

interface WorkspaceHeaderProps<C extends string, W extends string> {
  /** The brand has its own column beside both lines from the tablet width up. */
  brand?: ReactNode
  /** The way back and the project's name; on a phone, the brand that stands in for them. */
  heading: ReactNode
  /** The save line and notices, in the toolbar strip's free middle. Hidden on a phone, where `projectInfo` carries it. */
  status?: ReactNode
  /** Warnings about the project that earn header space (terrain basis, incomplete sections), before the file buttons. */
  flags?: ReactNode
  /**
   * The next step of the project line's path, after a chevron (the road switcher). Kept on the
   * header's line: a row of its own would fold the charts' legends.
   */
  crumb?: ReactNode
  help?: ReactNode
  /** Project name and save feedback inside the phone's More panel. */
  projectInfo?: ReactNode
  tools: readonly (C | W)[]
  widgets: Partial<Record<W, ReactNode>>
  states: Partial<Record<C, CommandState>>
  presentations: Partial<Record<C, CommandPresentation>>
  disabled?: boolean
  onCommand: (id: C) => void
}

/**
 * A header bar renderer. It owns no commands: labels and icons come from the registry, behaviour
 * and state from the workspace, and widgets are the same nodes the ribbon places.
 *
 * From the tablet width up it is two lines beside the brand. The project line reads as a path:
 * the way back, the project's name, then the item being viewed; it ends with the project's
 * warnings and the file buttons, the one filled button among them. Under it one toolbar strip
 * holds every other tool in groups, so a dozen buttons read as four, with the notices and the
 * save line in the room between them. A phone keeps its single icon row.
 */
export function WorkspaceHeader<C extends string, W extends string>(props: WorkspaceHeaderProps<C, W>) {
  const desktop = useMediaQuery('(min-width: 768px)')
  return desktop ? <DesktopHeader {...props} /> : <PhoneHeader {...props} />
}

function DesktopHeader<C extends string, W extends string>({
  brand,
  heading,
  status,
  flags,
  crumb,
  help,
  tools,
  widgets,
  states,
  presentations,
  disabled,
  onCommand,
}: WorkspaceHeaderProps<C, W>) {
  type T = C | W
  const kit = useWorkspaceKit()
  const isWorkspaceCommand = (tool: T): tool is C => isCommandIn(kit.commands, tool)
  const widgetOf = (tool: T) => widgets[tool as W]
  const groupOf = (tool: string) => kit.headerGroups?.[tool] ?? DEFAULT_HEADER_GROUPS[tool] ?? 'more'
  // A hidden command or an absent widget takes no place, so a group of them draws no divider.
  const present = (tool: T) =>
    isWorkspaceCommand(tool) ? !resolveCommandIn(kit.commands, tool, states[tool]).hidden : Boolean(widgetOf(tool))
  const inGroup = (group: HeaderGroup) => tools.filter((tool) => groupOf(tool) === group && present(tool))
  const render = (tool: T) =>
    isWorkspaceCommand(tool) ? (
      <CommandButton
        key={tool}
        id={tool}
        surface="toolbar"
        state={states[tool]}
        disabled={disabled}
        presentation={presentations[tool]}
        onRun={onCommand}
      />
    ) : (
      <Fragment key={tool}>{widgetOf(tool)}</Fragment>
    )
  const file = inGroup('file')
  const workspace = inGroup('workspace')
  return (
    <header className="road-workspace-header" data-testid="road-workspace-header" data-lines="2">
      {/* The brand has its column to itself, across both lines: nothing sits under it. */}
      {brand && <div className="road-workspace-brand">{brand}</div>}
      <div className="road-header-project">
        {heading}
        {crumb && (
          <>
            <ChevronRight className="road-header-crumb" aria-hidden="true" />
            {crumb}
          </>
        )}
        <div className="road-header-flags">{flags}</div>
        {file.length > 0 && (
          <div className="road-header-file" data-header-group="file">
            {file.map(render)}
          </div>
        )}
      </div>
      <div className="road-header-strip">
        {STRIP_GROUPS.map((group) => {
          const members = inGroup(group)
          return (
            members.length > 0 && (
              <div key={group} className="road-header-group" data-header-group={group}>
                {members.map(render)}
              </div>
            )
          )
        })}
        {/* The strip's free middle is its message area: a notice, else where the project is saved. */}
        <div className="road-header-message road-workspace-status-row">
          {inGroup('state').map(render)}
          {status}
        </div>
        {(workspace.length > 0 || help) && (
          <div className="road-header-group road-header-group-end" data-header-group="workspace">
            {workspace.map(render)}
            {help}
          </div>
        )}
      </div>
    </header>
  )
}

/** One icon row: the brand or the road switcher, four buttons, and More for everything else. */
function PhoneHeader<C extends string, W extends string>({
  heading,
  status,
  crumb,
  help,
  projectInfo,
  tools,
  widgets,
  states,
  presentations,
  disabled,
  onCommand,
}: WorkspaceHeaderProps<C, W>) {
  type T = C | W
  const kit = useWorkspaceKit()
  const isWorkspaceCommand = (tool: T): tool is C => isCommandIn(kit.commands, tool)
  const widgetOf = (tool: T) => widgets[tool as W]
  const phoneTools = kit.phoneHeaderTools ?? PHONE_HEADER_TOOLS
  const onLine = phoneTools.filter((tool) => tools.includes(tool as T)) as T[]
  // The interface switch widget becomes its registry command in the More panel's list.
  const asCommand = (tool: T): T => (tool === 'interfaceSwitch' ? ('chooseInterface' as T) : tool)
  return (
    <header
      className="road-workspace-header flex shrink-0 flex-wrap items-center justify-between gap-2"
      data-testid="road-workspace-header"
    >
      {heading}
      {crumb}
      {/* Not shown, but still announced: a notice reaches a screen reader on a phone too. */}
      {status && <div className="hidden">{status}</div>}
      <div className="road-workspace-header-tools flex items-center gap-1">
        {onLine.map((tool) =>
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
            <Fragment key={tool}>{widgetOf(tool)}</Fragment>
          ),
        )}
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
                .filter((tool) => !phoneTools.includes(tool) && !(projectInfo && tool === 'saveState'))
                .map((tool) => {
                  const command = asCommand(tool)
                  return isWorkspaceCommand(command) ? (
                    <CommandButton
                      key={tool}
                      id={command}
                      surface="sidebar"
                      state={states[command]}
                      disabled={disabled}
                      // The header's accessible name ("Undo road edit") carries over; its sizing does not.
                      presentation={
                        presentations[command]?.ariaLabel ? { ariaLabel: presentations[command].ariaLabel } : undefined
                      }
                      onRun={(id) => {
                        close()
                        onCommand(id)
                      }}
                    />
                  ) : widgetOf(tool) ? (
                    <div key={tool} className="flex items-center gap-2 text-xs">
                      {widgetOf(tool)}
                      {tool === 'history' && <span>Edit history and checkpoints</span>}
                    </div>
                  ) : null
                })}
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
    </header>
  )
}
