import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Field } from './Controls'
import { ProjectsDialog } from './ProjectsDialog'
import { BC_ACCESS_EXAMPLES } from './bcAccessExamples'
import type { LibraryEntry } from './projectLibrary'

vi.mock('./Controls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./Controls')>()),
  RoadSelect: (await import('./roadSelectTestDouble')).RoadSelectTestDouble,
}))
vi.mock('@/components/ui/dialog-shell', () => ({
  PanelDialog: ({ children, open, title }: { children: ReactNode; open: boolean; title: string }) =>
    open ? createElement('section', { role: 'dialog', 'aria-label': title }, children) : null,
}))
vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children }: { children: ReactNode }) => createElement('aside', {}, children),
}))
vi.mock('@/components/ui/map-panels', () => ({
  InlineAlert: ({ children, title }: { children: ReactNode; title?: string }) =>
    createElement('div', { role: 'alert' }, title, children),
}))

const views: ReactTestRenderer[] = []
afterEach(async () => {
  for (const view of views.splice(0)) await act(async () => view.unmount())
  vi.restoreAllMocks()
})
const text = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(text).join('')

function button(view: ReactTestRenderer, label: string | RegExp) {
  const found = view.root.findAllByType('button').find((node) => {
    const name = node.props['aria-label'] ?? text(node)
    return typeof label === 'string' ? name === label : label.test(name)
  })
  if (!found) throw Error(`Missing button: ${label}`)
  return found
}
function input(view: ReactTestRenderer, label: string) {
  return view.root
    .findAllByType(Field)
    .find((node) => node.props.label === label)!
    .findByType('input')
}

const library: LibraryEntry[] = [
  {
    id: 'study',
    name: 'Neighbouring blocks',
    terrain: 'Regional terrain',
    roads: 0,
    workspaceMode: 'access-investigation',
    openingId: '99001',
    blocks: 2,
    roadRecords: 7,
    updatedAt: 100,
  },
  {
    id: 'design',
    name: 'Spur design',
    terrain: 'Synthetic terrain',
    roads: 2,
    workspaceMode: 'design',
    blocks: 1,
    roadRecords: 3,
    updatedAt: 99,
  },
]

async function harness() {
  const onOpenChange = vi.fn()
  const onScenario = vi.fn()
  const onOpenBcOpening = vi.fn<(_: string) => Promise<void>>().mockResolvedValue(undefined)
  let view!: ReactTestRenderer
  await act(async () => {
    view = create(
      createElement(ProjectsDialog, {
        open: true,
        onOpenChange,
        library,
        activeId: 'study',
        centre: [-123, 54],
        busy: false,
        onOpen: vi.fn(),
        onDuplicate: vi.fn(),
        onDelete: vi.fn(),
        onOpenFile: vi.fn(),
        onCreate: vi.fn(),
        onScenario,
        onOpenBcOpening,
      }),
    )
  })
  views.push(view)
  return { view, onOpenChange, onScenario, onOpenBcOpening }
}

describe('project discovery', () => {
  it('distinguishes source records from designed alignments and finds saved studies by opening or name', async () => {
    const { view } = await harness()
    const saved = () => view.root.findByProps({ 'aria-label': 'Saved projects' })
    expect(text(saved())).toContain('Access study · Opening 99001')
    expect(text(saved())).toContain('0 designed alignments · 2 block parts · 7 context road records')
    expect(text(saved())).toContain('2 designed alignments · 1 block part · 3 context road records')
    await act(async () => input(view, 'Search saved projects').props.onChange({ target: { value: '99001' } }))
    expect(text(saved())).toContain('Neighbouring blocks')
    expect(text(saved())).not.toContain('Spur design')
    await act(async () => input(view, 'Search saved projects').props.onChange({ target: { value: 'SPUR' } }))
    expect(text(saved())).toContain('Spur design')
    await act(async () => button(view, 'Access studies').props.onClick())
    expect(text(saved())).toContain('No saved projects match this search and type.')
    await act(async () => input(view, 'Search saved projects').props.onChange({ target: { value: '' } }))
    expect(text(saved())).toContain('Neighbouring blocks')
    expect(text(saved())).not.toContain('Spur design')
    await act(async () => button(view, 'Find BC cutblocks').props.onClick())
    expect(view.root.findAllByProps({ 'data-testid': 'bc-cutblock-discovery' })).toHaveLength(1)
  })

  it('filters actual record recipes separately from design and synthetic training examples', async () => {
    const { view, onScenario } = await harness()
    await act(async () => button(view, /Browse \d+ example scenarios/).props.onClick())
    const cards = () => view.root.findAllByType('article')
    expect(cards().filter((node) => node.props['data-scenario'] === 'bc-opening-60677')).toHaveLength(1)
    await act(async () =>
      view.root.findByProps({ 'aria-label': 'Scenario purpose' }).props.onChange({ target: { value: 'records' } }),
    )
    expect(cards()).toHaveLength(BC_ACCESS_EXAMPLES.length)
    expect(cards().every((node) => text(node).includes('Actual BC record investigation'))).toBe(true)
    await act(async () => input(view, 'Search example scenarios').props.onChange({ target: { value: '60677' } }))
    expect(cards()).toHaveLength(1)
    await act(async () => input(view, 'Search example scenarios').props.onChange({ target: { value: '' } }))
    await act(async () =>
      view.root.findByProps({ 'aria-label': 'Scenario purpose' }).props.onChange({ target: { value: 'training' } }),
    )
    expect(cards().length).toBeGreaterThan(0)
    expect(cards().every((node) => node.props['data-scenario'].startsWith('training-'))).toBe(true)
    await act(async () => button(view, 'Load Training · reconstruct block access and bridges').props.onClick())
    expect(onScenario).toHaveBeenCalledExactlyOnceWith('training-access-history')
  })

  it('keeps an actual recipe available after a failed load and closes only after a successful study open', async () => {
    const { view, onOpenChange, onOpenBcOpening } = await harness()
    onOpenBcOpening.mockRejectedValueOnce(Error('Source unavailable.')).mockResolvedValueOnce(undefined)
    await act(async () => button(view, /Browse \d+ example scenarios/).props.onClick())
    const example = BC_ACCESS_EXAMPLES[0]
    await act(async () => button(view, `Open study for ${example.title}`).props.onClick())
    expect(onOpenBcOpening).toHaveBeenCalledWith(example.openingId)
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(text(view.root)).toContain('Source unavailable.')
    expect(view.root.findAllByProps({ 'data-scenario': example.id })).toHaveLength(1)
    await act(async () => button(view, `Open study for ${example.title}`).props.onClick())
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })
})
