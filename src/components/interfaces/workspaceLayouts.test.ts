import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseLayoutCatalog } from './workspaceLayouts'
import { parseSummaryOptions } from './workspaceLayoutSchema'

const shipped = JSON.parse(readFileSync(new URL('../../../public/workspace-layouts.json', import.meta.url), 'utf8'))
const minimal = { id: 'plain', name: 'Plain', description: 'A layout.' }
const toolbar = (groups: unknown[], extra: object = {}) => ({
  ...minimal,
  toolbar: { dock: 'top', label: 'Tools', tabsLabel: 'Tabs', groups, ...extra },
})

describe('workspace layout catalog', () => {
  it('parses the served layouts, including the dashboard', () => {
    const layouts = parseLayoutCatalog(shipped)
    expect(layouts.map((layout) => layout.id)).toEqual(['ribbon', 'guided', 'workbench', 'dashboard'])
    expect(layouts.map((layout) => layout.summary?.placement)).toEqual(['left', 'left', 'left', 'left'])
    expect(layouts.find((layout) => layout.id === 'workbench')?.panelFrame?.background).toBe('white')
  })

  it('offers the interface switch from every configurable toolbar', () => {
    for (const layout of parseLayoutCatalog(shipped)) {
      if (!layout.toolbar) continue
      const ids = layout.toolbar.groups.flatMap((group) => [
        ...(group.commands ?? []),
        ...(group.sections ?? []).flatMap((section) => [...section.items, ...(section.more ?? [])]),
      ])
      expect(ids, layout.id).toContain('chooseInterface')
    }
  })

  it('applies defaults', () => {
    expect(parseLayoutCatalog([minimal])[0]).toEqual({
      ...minimal,
      icon: 'panels',
      preset: 'linked',
      sidebar: 'open',
      view: 'responsive',
    })
  })

  it('places detached-panel controls in the tab row and accepts popup layout defaults', () => {
    const ribbon = parseLayoutCatalog(shipped).find((layout) => layout.id === 'ribbon')!
    expect(ribbon.toolbar?.tabTools).toEqual(['detachedPanels'])
    const [layout] = parseLayoutCatalog([
      { ...minimal, panelWindows: [{ slot: 'plan', mode: 'window', left: -1600, width: 1400 }] },
    ])
    expect(layout.panelWindows).toEqual([{ slot: 'plan', mode: 'window', left: -1600, width: 1400 }])
  })

  it.each([
    [[minimal, minimal], 'Layout IDs must be unique.'],
    [[{ ...minimal, preset: 'grid' }], 'preset must be one of'],
    [[{ ...minimal, colour: 'red' }], 'unknown key: colour'],
    [[{ ...minimal, headerTools: ['undo', 'warp'] }], 'header tool must be one of'],
    [[toolbar([{ label: 'A', commands: ['undo', 'undo'] }])], 'Repeated command in group.'],
    [
      [
        toolbar([
          { label: 'A', commands: ['undo'] },
          { label: 'A', commands: ['redo'] },
        ]),
      ],
      'unique group labels',
    ],
    [[toolbar([{ label: 'A', commands: ['undo'] }], { startGroup: 'B' })], 'existing startGroup'],
    [[toolbar([{ label: 'A' }])], 'needs an editor, commands or sections'],
    [
      [toolbar([{ label: 'A', commands: ['undo'], sections: [{ label: 'S', items: ['redo'] }] }])],
      'only one command format',
    ],
    [[toolbar([{ label: 'A', sections: [{ label: 'S', items: [] }] }])], 'needs at least one tool'],
    [[toolbar([{ label: 'A', sections: [{ label: 'S', primary: 'undo', items: ['redo'] }] }])], 'primary command'],
    [
      [
        toolbar([
          { label: 'A', editor: 'design' },
          { label: 'B', editor: 'design' },
        ]),
      ],
      'one tab in a top toolbar',
    ],
    [[toolbar([{ label: 'A', commands: ['undo'] }], { dock: 'side', header: 'controls' })], 'uses a top toolbar'],
    [[toolbar([{ label: 'A', commands: ['undo'] }], { quickAccess: ['undo', 'undo'] })], 'Repeated quick access'],
    [
      [toolbar([{ label: 'A', commands: ['undo'] }], { tabTools: ['detachedPanels', 'detachedPanels'] })],
      'Repeated tab-row tool',
    ],
    [[{ ...minimal, panelWindows: [{ slot: 'unknown', mode: 'window' }] }], 'unknown panel'],
  ])('refuses %j', (catalog, message) => {
    expect(() => parseLayoutCatalog(catalog)).toThrow(message)
  })
})

describe('summary options', () => {
  it('keeps the levels it knows and refuses others', () => {
    expect(parseSummaryOptions({ placement: 'top', metrics: { cost: 'hidden' } })).toEqual({
      placement: 'top',
      metrics: { cost: 'hidden' },
    })
    expect(() => parseSummaryOptions({ metrics: { cost: 'huge' } })).toThrow('Summary metric cost')
  })
})
