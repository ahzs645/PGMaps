import { summaryOptions } from '@/pages/dev-forestry-roads/summaryPreferences'
import { ribbonFieldIds } from '@/pages/dev-forestry-roads/roadFieldDefinitions'
import { Compass, Map, PanelsLeftBottom, PanelsTopLeft, Route, Ruler } from 'lucide-react'
import { z } from 'zod'
import { workspaceCommands, type WorkspaceCommand } from './workspaceCommands'

export const layoutIcons = {
  compass: Compass,
  map: Map,
  panels: PanelsLeftBottom,
  ribbon: PanelsTopLeft,
  route: Route,
  ruler: Ruler,
}

const label = z.string().trim().min(1)
const icon = z.custom<keyof typeof layoutIcons>(
  (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(layoutIcons, id),
  'Unknown layout icon',
)
const command = z.custom<WorkspaceCommand>(
  (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(workspaceCommands, id),
  'Unknown workspace command',
)
const widget = z.enum(['projectInfo', 'roadSelector', 'presets', 'terrainSource', ...ribbonFieldIds])
export type WorkspaceWidget = z.infer<typeof widget>
const sectionItems = z.array(z.union([widget, command]))

const editor = z.enum(['terrain', 'design', 'template', 'engineering', 'review'])
export type WorkflowEditor = z.infer<typeof editor>

const group = z
  .strictObject({
    label,
    icon: icon.optional(),
    hint: label.optional(),
    editor: editor.optional(),
    commands: z
      .array(command)
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length, 'Repeated command in group')
      .optional(),
    sections: z
      .array(
        z
          .strictObject({
            label,
            rows: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
            primary: command.optional(),
            items: sectionItems.default([]),
            more: sectionItems.optional(),
          })
          .refine((section) => section.items.length || section.more?.length, 'A section needs at least one tool')
          .refine(
            (section) => !section.primary || section.items.includes(section.primary),
            'The primary command must be in its section',
          ),
      )
      .min(1)
      .optional(),
  })
  .refine(
    (group) => !(group.commands && group.sections) && Boolean(group.editor || group.commands || group.sections),
    'A tab needs an editor, commands or sections; use only one command format',
  )

const toolbar = z
  .strictObject({
    dock: z.enum(['top', 'side']),
    fullWidth: z.boolean().optional(),
    compact: z.boolean().optional(),
    editorPlacement: z.enum(['inline', 'pane']).optional(),
    findTools: z.boolean().optional(),
    minimizeOnShortScreens: z.boolean().optional(),
    quickAccess: z
      .array(command)
      .refine((items) => new Set(items).size === items.length, 'Repeated quick access command')
      .optional(),
    includeProjectHeader: z.boolean().optional(),
    header: z.literal('controls').optional(),
    label,
    tabsLabel: label,
    title: label.optional(),
    startGroup: label.optional(),
    groups: z.array(group).min(1),
  })
  .refine(
    ({ dock, includeProjectHeader, header }) => (!includeProjectHeader && !header) || dock === 'top',
    'The project header uses a top toolbar',
  )
  .refine(({ includeProjectHeader, header }) => !(includeProjectHeader && header), 'Choose one header presentation')
  .refine(({ dock, groups }) => {
    const editors = groups.flatMap((group) => (group.editor ? [group.editor] : []))
    return !editors.length || (dock === 'top' && new Set(editors).size === editors.length)
  }, 'Assign each workflow editor to one tab in a top toolbar')
  .refine(({ groups, startGroup }) => {
    const names = new Set(groups.map((group) => group.label))
    return names.size === groups.length && (!startGroup || names.has(startGroup))
  }, 'Use unique group labels and an existing startGroup')

const layout = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: label,
  shortName: label.optional(),
  description: label,
  icon: icon.default('panels'),
  preview: z
    .string()
    .regex(/^[a-z0-9_-]+\.(webp|png|jpg)$/i)
    .optional(),
  preset: z.enum(['linked', 'split', 'plan', 'engineering', 'pegging']).default('linked'),
  sidebar: z.enum(['open', 'collapsed']).default('open'),
  view: z.enum(['responsive', 'focused']).default('responsive'),
  summary: summaryOptions.optional(),
  panelFrame: z
    .strictObject({
      background: z.enum(['default', 'gray']).optional(),
      grayPercent: z.number().int().min(0).max(100).optional(),
      inset: z.number().int().min(0).max(80).optional(),
      gap: z.number().int().min(0).max(40).optional(),
      resizeCorners: z.boolean().optional(),
    })
    .optional(),
  toolbar: toolbar.optional(),
})
const catalog = z
  .array(layout)
  .min(1)
  .refine((layouts) => new Set(layouts.map((item) => item.id)).size === layouts.length, 'Layout IDs must be unique')
export type WorkspaceLayout = z.infer<typeof layout>
export type WorkspaceToolbar = z.infer<typeof toolbar>

// Keep one usable view even when the editable file is missing or contains invalid JSON.
const recoveryLayout = layout.parse({
  id: 'workbench',
  name: 'Engineering workbench',
  shortName: 'Workbench',
  description: 'Open the road design tools with linked plan, profile and cross-section views.',
  preview: 'workbench.webp',
})

export async function loadWorkspaceLayouts(signal: AbortSignal) {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}workspace-layouts.json`, { cache: 'no-cache', signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return { layouts: catalog.parse(await response.json()), fallback: false }
  } catch (error) {
    if (!signal.aborted) console.warn('Using the built-in engineering workbench.', error)
    return { layouts: [recoveryLayout], fallback: true }
  }
}
