/**
 * The shared interface kit: what a tool hands the ribbon, the workspace header, the interface
 * chooser and their helpers so they can draw its commands. Guide: `docs/workspace-interfaces.md`.
 *
 * A tool defines its commands once (a `CommandRegistry`), arranges them in a layout file read by
 * `workspaceLayoutSchema.ts`, and wraps its workspace in `WorkspaceKitProvider` with this object.
 * Every renderer here reads labels, icons, captions and anchors from the kit, so nothing in
 * `src/components/interfaces/` names one tool's commands. The road designer's kit is
 * `src/pages/dev-forestry-roads/interface/roadKit.tsx`; visual quality's is
 * `src/pages/dev-forestry/interface/visualsKit.tsx`.
 */
import { createContext, useContext, type ReactNode } from 'react'
import {
  Compass,
  LayoutDashboard,
  Map as MapIcon,
  PanelsLeftBottom,
  PanelsTopLeft,
  Route,
  Ruler,
  type LucideIcon,
} from 'lucide-react'

/**
 * One command, defined once. Layouts arrange command IDs; every renderer reads the label, icon and
 * kind from here, and the workspace supplies one handler and one state per ID.
 *
 * - `kind: 'pane'` opens a task pane, so a renderer closes its own open group settings first.
 * - `kind: 'editor'` shows one of the workflow editors; the workspace derives its handler from `editor`.
 * - `investigation: true` keeps the command while the road designer's project is an access
 *   investigation; other tools ignore it.
 */
export interface CommandDef {
  label: string
  icon: LucideIcon
  /** What the command does when its label alone cannot say it; every surface shows it as the tooltip. */
  description?: string
  /**
   * Other captions the workspace's state gives it while you work ("Undo point" while pegging). A
   * ribbon button keeps room for the longest, so a caption change never shifts its neighbours.
   */
  altLabels?: readonly string[]
  kind?: 'pane' | 'editor'
  editor?: string
  investigation?: boolean
}

export type CommandRegistry = Readonly<Record<string, CommandDef>>

/**
 * What the workspace reports for each command at render time. `reason` says why a disabled
 * command cannot run, and `shortcut` names its keys; both join the description in the tooltip.
 */
export type CommandState = {
  disabled?: boolean
  pressed?: boolean
  hidden?: boolean
  label?: string
  reason?: string
  shortcut?: string
}

/** Where a header tool sits from the tablet width up (`WorkspaceHeader`). */
export type HeaderGroup = 'panel' | 'edit' | 'view' | 'start' | 'more' | 'file' | 'workspace' | 'state'

/** The header groups of the tools both tools share by name; a kit adds its own. */
export const DEFAULT_HEADER_GROUPS: Readonly<Record<string, HeaderGroup>> = {
  controls: 'panel',
  undo: 'edit',
  redo: 'edit',
  history: 'edit',
  presets: 'view',
  summarySettings: 'view',
  detachedPanels: 'view',
  saveState: 'state',
  projects: 'file',
  open: 'file',
  export: 'file',
  interfaceSwitch: 'workspace',
  branding: 'workspace',
  fullscreen: 'workspace',
}

/** The icons a layout entry may name for itself and its tabs (`icon` in a layout file). */
export const layoutIcons = {
  compass: Compass,
  dashboard: LayoutDashboard,
  map: MapIcon,
  panels: PanelsLeftBottom,
  ribbon: PanelsTopLeft,
  route: Route,
  ruler: Ruler,
} satisfies Record<string, LucideIcon>
export type LayoutIcon = keyof typeof layoutIcons
export const layoutIconIds = Object.keys(layoutIcons) as LayoutIcon[]

export interface WorkspaceKit {
  /** Names this tool's browser storage: `pgmaps-<storage>-ribbon-order:<layout>` and the like. */
  storage: string
  commands: CommandRegistry
  /** The caption of each widget a layout can place (fields included), for Find tools and Customize ribbon. */
  widgetLabels: Readonly<Record<string, string>>
  /** Widgets drawn as a ribbon field: one live input, mirrored inert while the tab's editor is open. */
  quickFields?: ReadonlySet<string>
  /** The tool's mark, shown at the head of a ribbon with `header: "controls"` and in the chooser. */
  brand?: { full: ReactNode; compact: ReactNode }
  /** Lesson anchors (`data-tutorial-id`); a tool without live lessons leaves them out. */
  anchors?: {
    command?: (id: string) => string | undefined
    workflow?: (editor: string) => string | undefined
    interfaceOption?: (layoutId: string) => string | undefined
  }
  /** The help an interface's chooser links to; none, no link. */
  helpHref?: (layoutId: string) => string | undefined
  /** Header groups for this tool's own commands and widgets, over `DEFAULT_HEADER_GROUPS`. */
  headerGroups?: Readonly<Record<string, HeaderGroup>>
  /** The phone header's buttons, in order; everything else goes in its More menu. */
  phoneHeaderTools?: readonly string[]
}

const WorkspaceKitContext = createContext<WorkspaceKit | null>(null)

export function WorkspaceKitProvider({ kit, children }: { kit: WorkspaceKit; children: ReactNode }) {
  return <WorkspaceKitContext.Provider value={kit}>{children}</WorkspaceKitContext.Provider>
}

export function useWorkspaceKit(): WorkspaceKit {
  const kit = useContext(WorkspaceKitContext)
  if (!kit) throw new Error('A workspace interface needs a WorkspaceKitProvider round it.')
  return kit
}

export const isCommandIn = (commands: CommandRegistry, id: string) => Object.prototype.hasOwnProperty.call(commands, id)

/** The label, icon and availability a renderer shows for one command, from the definition and its state. */
export function resolveCommandIn<C extends string>(
  commands: CommandRegistry,
  id: C,
  state: CommandState | undefined,
  disabled = false,
) {
  const def = commands[id]
  if (!def) throw new Error(`No command "${id}" in this workspace.`)
  const off = state?.disabled ?? disabled
  return {
    id,
    label: state?.label ?? def.label,
    icon: def.icon,
    kind: def.kind,
    disabled: off,
    pressed: state?.pressed,
    hidden: !!state?.hidden,
    description: def.description,
    // Every caption this command can show, so a renderer can keep room for the longest.
    captions: [def.label, ...(def.altLabels ?? [])],
    shortcut: state?.shortcut,
    reason: off ? state?.reason : undefined,
  }
}
export type ResolvedCommand = ReturnType<typeof resolveCommandIn>

/**
 * The tooltip every surface gives a command: its label (where the label is not shown, or may be
 * cut short), what it does, its keys, and why it is unavailable.
 */
export function commandTooltip(command: ResolvedCommand, withLabel = true) {
  const keys = command.shortcut ? ` (${command.shortcut})` : ''
  return [withLabel ? `${command.label}${keys}` : keys.trim(), command.description, command.reason]
    .filter(Boolean)
    .join('\n')
}

/** The caption Find tools and Customize ribbon give a command or widget. */
export function toolLabelIn(kit: WorkspaceKit, id: string) {
  return isCommandIn(kit.commands, id) ? kit.commands[id].label : (kit.widgetLabels[id] ?? id)
}
