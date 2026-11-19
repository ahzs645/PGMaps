import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SavedContents } from '@/lib/documentContents/savedContents'
import { ReportContentsEditor } from './ReportContentsEditor'
import { REPORT_ORDER, REPORT_SECTIONS } from './reportContents'
import { ReportPackageEditor } from './ReportPackageEditor'
import { createRoadReportSettings, type RoadReportSettings } from './reportSettings'

vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('aside', { 'aria-label': label }, children),
}))

vi.mock('@/components/ui/styled-select', async (actual) => ({
  ...(await actual<typeof import('@/components/ui/styled-select')>()),
  StyledSelect: (await import('@/components/ui/styledSelectTestDouble')).StyledSelectTestDouble,
}))

// The application's popover is a portal into the page; here it is the same open state without one.
vi.mock('@/components/ui/popover', async () => {
  const { cloneElement, createContext, useContext } = await import('react')
  type State = { open: boolean; onOpenChange: (open: boolean) => void }
  const Shown = createContext<State>({ open: false, onOpenChange: () => undefined })
  return {
    Popover: ({ children, ...state }: State & { children: React.ReactNode }) => (
      <Shown.Provider value={state}>{children}</Shown.Provider>
    ),
    PopoverTrigger: ({ children }: { children: React.ReactElement<{ onClick?: () => void }> }) => {
      const state = useContext(Shown)
      return cloneElement(children, { onClick: () => state.onOpenChange(!state.open) })
    },
    PopoverContent: ({ children, role }: { children: React.ReactNode; role?: string }) =>
      useContext(Shown).open ? <div role={role}>{children}</div> : null,
  }
})

// The browser's preset store, in memory: the unit tests run without `localStorage`.
const savedLists = vi.hoisted(() => new Map<string, SavedContents[]>())
vi.mock('@/components/ui/use-saved-contents', () => ({
  useSavedContents: (listId: string) => {
    const saved = savedLists.get(listId) ?? []
    return {
      saved,
      unreadable: [],
      writeError: null,
      save: (name: string, states: Record<string, string>, order?: string[]) => {
        const preset = { id: `saved-${saved.length + 1}`, name, states, ...(order ? { order } : {}) }
        savedLists.set(listId, [...saved, preset])
        return { preset }
      },
      remove: (id: string) =>
        savedLists.set(
          listId,
          saved.filter((preset) => preset.id !== id),
        ),
      removeUnreadable: () => undefined,
    }
  },
}))

let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
  savedLists.clear()
})

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('')
const row = (root: ReactTestInstance, key: string) =>
  root.find((node) => node.type === 'li' && node.props['data-contents-row'] === key)
const rows = (root: ReactTestInstance) =>
  root.findAll((node) => node.type === 'li' && node.props['data-contents-row'] !== undefined)
const boxes = (root: ReactTestInstance) =>
  root.findAll((node) => node.type === 'input' && node.props['data-contents-focus'] === 'state')
const button = (root: ReactTestInstance, name: string) =>
  root.find((node) => node.type === 'button' && (node.props['aria-label'] === name || textOf(node) === name))
const presetSelect = (root: ReactTestInstance) =>
  root.find((node) => node.type === 'select' && String(node.props['aria-label']).startsWith('Preset for '))

function mount(element: React.ReactElement) {
  act(() => {
    if (renderer) renderer.update(element)
    else renderer = create(element)
  })
  return renderer!.root
}

describe('report contents list', () => {
  let value: RoadReportSettings = createRoadReportSettings()
  const render = (extra: Partial<Parameters<typeof ReportContentsEditor>[0]> = {}) =>
    mount(<ReportContentsEditor value={value} onChange={(next) => (value = next)} {...extra} />)

  it('turns a section off and on, and All and None set every section', () => {
    value = createRoadReportSettings()
    let root = render()
    // A checkbox per section; the always-printed parts are locked rows without one.
    expect(boxes(root)).toHaveLength(REPORT_SECTIONS.length)
    expect(rows(root)).toHaveLength(REPORT_ORDER.length + 4)
    expect(boxes(row(root, 'title'))).toHaveLength(0)
    expect(boxes(root).every((box) => box.props.checked)).toBe(true)
    act(() => boxes(row(root, 'station-schedule'))[0].props.onChange({ target: { checked: false } }))
    expect(value.omittedSections).toEqual(['station-schedule'])
    root = render()
    expect(boxes(row(root, 'station-schedule'))[0].props.checked).toBe(false)
    act(() => button(root, 'None').props.onClick())
    expect(value.omittedSections).toHaveLength(REPORT_SECTIONS.length)
    root = render()
    act(() => button(root, 'All').props.onClick())
    expect(value).not.toHaveProperty('omittedSections')
  })

  it('moves a section, keeps the opening parts in place, and puts the usual order back', () => {
    value = createRoadReportSettings()
    let root = render()
    // The opening parts have no menu; a section moves through its row's menu.
    expect(row(root, 'terrain').findAll((node) => node.props['aria-haspopup'] === 'menu')).toHaveLength(0)
    act(() => button(row(root, 'review'), "Options for 'Readiness checks'").props.onClick())
    act(() => button(root, "Move 'Readiness checks' down").props.onClick())
    expect(value.sectionOrder?.slice(0, 2)).toEqual(['full-cost', 'review'])
    root = render()
    expect(rows(root).map((node) => node.props['data-contents-row'])[4]).toBe('full-cost')
    // The limitations always print but may move.
    expect(row(root, 'limitations').findAll((node) => node.props['aria-haspopup'] === 'menu')).toHaveLength(1)
    act(() => button(root, 'Usual order').props.onClick())
    expect(value).not.toHaveProperty('sectionOrder')
  })

  it('shows why a section has nothing to print and keeps it off', () => {
    value = createRoadReportSettings()
    const root = render({ unavailable: { 'model-flags': 'The model raised no flags' } })
    const flags = row(root, 'model-flags')
    expect(boxes(flags)[0].props.disabled).toBe(true)
    expect(textOf(flags)).toContain('The model raised no flags')
    expect(textOf(root.find((node) => node.props.role === 'status'))).toContain(
      '1 section has nothing to print for this road',
    )
  })

  it('names the matching preset, marks a change as modified, and applies and saves presets', () => {
    value = createRoadReportSettings()
    let root = render()
    expect(presetSelect(root).props.value).toBe('every')
    act(() => presetSelect(root).props.onChange({ target: { value: 'short' } }))
    expect(value.omittedSections).toEqual(['sections', 'station-schedule', 'clearing', 'slope-stakes'])
    root = render()
    act(() => boxes(row(root, 'profile'))[0].props.onChange({ target: { checked: false } }))
    root = render()
    expect(textOf(presetSelect(root))).toContain('Without the long schedules · modified')
    act(() => button(root, 'Reset').props.onClick())
    expect(value.omittedSections).toEqual(['sections', 'station-schedule', 'clearing', 'slope-stakes'])
    // A preset of one's own keeps the states and the order.
    root = render()
    act(() => button(row(root, 'review'), "Options for 'Readiness checks'").props.onClick())
    act(() => button(root, "Move 'Readiness checks' to bottom").props.onClick())
    root = render()
    act(() => button(root, 'Save as preset…').props.onClick())
    const input = root.find((node) => node.type === 'input' && node.props['aria-label'] === 'Preset name')
    act(() => input.props.onChange({ target: { value: 'Field copy' } }))
    act(() => root.find((node) => node.type === 'form').props.onSubmit({ preventDefault: vi.fn() }))
    expect(savedLists.get('road-report-sections')?.[0].order?.at(-1)).toBe('review')
    root = render()
    act(() => presetSelect(root).props.onChange({ target: { value: 'every' } }))
    expect(value).not.toHaveProperty('sectionOrder')
    root = render()
    act(() => presetSelect(root).props.onChange({ target: { value: 'saved-1' } }))
    expect(value.sectionOrder?.at(-1)).toBe('review')
    expect(value.omittedSections).toEqual(['sections', 'station-schedule', 'clearing', 'slope-stakes'])
  })
})

describe('report package list', () => {
  let value: RoadReportSettings = createRoadReportSettings()
  const render = () => mount(<ReportPackageEditor value={value} onChange={(next) => (value = next)} />)
  const where = (root: ReactTestInstance, label: string) =>
    root.find((node) => node.type === 'select' && node.props['aria-label'] === `${label}: where it goes`)

  it('places a part, says what the package holds, and offers the presets', () => {
    value = createRoadReportSettings()
    let root = render()
    expect(textOf(root.find((node) => node.props.role === 'status'))).toBe(
      'The package and 5 appendix PDFs; 12 parts left out.',
    )
    expect(presetSelect(root).props.value).toBe('full')
    act(() => where(root, 'Plan & profile sheets').props.onChange({ target: { value: 'appendix' } }))
    expect(value.package?.parts).toEqual({ 'plotbook:plan-profile': 'appendix' })
    root = render()
    act(() => presetSelect(root).props.onChange({ target: { value: 'simplified' } }))
    expect(value.package?.front).toBe('summary')
  })

  it('moves a report section in the report too, and a plot-book chapter in the package only', () => {
    value = createRoadReportSettings()
    let root = render()
    act(() => button(row(root, 'report:review'), "Options for 'Readiness checks'").props.onClick())
    act(() => button(root, "Move 'Readiness checks' down").props.onClick())
    expect(value.sectionOrder?.slice(0, 2)).toEqual(['full-cost', 'review'])
    expect(value).not.toHaveProperty('package')
    root = render()
    act(() => button(row(root, 'plotbook:plan-profile'), "Options for 'Plan & profile sheets'").props.onClick())
    act(() => button(root, "Move 'Plan & profile sheets' up").props.onClick())
    expect(value.package?.order?.slice(0, 2)).toEqual(['plotbook:plan-profile', 'plotbook:charts'])
    // Order is not a preset's business: the package still reads as Full.
    root = render()
    expect(presetSelect(root).props.value).toBe('full')
  })
})
