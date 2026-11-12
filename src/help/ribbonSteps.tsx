import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { ReactNode } from 'react'
import { settingsTitleFor } from '../components/interfaces/RibbonGroupSettings'
import { WorkspaceTools } from '../components/interfaces/WorkspaceTools'
import { isRibbonCommand, ribbonToolLabel, type RibbonTool } from '../components/interfaces/ribbonToolCatalog'
import type { WorkspaceToolbar, WorkspaceWidget } from '../components/interfaces/workspaceLayouts'
import { ribbonRoutes, type RibbonAction } from './ribbonRoutes'
import { DEFAULT_INTERFACE_NAME } from '../components/interfaces/interfacePreference'

type Tab = WorkspaceToolbar['groups'][number]
type Group = NonNullable<Tab['sections']>[number]
export type SourceStep = {
  id: string
  title: string
  instruction: string
  action: string
  atMs: number
  target?: { nodeId: number; label?: string }
  value?: string
  screenshot?: { dataUrl: string; alt: string }
  afterMs?: number
}
export type LessonStep = {
  title: string
  instruction: string
  source?: SourceStep
  ribbon?: { markup: string; label: string; tab: string; answer?: string }
}
type Location = { tab: Tab; group?: Group; more?: boolean; quick?: boolean }
type Stage = 'tab' | 'group' | 'tool' | 'editor'
const noop = () => {}

function locate(toolbar: WorkspaceToolbar, action: RibbonAction): Location {
  let extra: Location | undefined
  for (const tab of toolbar.groups) {
    if (action.editor && tab.editor === action.editor) return { tab }
    if (!action.tool) continue
    for (const group of tab.sections ?? []) {
      if (group.items.includes(action.tool)) return { tab, group }
      if (group.more?.includes(action.tool)) extra ??= { tab, group, more: true }
    }
    if (isRibbonCommand(action.tool) && tab.commands?.includes(action.tool)) return { tab }
  }
  if (action.tool && isRibbonCommand(action.tool) && toolbar.quickAccess?.includes(action.tool)) {
    return { tab: toolbar.groups[0], quick: true }
  }
  if (extra) return extra
  const name = action.tool ? ribbonToolLabel(action.tool) : action.editor + ' settings'
  throw new Error(
    `Your active Ribbon layout does not include ${name}. Choose the ${DEFAULT_INTERFACE_NAME} guide or restore a layout containing this tool.`,
  )
}

/** Render a close-up with the same component, tab order, labels and icons as the working Ribbon. */
function ribbonView(toolbar: WorkspaceToolbar, loc: Location, action: RibbonAction, stage: Stage) {
  const { tab, group, more } = loc
  const groups = toolbar.groups.map((entry) => {
    if (entry !== tab || !group) return entry
    const section = more && stage === 'tool' ? { ...group, items: group.more ?? [], more: [] } : group
    return { ...entry, sections: [section] }
  })
  const widgets: Partial<Record<WorkspaceWidget, ReactNode>> = {}
  function addWidget(id: RibbonTool) {
    if (isRibbonCommand(id)) return
    const field = id === action.tool
    const value = field ? action.value : undefined
    widgets[id] = (
      <label>
        {ribbonToolLabel(id)}
        {value !== undefined &&
          (action.answer ? (
            <input
              aria-label={ribbonToolLabel(id)}
              defaultValue={value}
              type={typeof value === 'string' && value !== '' && Number.isFinite(Number(value)) ? 'number' : 'text'}
              step="any"
            />
          ) : (
            <strong>{value}</strong>
          ))}
      </label>
    )
  }
  for (const entry of groups)
    for (const section of entry.sections ?? [])
      for (const id of [...section.items, ...(section.more ?? [])]) addWidget(id)
  const host = document.createElement('div')
  const root = createRoot(host)
  flushSync(() =>
    root.render(
      <div className={`ribbon-excerpt stage-${stage}`}>
        <WorkspaceTools
          toolbar={{ ...toolbar, groups, quickAccess: loc.quick ? toolbar.quickAccess : [], findTools: false }}
          disabled={false}
          groupName={tab.label}
          onGroupChange={noop}
          onCommand={noop}
          states={{}}
          widgets={widgets}
          editorsAvailable
          editorMount={noop}
          folded
          minimized={false}
          onToggleFold={noop}
          onToggleMinimized={noop}
        />
      </div>,
    ),
  )
  const copy = host.cloneNode(true) as HTMLElement
  root.unmount()
  if (more && stage === 'tool' && group) {
    const commands = copy.querySelector('.lp-group-items')
    const heading = document.createElement('h3')
    heading.textContent = settingsTitleFor(group.label)
    const pane = document.createElement('section')
    pane.className = 'lesson-group-pane'
    if (commands) {
      pane.append(heading, commands)
      copy.querySelector('[role="tabpanel"]')?.replaceChildren(pane)
    }
  }
  let cue: Element | null | undefined
  if (stage === 'tab')
    cue = [...copy.querySelectorAll('[role="tab"]')].find((el) => el.textContent?.trim() === tab.label)
  else if (stage === 'group') cue = copy.querySelector('.lp-settings-launcher')
  else if (stage === 'editor') cue = copy.querySelector('.lp-fold-editors')
  else {
    const scope = loc.quick ? copy.querySelector('.lp-quick-access') : copy
    const item = scope?.querySelector(`[data-ribbon-item="${action.tool}"]`)
    cue = item?.querySelector('input') ?? item
    if (cue && !cue.matches('button,input')) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = cue.className
      button.textContent = cue.textContent
      cue.replaceWith(button)
      cue = button
    }
  }
  if (!cue) throw new Error('The configured Ribbon control could not be displayed.')
  cue.setAttribute('data-lesson-target', '')
  const label =
    stage === 'tool' && action.tool
      ? ribbonToolLabel(action.tool)
      : (cue.getAttribute('aria-label') ?? cue.textContent?.trim() ?? tab.label)
  cue.setAttribute('aria-label', label)
  return { markup: copy.innerHTML, label, tab: tab.label, answer: stage === 'tool' ? action.answer : undefined }
}

export function resolveSteps(id: string, steps: SourceStep[], toolbar: WorkspaceToolbar) {
  const result: LessonStep[] = []
  let currentTab: string | undefined
  const route = ribbonRoutes[id]
  for (const source of steps) {
    const change = route[source.id]
    if (change === 'skip') continue
    if (!change) {
      result.push({ title: source.title, instruction: source.instruction, source })
      continue
    }
    const action = change
    const loc = locate(toolbar, action)
    const add = (stage: Stage, title: string, instruction: string) => {
      result.push({ title, instruction, ribbon: ribbonView(toolbar, loc, action, stage) })
    }
    if (!loc.quick && currentTab !== loc.tab.label) {
      add('tab', `Open ${loc.tab.label}`, `Select the ${loc.tab.label} tab on the Ribbon.`)
      currentTab = loc.tab.label
    }
    if (action.editor && toolbar.compact) {
      const label = toolbar.editorPlacement === 'pane' ? 'All settings' : 'Expand ribbon settings'
      add('editor', `Open ${loc.tab.label} settings`, `Select ${label} to open the full ${loc.tab.label} editor.`)
    } else if (action.tool) {
      const label = ribbonToolLabel(action.tool)
      if (loc.more && loc.group)
        add(
          'group',
          `Open ${loc.group.label}`,
          `Select the ${loc.group.label} group caption to show its additional tools.`,
        )
      const location = loc.quick ? ' in Quick access' : loc.group ? ` in ${loc.group.label}` : ''
      const instruction = action.answer
        ? `Enter ${action.answer} in ${label}${location} and press Enter.`
        : action.value
          ? `Find ${label}${location} and check that it shows ${action.value}.`
          : `Select ${label}${location}.`
      add('tool', label, [instruction, action.instruction].filter(Boolean).join(' '))
    }
    if (action.thenShared) result.push({ title: source.title, instruction: source.instruction, source })
  }
  return result
}
