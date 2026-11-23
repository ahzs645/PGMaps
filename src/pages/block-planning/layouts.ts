import { Download, FolderOpen, LayoutTemplate, PanelsTopLeft, Scale, SquareDashed, Trees } from 'lucide-react'
import { interfacePreferences } from '@/components/interfaces/interfacePreference'
import { loadLayoutCatalog } from '@/components/interfaces/layoutCatalog'
import { layoutIconIds, type WorkspaceKit } from '@/components/interfaces/workspaceKit'
import { parseLayout, parseWorkspaceLayouts } from '@/components/interfaces/workspaceLayoutSchema'

export const commands = {
  open: { label: 'Open plan', icon: FolderOpen },
  export: { label: 'Save plan', icon: Download },
  blocks: { label: 'Blocks', icon: SquareDashed },
  landscape: { label: 'Landscape', icon: Trees },
  review: { label: 'Legal review', icon: Scale },
  chooseInterface: { label: 'Switch interface', icon: LayoutTemplate },
  controls: { label: 'Planning controls', icon: PanelsTopLeft },
}
export type Command = keyof typeof commands
export const editors = ['blocks', 'landscape', 'review'] as const
export type Editor = (typeof editors)[number]
export const vocabulary = {
  icons: layoutIconIds,
  commands: Object.keys(commands) as Command[],
  widgets: [] as string[],
  editors,
  presets: ['plan'],
  collections: {},
}
export const kit: WorkspaceKit = {
  storage: 'block-planning',
  commands,
  widgetLabels: {},
  headerGroups: { blocks: 'edit', landscape: 'view', review: 'state', chooseInterface: 'workspace' },
  phoneHeaderTools: ['controls', 'export', 'chooseInterface'],
}
export const preferences = interfacePreferences(kit.storage, 'guided')
const recovery = parseLayout(
  { id: 'guided', name: 'Guided mode', description: 'Edit blocks beside the planning map.', icon: 'panels' },
  vocabulary,
)
export const loadLayouts = (signal: AbortSignal) =>
  loadLayoutCatalog({
    file: 'block-planning-layouts.json',
    parse: (value) => parseWorkspaceLayouts(value, vocabulary),
    recovery,
    recoveryName: recovery.name,
    signal,
  })
export type Layout = typeof recovery
