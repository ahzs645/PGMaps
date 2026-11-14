import { Fragment, type ReactNode } from 'react'
import { CommandButton, type CommandPresentation } from './CommandButton'
import { isWorkspaceCommand, resolveCommand, type CommandState, type WorkspaceCommand } from './workspaceCommands'
import type { WorkspaceWidget } from './workspaceLayouts'
import { ChevronRight, Ellipsis } from 'lucide-react'
import { ToolbarPopover } from '@/components/ui/toolbar-popover'
import { useMediaQuery } from '@/hooks/useMediaQuery'

type HeaderTool = WorkspaceCommand | WorkspaceWidget

/**
 * The header's tools when a layout names none. A layout can choose its own with `headerTools`
 * (see `docs/forestry-road-design/workspace-layouts.md`); the header places each tool in its
 * group, and the list's order is the order inside a group.
 */
export const DEFAULT_HEADER_TOOLS: HeaderTool[] = [
  'controls',
  'undo',
  'redo',
  'history',
  'presets',
  'summarySettings',
  'detachedPanels',
  'startDesign',
  'loadMapped',
  'saveState',
  'projects',
  'open',
  'export',
  'interfaceSwitch',
  'branding',
  'fullscreen',
]

/**
 * Where a tool sits from the tablet width up. The project line ends with the `file` group; the
 * toolbar strip holds `panel`, `edit`, `view` and `start` from its left edge, the save `state`
 * with the notices in its middle and `workspace` at its right. A tool not listed here (a field,
 * a widget a layout adds) joins the strip after `start`, in a group of its own.
 */
type HeaderGroup = 'panel' | 'edit' | 'view' | 'start' | 'more' | 'file' | 'workspace' | 'state'
const HEADER_GROUP: Partial<Record<HeaderTool, HeaderGroup>> = {
  controls: 'panel',
  undo: 'edit',
  redo: 'edit',
  history: 'edit',
  presets: 'view',
  summarySettings: 'view',
  detachedPanels: 'view',
  startDesign: 'start',
  loadMapped: 'start',
  saveState: 'state',
  projects: 'file',
  open: 'file',
  export: 'file',
  interfaceSwitch: 'workspace',
  branding: 'workspace',
  fullscreen: 'workspace',
}
const STRIP_GROUPS: readonly HeaderGroup[] = ['panel', 'edit', 'view', 'start', 'more']

/** The phone's one line keeps these four as buttons, in this order; everything else is in More. */
const PHONE_HEADER_TOOLS: readonly HeaderTool[] = ['presets', 'detachedPanels', 'controls', 'export']

interface WorkspaceHeaderProps {
  /** The brand has its own column beside both lines from the tablet width up. */
  brand?: ReactNode
  /** The way back and the project's name; on a phone, the brand that stands in for them. */
  heading: ReactNode
  /** The save line and notices, in the toolbar strip's free middle. Hidden on a phone, where `projectInfo` carries it. */
  status?: ReactNode
  /** Warnings about the project that earn header space (terrain basis, incomplete sections), before the file buttons. */
  flags?: ReactNode
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
}

/**
 * A header bar renderer. It owns no commands: labels and icons come from the registry, behaviour
 * and state from the workspace, and widgets are the same nodes the ribbon places.
 *
 * From the tablet width up it is two lines beside the brand. The project line reads as a path:
 * the way back, the project's name, then the road being viewed; it ends with the project's
 * warnings and the file buttons, the one filled button among them. Under it one toolbar strip
 * holds every other tool in groups, so a dozen buttons read as four, with the notices and the
 * save line in the room between them. A phone keeps its single icon row.
 */
export function WorkspaceHeader(props: WorkspaceHeaderProps) {
  const desktop = useMediaQuery('(min-width: 768px)')
  return desktop ? <DesktopHeader {...props} /> : <PhoneHeader {...props} />
}

function DesktopHeader({
  brand,
  heading,
  status,
  flags,
  roadSwitcher,
  help,
  tools,
  widgets,
  states,
  presentations,
  disabled,
  onCommand,
}: WorkspaceHeaderProps) {
  // A hidden command or an absent widget takes no place, so a group of them draws no divider.
  const present = (tool: HeaderTool) =>
    isWorkspaceCommand(tool) ? !resolveCommand(tool, states[tool]).hidden : Boolean(widgets[tool])
  const inGroup = (group: HeaderGroup) =>
    tools.filter((tool) => (HEADER_GROUP[tool] ?? 'more') === group && present(tool))
  const render = (tool: HeaderTool) =>
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
      <Fragment key={tool}>{widgets[tool]}</Fragment>
    )
  const file = inGroup('file')
  const workspace = inGroup('workspace')
  return (
    <header className="road-workspace-header" data-testid="road-workspace-header" data-lines="2">
      {/* The brand has its column to itself, across both lines: nothing sits under it. */}
      {brand && <div className="road-workspace-brand">{brand}</div>}
      <div className="road-header-project">
        {heading}
        {roadSwitcher && (
          <>
            <ChevronRight className="road-header-crumb" aria-hidden="true" />
            {roadSwitcher}
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
function PhoneHeader({
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
}: WorkspaceHeaderProps) {
  const onLine = PHONE_HEADER_TOOLS.filter((tool) => tools.includes(tool))
  return (
    <header
      className="road-workspace-header flex shrink-0 flex-wrap items-center justify-between gap-2"
      data-testid="road-workspace-header"
    >
      {heading}
      {roadSwitcher}
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
            <Fragment key={tool}>{widgets[tool]}</Fragment>
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
                .filter((tool) => !PHONE_HEADER_TOOLS.includes(tool) && !(projectInfo && tool === 'saveState'))
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
    </header>
  )
}
