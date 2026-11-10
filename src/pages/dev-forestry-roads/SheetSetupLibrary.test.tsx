import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BLOCK_SHEET, type BlockSheetSettings } from './blockSheet'
import { createRoadReportSettings, type RoadReportSettings } from './reportSettings'
import { SHEET_SETUP_STORAGE_KEY, SheetSetupLibrary } from './SheetSetupLibrary'

vi.mock('./Controls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./Controls')>()),
  RoadSelect: (await import('./roadSelectTestDouble')).RoadSelectTestDouble,
}))
vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('aside', { 'aria-label': label }, children),
}))

let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})
const text = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('')
const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, v: string) => void values.set(key, v),
  }
}

function mount(plotBook: RoadReportSettings, blockSheet: BlockSheetSettings, storage = memoryStorage()) {
  const applied: { plotBook?: RoadReportSettings; blockSheet?: BlockSheetSettings } = {}
  act(() => {
    renderer = create(
      <SheetSetupLibrary
        plotBook={plotBook}
        onPlotBook={(value) => (applied.plotBook = value)}
        blockSheet={{ value: blockSheet, onApply: (value) => (applied.blockSheet = value) }}
        storage={storage}
      />,
    )
  })
  const root = renderer!.root
  const button = (label: string) =>
    root.find((node) => node.type === 'button' && (text(node) === label || node.props['aria-label'] === label))
  return {
    storage,
    applied,
    root,
    name: (value: string) =>
      act(() => root.findByProps({ placeholder: 'e.g. Office 11 × 17' }).props.onChange({ target: { value } })),
    click: (label: string) => act(() => button(label).props.onClick()),
    status: () => text(root.find((node) => node.props.role === 'status' || node.props.role === 'alert')),
  }
}

describe('saved sheet setups', () => {
  it('saves the current setup in the browser and applies it to another project', () => {
    const office = { ...createRoadReportSettings(), paper: 'tabloid' as const }
    const first = mount(office, { ...DEFAULT_BLOCK_SHEET, paper: 'ansi-d', block: 'context:a', comments: 'Here' })
    expect(text(first.root)).toContain('No setups saved in this browser.')
    first.name('Office tabloid')
    first.click('Save')
    expect(first.status()).toBe('Saved “Office tabloid” in this browser.')
    const stored = JSON.parse(first.storage.getItem(SHEET_SETUP_STORAGE_KEY)!)
    expect(stored.setups[0].name).toBe('Office tabloid')
    expect(JSON.stringify(stored)).not.toContain('context:a')
    act(() => renderer!.unmount())

    // Another project, with its own block, opens the same library.
    const other = mount(createRoadReportSettings(), { ...DEFAULT_BLOCK_SHEET, block: 'context:b' }, first.storage)
    expect(text(other.root)).toContain('Plot book: Tabloid 11 × 17 in (ANSI B) landscape, 2 chapters')
    other.click('Apply')
    expect(other.applied.plotBook?.paper).toBe('tabloid')
    expect(other.applied.blockSheet).toMatchObject({ paper: 'ansi-d', block: 'context:b', comments: '' })
    expect(other.status()).toBe('Applied “Office tabloid” to the plot book and report contents and the block sheet.')
    other.click('Delete Office tabloid')
    expect(JSON.parse(other.storage.getItem(SHEET_SETUP_STORAGE_KEY)!).setups).toEqual([])
  })
})
