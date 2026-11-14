import type { ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchResultContent } from './search-combobox'
import { SearchPalette, type SearchPaletteProps } from './search-palette'

// Radix's dialog needs a DOM; the double renders the content in place.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <>{children}</> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p data-description="">{children}</p>,
}))

interface Tool {
  name: string
  tab: string
  off?: boolean
}

const TOOLS: Tool[] = [
  { name: 'Fit road', tab: 'View' },
  { name: 'Contours', tab: 'View', off: true },
  { name: 'Plot book', tab: 'File' },
]

let view: ReactTestRenderer | undefined
afterEach(() => {
  if (view) act(() => view?.unmount())
  view = undefined
})

function Palette(props: Partial<SearchPaletteProps<Tool>>) {
  return (
    <SearchPalette
      open
      onOpenChange={() => {}}
      title="Find tools"
      description="Search the tools."
      query=""
      onQueryChange={() => {}}
      items={TOOLS}
      onPick={() => {}}
      getKey={(tool) => tool.name}
      getGroup={(tool) => tool.tab}
      isDisabled={(tool) => Boolean(tool.off)}
      renderOption={(tool) => <SearchResultContent title={tool.name} detail={tool.tab} />}
      {...props}
    />
  )
}

function mount(props: Partial<SearchPaletteProps<Tool>> = {}) {
  act(() => {
    view = create(<Palette {...props} />)
  })
  return view!
}

/** The dialog content as the palette configured it: its position and its key and focus handlers. */
const content = () => view!.root.findByProps({ showClose: false })
const input = () => view!.root.findByProps({ role: 'combobox' })
const options = () => view!.root.findAllByProps({ role: 'option' })
const text = (node: { children: unknown[] }): string =>
  node.children.map((child) => (typeof child === 'string' ? child : text(child as { children: unknown[] }))).join('')

describe('SearchPalette', () => {
  it('names the dialog, the box and the list, and groups options under headings', () => {
    mount({ inputLabel: 'Search tools', resultsLabel: 'Matching tools', placeholder: 'Search tools and settings' })
    expect(text(view!.root.findByType('h2'))).toBe('Find tools')
    expect(input().props['aria-label']).toBe('Search tools')
    expect(input().props.placeholder).toBe('Search tools and settings')
    const list = view!.root.findByProps({ role: 'listbox' })
    expect(list.props['aria-label']).toBe('Matching tools')
    expect(view!.root.findAllByProps({ role: 'group' })).toHaveLength(2)
    expect(options().map((option) => option.type)).toEqual(['button', 'button', 'button'])
  })

  it('is centred across the screen by its own transform', () => {
    mount()
    expect(content().props.style).toEqual({ transform: 'translateX(-50%)' })
  })

  it('closes before it reports a pick, and never picks a disabled option', () => {
    const calls: string[] = []
    mount({
      onOpenChange: (open) => calls.push(`open:${open}`),
      onPick: (tool) => calls.push(`pick:${tool.name}`),
    })
    act(() => options()[1].props.onClick())
    expect(calls).toEqual([])
    act(() => options()[2].props.onClick())
    expect(calls).toEqual(['open:false', 'pick:Plot book'])
  })

  it('says so in a status line when nothing matches, and hides the empty list', () => {
    mount({ items: [], empty: 'No matching tools.', countLabel: (count) => `${count} tools` })
    expect(text(view!.root.findByProps({ role: 'status' }))).toBe('No matching tools.')
    expect(view!.root.findByProps({ role: 'listbox' }).props.className).toContain('hidden')
    expect(JSON.stringify(view!.toJSON())).toContain('0 tools')
  })

  it('counts results and names what Enter does', () => {
    mount({ pickHint: 'Run' })
    const json = JSON.stringify(view!.toJSON())
    expect(json).toContain('3 results')
    expect(json).toContain('Run')
    act(() => view!.update(<Palette items={TOOLS.slice(0, 1)} />))
    expect(JSON.stringify(view!.toJSON())).toContain('1 result"')
  })

  it("keeps its keys from the page's shortcuts, after the caller has seen them", () => {
    const seen: string[] = []
    mount({ onKeyDown: (event) => seen.push(event.key) })
    const event = { key: ']', stopPropagation: vi.fn() }
    act(() => content().props.onKeyDown(event))
    expect(seen).toEqual([']'])
    expect(event.stopPropagation).toHaveBeenCalled()
  })

  it('clears the query from the button that shows once there is one', () => {
    const onQueryChange = vi.fn()
    mount({ onQueryChange })
    expect(view!.root.findAllByProps({ 'aria-label': 'Clear search' })).toHaveLength(0)
    act(() => view!.update(<Palette query="plot" onQueryChange={onQueryChange} />))
    act(() => view!.root.findByProps({ 'aria-label': 'Clear search' }).props.onClick())
    expect(onQueryChange).toHaveBeenCalledWith('')
  })

  it('returns focus to the named element on close', () => {
    const target = { current: { focus: vi.fn() } as unknown as HTMLElement }
    mount({ returnFocus: target })
    const close = { preventDefault: vi.fn() }
    act(() => content().props.onCloseAutoFocus(close))
    expect(close.preventDefault).toHaveBeenCalled()
    expect(target.current.focus).toHaveBeenCalled()
  })
})
