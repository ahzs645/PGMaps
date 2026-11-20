/**
 * The layout-file contract (`public/workspace-layouts.json`, `public/visuals-layouts.json`): types
 * and a hand-written parser (house style, see `src/lib/jsonGuards.ts`). No DOM, icon or tool
 * imports: each tool passes the vocabulary of icon, command, widget, editor and preset ids it
 * supports, so this module serves every workspace and is unit-testable on its own. Guides:
 * `docs/workspace-interfaces.md` and `docs/forestry-road-design/workspace-layouts.md`.
 */
import {
  bool,
  distinct,
  int,
  list,
  object,
  oneOf,
  optional,
  strictObject,
  text,
  type JsonObject,
} from '@/lib/jsonGuards'
import { parsePanelWindowLayouts, type PanelWindowLayout } from '@pgmaps/geo-toolkit/ui/panel-window-layout'

const SUMMARY_LEVELS = ['hidden', 'value', 'detailed'] as const
export type SummaryLevel = (typeof SUMMARY_LEVELS)[number]
const SUMMARY_PLACEMENTS = ['left', 'top'] as const
/** Wording of the note on curve-corrected volumes. It is never hidden: every volume says how it was measured. */
const CURVE_NOTES = ['full', 'short'] as const

/** Per-interface defaults for the measurement stack; browser preferences override them. */
export interface SummaryOptions {
  visible?: boolean
  placement?: (typeof SUMMARY_PLACEMENTS)[number]
  metrics?: Record<string, SummaryLevel>
  curveNote?: (typeof CURVE_NOTES)[number]
}

export interface LayoutVocabulary<
  I extends string,
  C extends string,
  W extends string,
  E extends string = string,
  P extends string = string,
> {
  icons: readonly I[]
  commands: readonly C[]
  widgets: readonly W[]
  /** The workflow editors a ribbon tab can host (`editor`). */
  editors: readonly E[]
  /** The screen presets an interface can start on (`preset`); the first is the default. */
  presets: readonly P[]
  /** Named tool lists a ribbon section can `collect`; `remainingTools` is always available. */
  collections?: Readonly<Record<string, readonly (C | W)[]>>
  panels?: readonly string[]
}

/** The tool list every vocabulary offers: whatever no other place in the toolbar holds. */
export const REMAINING_TOOLS = 'remainingTools'

interface LayoutSection<C extends string = string, W extends string = string> {
  label: string
  rows?: 1 | 2 | 3
  /** A tool list from the vocabulary's `collections`, or `remainingTools`, added to `more`. */
  collect?: string
  primary?: C
  items: (C | W)[]
  more?: (C | W)[]
}

interface LayoutGroup<
  I extends string = string,
  C extends string = string,
  W extends string = string,
  E extends string = string,
> {
  label: string
  icon?: I
  hint?: string
  editor?: E
  commands?: C[]
  sections?: LayoutSection<C, W>[]
}

export interface LayoutToolbar<
  I extends string = string,
  C extends string = string,
  W extends string = string,
  E extends string = string,
> {
  dock: 'top' | 'side'
  fullWidth?: boolean
  compact?: boolean
  editorPlacement?: 'inline' | 'pane'
  findTools?: boolean
  minimizeOnShortScreens?: boolean
  quickAccess?: C[]
  /** Commands and widgets beside the tabs, independent of the selected tab. */
  tabTools?: (C | W)[]
  includeProjectHeader?: boolean
  header?: 'controls'
  label: string
  tabsLabel: string
  title?: string
  startGroup?: string
  groups: LayoutGroup<I, C, W, E>[]
}

interface PanelFrame {
  background?: 'default' | 'gray' | 'white'
  grayPercent?: number
  inset?: number
  gap?: number
  resizeCorners?: boolean
}

export interface LayoutConfig<
  I extends string = string,
  C extends string = string,
  W extends string = string,
  E extends string = string,
  P extends string = string,
> {
  id: string
  name: string
  shortName?: string
  description: string
  icon: I
  preview?: string
  preset: P
  sidebar: 'open' | 'collapsed'
  view: 'responsive' | 'focused'
  summary?: SummaryOptions
  panelFrame?: PanelFrame
  toolbar?: LayoutToolbar<I, C, W, E>
  /** Commands and widgets on the header line, in order. Absent: the workspace's default line. */
  headerTools?: (C | W)[]
  /** Optional separate-window/tab defaults, restored through the host's panel manager. */
  panelWindows?: PanelWindowLayout[]
}

/** Parse summary options from a layout entry or browser storage. Unknown keys are refused. */
export function parseSummaryOptions(value: unknown, label = 'Summary'): SummaryOptions {
  const source = strictObject(value, label, ['visible', 'placement', 'metrics', 'curveNote'])
  const metrics = optional(source, 'metrics', (raw) =>
    Object.fromEntries(
      Object.entries(object(raw, `${label} metrics`)).map(([key, level]) => [
        key,
        oneOf(level, `${label} metric ${key}`, SUMMARY_LEVELS),
      ]),
    ),
  )
  return compact({
    visible: optional(source, 'visible', (v) => bool(v, `${label} visible`)),
    placement: optional(source, 'placement', (v) => oneOf(v, `${label} placement`, SUMMARY_PLACEMENTS)),
    metrics,
    curveNote: optional(source, 'curveNote', (v) => oneOf(v, `${label} curveNote`, CURVE_NOTES)),
  })
}

/** Parse the whole served catalog. Throws a readable Error naming the first problem found. */
export function parseWorkspaceLayouts<
  I extends string,
  C extends string,
  W extends string,
  E extends string,
  P extends string,
>(value: unknown, vocabulary: LayoutVocabulary<I, C, W, E, P>): LayoutConfig<I, C, W, E, P>[] {
  const layouts = list(value, 'The layout list', 50, 1).map((entry, i) => parseLayout(entry, vocabulary, i + 1))
  distinct(
    layouts.map((layout) => layout.id),
    'Layout IDs must be unique.',
  )
  return layouts
}

const LAYOUT_KEYS = [
  'id',
  'name',
  'shortName',
  'description',
  'icon',
  'preview',
  'preset',
  'sidebar',
  'view',
  'summary',
  'panelFrame',
  'toolbar',
  'headerTools',
  'panelWindows',
]

export function parseLayout<I extends string, C extends string, W extends string, E extends string, P extends string>(
  value: unknown,
  vocabulary: LayoutVocabulary<I, C, W, E, P>,
  position = 1,
): LayoutConfig<I, C, W, E, P> {
  const source = strictObject(value, `Layout ${position}`, LAYOUT_KEYS)
  const id = text(source.id, `Layout ${position} id`, 60)
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw Error(`Layout id "${id}" must be lowercase letters, digits and hyphens.`)
  const label = `Layout "${id}"`
  const preview = optional(source, 'preview', (v) => text(v, `${label} preview`))
  if (preview && !/^[a-z0-9_-]+\.(webp|png|jpg)$/i.test(preview))
    throw Error(`${label} preview must be a .webp, .png or .jpg file name.`)
  return compact({
    id,
    name: text(source.name, `${label} name`),
    shortName: optional(source, 'shortName', (v) => text(v, `${label} shortName`)),
    description: text(source.description, `${label} description`, 400),
    icon: optional(source, 'icon', (v) => oneOf(v, `${label} icon`, vocabulary.icons)) ?? defaultIcon(vocabulary),
    preview,
    preset: optional(source, 'preset', (v) => oneOf(v, `${label} preset`, vocabulary.presets)) ?? vocabulary.presets[0],
    sidebar: optional(source, 'sidebar', (v) => oneOf(v, `${label} sidebar`, ['open', 'collapsed'] as const)) ?? 'open',
    view:
      optional(source, 'view', (v) => oneOf(v, `${label} view`, ['responsive', 'focused'] as const)) ?? 'responsive',
    summary: optional(source, 'summary', (v) => parseSummaryOptions(v, `${label} summary`)),
    panelFrame: optional(source, 'panelFrame', (v) => parsePanelFrame(v, `${label} panelFrame`)),
    toolbar: optional(source, 'toolbar', (v) => parseToolbar(v, vocabulary, `${label} toolbar`)),
    headerTools: optional(source, 'headerTools', (v) => {
      const tools: readonly (C | W)[] = [...vocabulary.widgets, ...vocabulary.commands]
      const ids = list(v, `${label} headerTools`, 60).map((id) => oneOf(id, `${label} header tool`, tools))
      distinct(ids, `${label} repeats a header tool.`)
      return ids
    }),
    panelWindows: optional(source, 'panelWindows', (v) => {
      const placements = parsePanelWindowLayouts(v)
      if (vocabulary.panels && placements.some((panel) => !vocabulary.panels!.includes(panel.slot)))
        throw Error(`${label} panelWindows names an unknown panel.`)
      return placements
    }),
  })
}

function defaultIcon<I extends string>(vocabulary: { icons: readonly I[] }): I {
  return (vocabulary.icons.find((icon) => icon === 'panels') ?? vocabulary.icons[0]) as I
}

function parsePanelFrame(value: unknown, label: string): PanelFrame {
  const source = strictObject(value, label, ['background', 'grayPercent', 'inset', 'gap', 'resizeCorners'])
  return compact({
    background: optional(source, 'background', (v) =>
      oneOf(v, `${label} background`, ['default', 'gray', 'white'] as const),
    ),
    grayPercent: optional(source, 'grayPercent', (v) => int(v, `${label} grayPercent`, 0, 100)),
    inset: optional(source, 'inset', (v) => int(v, `${label} inset`, 0, 80)),
    gap: optional(source, 'gap', (v) => int(v, `${label} gap`, 0, 40)),
    resizeCorners: optional(source, 'resizeCorners', (v) => bool(v, `${label} resizeCorners`)),
  })
}

const TOOLBAR_KEYS = [
  'dock',
  'fullWidth',
  'compact',
  'editorPlacement',
  'findTools',
  'minimizeOnShortScreens',
  'quickAccess',
  'tabTools',
  'includeProjectHeader',
  'header',
  'label',
  'tabsLabel',
  'title',
  'startGroup',
  'groups',
]

function parseToolbar<I extends string, C extends string, W extends string, E extends string, P extends string>(
  value: unknown,
  vocabulary: LayoutVocabulary<I, C, W, E, P>,
  label: string,
): LayoutToolbar<I, C, W, E> {
  const source = strictObject(value, label, TOOLBAR_KEYS)
  const flag = (key: string) => optional(source, key, (v) => bool(v, `${label} ${key}`))
  const command = (v: unknown, what: string) => oneOf(v, what, vocabulary.commands)
  const toolbar = compact({
    dock: oneOf(source.dock, `${label} dock`, ['top', 'side'] as const),
    fullWidth: flag('fullWidth'),
    compact: flag('compact'),
    editorPlacement: optional(source, 'editorPlacement', (v) =>
      oneOf(v, `${label} editorPlacement`, ['inline', 'pane'] as const),
    ),
    findTools: flag('findTools'),
    minimizeOnShortScreens: flag('minimizeOnShortScreens'),
    quickAccess: optional(source, 'quickAccess', (v) => {
      const ids = list(v, `${label} quickAccess`).map((id) => command(id, `${label} quickAccess command`))
      distinct(ids, 'Repeated quick access command.')
      return ids
    }),
    tabTools: optional(source, 'tabTools', (v) => {
      const tools: readonly (C | W)[] = [...vocabulary.commands, ...vocabulary.widgets]
      const ids = list(v, `${label} tabTools`, 30).map((id) => oneOf(id, `${label} tab tool`, tools))
      distinct(ids, 'Repeated tab-row tool.')
      return ids
    }),
    includeProjectHeader: flag('includeProjectHeader'),
    header: optional(source, 'header', (v) => oneOf(v, `${label} header`, ['controls'] as const)),
    label: text(source.label, `${label} label`),
    tabsLabel: text(source.tabsLabel, `${label} tabsLabel`),
    title: optional(source, 'title', (v) => text(v, `${label} title`)),
    startGroup: optional(source, 'startGroup', (v) => text(v, `${label} startGroup`)),
    groups: list(source.groups, `${label} groups`, 40, 1).map((group) => parseGroup(group, vocabulary, label)),
  })
  if ((toolbar.includeProjectHeader || toolbar.header) && toolbar.dock !== 'top')
    throw Error('The project header uses a top toolbar.')
  if (toolbar.includeProjectHeader && toolbar.header) throw Error('Choose one header presentation.')
  const editors = toolbar.groups.flatMap((group) => (group.editor ? [group.editor] : []))
  if (editors.length && (toolbar.dock !== 'top' || new Set(editors).size !== editors.length))
    throw Error('Assign each workflow editor to one tab in a top toolbar.')
  const names = new Set(toolbar.groups.map((group) => group.label))
  if (names.size !== toolbar.groups.length || (toolbar.startGroup && !names.has(toolbar.startGroup)))
    throw Error('Use unique group labels and an existing startGroup.')
  return toolbar
}

function parseGroup<I extends string, C extends string, W extends string, E extends string, P extends string>(
  value: unknown,
  vocabulary: LayoutVocabulary<I, C, W, E, P>,
  toolbarLabel: string,
): LayoutGroup<I, C, W, E> {
  const source = strictObject(value, `${toolbarLabel} group`, [
    'label',
    'icon',
    'hint',
    'editor',
    'commands',
    'sections',
  ])
  const label = `Group "${text(source.label, `${toolbarLabel} group label`)}"`
  const group = compact({
    label: text(source.label, label),
    icon: optional(source, 'icon', (v) => oneOf(v, `${label} icon`, vocabulary.icons)),
    hint: optional(source, 'hint', (v) => text(v, `${label} hint`, 400)),
    editor: optional(source, 'editor', (v) => oneOf(v, `${label} editor`, vocabulary.editors)),
    commands: optional(source, 'commands', (v) => {
      const ids = list(v, `${label} commands`, 100, 1).map((id) => oneOf(id, `${label} command`, vocabulary.commands))
      distinct(ids, 'Repeated command in group.')
      return ids
    }),
    sections: optional(source, 'sections', (v) =>
      list(v, `${label} sections`, 40, 1).map((section) => parseSection(section, vocabulary, label)),
    ),
  })
  if (group.commands && group.sections) throw Error(`${label}: use only one command format.`)
  if (!group.editor && !group.commands && !group.sections)
    throw Error(`${label} needs an editor, commands or sections.`)
  return group
}

function parseSection<C extends string, W extends string>(
  value: unknown,
  vocabulary: LayoutVocabulary<string, C, W, string, string>,
  groupLabel: string,
): LayoutSection<C, W> {
  const source = strictObject(value, `${groupLabel} section`, ['label', 'rows', 'primary', 'items', 'more', 'collect'])
  const label = `${groupLabel} section "${text(source.label, `${groupLabel} section label`)}"`
  const tools: readonly (C | W)[] = [...vocabulary.widgets, ...vocabulary.commands]
  const items = (key: string) =>
    optional(source, key, (v) => list(v, `${label} ${key}`).map((id) => oneOf(id, `${label} tool`, tools)))
  const section = compact({
    label: text(source.label, label),
    rows: optional(source, 'rows', (v) => oneOf(v, `${label} rows`, [1, 2, 3] as const)),
    primary: optional(source, 'primary', (v) => oneOf(v, `${label} primary`, vocabulary.commands)),
    collect: optional(source, 'collect', (v) =>
      oneOf(v, `${label} collect`, [...Object.keys(vocabulary.collections ?? {}), REMAINING_TOOLS]),
    ),
    items: items('items') ?? [],
    more: items('more'),
  })
  if (!section.collect && !section.items.length && !section.more?.length)
    throw Error(`${label} needs at least one tool.`)
  if (section.primary && !section.items.includes(section.primary))
    throw Error(`${label}: the primary command must be in its section.`)
  return section
}

/** Drop keys whose value is undefined, so parsed objects compare equal to their JSON. */
function compact<T extends JsonObject>(value: T): T {
  for (const key of Object.keys(value)) if (value[key] === undefined) delete value[key]
  return value
}

/**
 * Expand the sections that `collect` a tool list: each gains, under `more`, the tools of that list
 * no explicit placement holds. Hosted placements win; run it before personal ribbon preferences.
 */
export function resolveToolbar<T extends LayoutToolbar<string, string, string, string>>(
  toolbar: T,
  vocabulary: Pick<LayoutVocabulary<string, string, string>, 'commands' | 'widgets' | 'collections'>,
): T {
  const sections = toolbar.groups.flatMap((tab) => tab.sections ?? [])
  if (!sections.some((section) => section.collect)) return toolbar
  const placed = new Set<string>([
    ...(toolbar.tabTools ?? []),
    ...toolbar.groups.flatMap((tab) => tab.commands ?? []),
    ...sections.flatMap((section) => [...section.items, ...(section.more ?? [])]),
  ])
  const additions = new Map<(typeof sections)[number], string[]>()
  const collect = (source: readonly string[], section: (typeof sections)[number]) => {
    const missing = source.filter((id) => !placed.has(id))
    missing.forEach((id) => placed.add(id))
    additions.set(section, missing)
  }
  // Named lists first, so `remainingTools` takes only what none of them claimed.
  for (const section of sections)
    if (section.collect && section.collect !== REMAINING_TOOLS)
      collect(vocabulary.collections?.[section.collect] ?? [], section)
  for (const section of sections)
    if (section.collect === REMAINING_TOOLS) collect([...vocabulary.commands, ...vocabulary.widgets], section)
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

/** A layout or toolbar of any tool, as the shared renderers take them. */
export type AnyLayout = LayoutConfig<string, string, string, string, string>
export type AnyToolbar = LayoutToolbar<string, string, string, string>
