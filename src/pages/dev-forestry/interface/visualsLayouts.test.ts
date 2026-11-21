import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { VIA_STEPS } from '../via'
import { visualsCommandIds, visualsCommands, visualsExportCommands } from './visualsCommands'
import { parseVisualsLayouts } from './visualsLayouts'

const shipped = JSON.parse(readFileSync(new URL('../../../../public/visuals-layouts.json', import.meta.url), 'utf8'))

describe('visual quality layouts', () => {
  it('parses the served layouts: Guided mode first, then the Ribbon', () => {
    const layouts = parseVisualsLayouts(shipped)
    expect(layouts.map((layout) => layout.id)).toEqual(['guided', 'ribbon'])
    expect(layouts[0].toolbar).toBeUndefined()
    expect(layouts[0].sidebar).toBe('open')
    expect(layouts[1].toolbar?.dock).toBe('top')
  })

  it('gives each VIA step one ribbon tab, titled as the handbook step', () => {
    const ribbon = parseVisualsLayouts(shipped).find((layout) => layout.id === 'ribbon')!
    const tabs = ribbon.toolbar!.groups.filter((group) => group.editor)
    expect(tabs.map((tab) => tab.editor)).toEqual(VIA_STEPS.map((step) => step.id))
    for (const tab of tabs) {
      const step = VIA_STEPS.find((entry) => entry.id === tab.editor)!
      expect(tab.editorTitle).toBe(`Step ${step.number} · ${step.title}`)
    }
  })

  it('offers the interface switch and every Save & export output from the ribbon', () => {
    const ribbon = parseVisualsLayouts(shipped).find((layout) => layout.id === 'ribbon')!
    const placed = ribbon.toolbar!.groups.flatMap((group) => [
      ...(group.commands ?? []),
      ...(group.sections ?? []).flatMap((section) => [...section.items, ...(section.more ?? [])]),
    ])
    expect(placed).toContain('chooseInterface')
    for (const output of visualsExportCommands) expect(placed, output.command).toContain(output.command)
  })

  it('refuses a step that is not one of the five', () => {
    expect(() =>
      parseVisualsLayouts([
        {
          id: 'odd',
          name: 'Odd',
          description: 'A layout.',
          toolbar: {
            dock: 'top',
            label: 'Tools',
            tabsLabel: 'Tabs',
            groups: [{ label: 'Terrain', editor: 'terrain' }],
          },
        },
      ]),
    ).toThrow(/editor/)
  })
})

describe('visual quality command registry', () => {
  it('gives every command its own icon, so neighbours in a ribbon group never look alike', () => {
    const byIcon = new Map<unknown, string[]>()
    for (const id of visualsCommandIds) {
      const icon = visualsCommands[id].icon
      byIcon.set(icon, [...(byIcon.get(icon) ?? []), id])
    }
    expect([...byIcon.values()].filter((ids) => ids.length > 1)).toEqual([])
  })
})
