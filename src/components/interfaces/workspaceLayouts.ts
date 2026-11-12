import { ribbonFieldIds } from '@/pages/dev-forestry-roads/roadFieldDefinitions'
import { DEFAULT_INTERFACE_NAME } from './interfacePreference'
import { Compass, LayoutDashboard, Map as MapIcon, PanelsLeftBottom, PanelsTopLeft, Route, Ruler } from 'lucide-react'
import { ribbonExports, workspaceCommandIds, type WorkspaceCommand } from './workspaceCommands'
import {
  parseLayout,
  parseWorkspaceLayouts,
  type LayoutConfig,
  type LayoutToolbar,
  type LayoutVocabulary,
} from './workspaceLayoutSchema'

export type { WorkflowEditor } from './workspaceLayoutSchema'

export const layoutIcons = {
  compass: Compass,
  dashboard: LayoutDashboard,
  map: MapIcon,
  panels: PanelsLeftBottom,
  ribbon: PanelsTopLeft,
  route: Route,
  ruler: Ruler,
}
type LayoutIcon = keyof typeof layoutIcons

/**
 * Controls a layout can place beside commands. The road workspace renders each one once; a
 * ribbon section, the guide or the header only decides where it sits.
 */
export const workspaceWidgets = [
  'projectInfo',
  'roadSelector',
  'presets',
  'terrainSource',
  'terrainDisplay',
  'interfaceSwitch',
  'history',
  'saveState',
  ...ribbonFieldIds,
] as const
export type WorkspaceWidget = (typeof workspaceWidgets)[number]

const vocabulary: LayoutVocabulary<LayoutIcon, WorkspaceCommand, WorkspaceWidget> = {
  icons: Object.keys(layoutIcons) as LayoutIcon[],
  commands: workspaceCommandIds,
  widgets: workspaceWidgets,
}

export type WorkspaceLayout = LayoutConfig<LayoutIcon, WorkspaceCommand, WorkspaceWidget>
export type WorkspaceToolbar = LayoutToolbar<LayoutIcon, WorkspaceCommand, WorkspaceWidget>

export const parseLayoutCatalog = (value: unknown) =>
  parseWorkspaceLayouts(value, vocabulary).map((layout) =>
    layout.toolbar ? { ...layout, toolbar: resolveToolbar(layout.toolbar) } : layout,
  )

/** Hosted placements win. Expand catalog-backed groups before applying personal ribbon preferences. */
export function resolveToolbar(toolbar: WorkspaceToolbar): WorkspaceToolbar {
  const sections = toolbar.groups.flatMap((tab) => tab.sections ?? [])
  if (!sections.some((section) => section.collect)) return toolbar
  const placed = new Set<WorkspaceCommand | WorkspaceWidget>([
    ...toolbar.groups.flatMap((tab) => tab.commands ?? []),
    ...sections.flatMap((section) => [...section.items, ...(section.more ?? [])]),
  ])
  const additions = new Map<(typeof sections)[number], (WorkspaceCommand | WorkspaceWidget)[]>()
  const collect = (source: (WorkspaceCommand | WorkspaceWidget)[], section: (typeof sections)[number]) => {
    const missing = source.filter((id) => !placed.has(id))
    missing.forEach((id) => placed.add(id))
    additions.set(section, missing)
  }
  for (const section of sections) {
    if (section.collect === 'documentExports' || section.collect === 'dataExports') {
      const documents = section.collect === 'documentExports'
      collect(
        ribbonExports.filter((item) => (item.group === 'documents') === documents).map((item) => item.command),
        section,
      )
    }
  }
  for (const section of sections) {
    if (section.collect === 'remainingTools') {
      collect([...workspaceCommandIds, ...workspaceWidgets], section)
    }
  }
  return {
    ...toolbar,
    groups: toolbar.groups.map((tab) => ({
      ...tab,
      sections: tab.sections?.map((section) =>
        additions.has(section) ? { ...section, more: [...(section.more ?? []), ...additions.get(section)!] } : section,
      ),
    })),
  }
}

// Keep one usable view even when the editable file is missing or contains invalid JSON.
const recoveryLayout = parseLayout(
  {
    id: 'workbench',
    name: DEFAULT_INTERFACE_NAME,
    shortName: DEFAULT_INTERFACE_NAME,
    description: 'Open the road design tools with linked plan, profile and cross-section views.',
    preview: 'workbench.webp',
  },
  vocabulary,
)

/**
 * The served catalog is a deploy-time configuration file. The service worker fetches it
 * network-first (`public/sw.js`), so an edited file applies on the next load.
 */
export async function loadWorkspaceLayouts(signal: AbortSignal) {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}workspace-layouts.json`, { cache: 'no-cache', signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return { layouts: parseLayoutCatalog(await response.json()), fallback: false }
  } catch (error) {
    if (!signal.aborted) console.warn('Using the built-in ' + DEFAULT_INTERFACE_NAME + '.', error)
    return { layouts: [recoveryLayout], fallback: true }
  }
}
