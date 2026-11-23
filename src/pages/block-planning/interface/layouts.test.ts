import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { planningCommands } from './commands'
import { parsePlanningLayouts } from './layouts'

describe('block planning interfaces', () => {
  it('reads every interface in the served layout file', () => {
    const layouts = parsePlanningLayouts(JSON.parse(readFileSync('public/block-planning-layouts.json', 'utf8')))
    expect(layouts.map((l) => l.id)).toEqual(['guided', 'ribbon', 'guided-map', 'dashboard'])
    const ribbon = layouts.find((l) => l.id === 'ribbon')!
    expect(ribbon.toolbar?.groups.filter((g) => g.editor).map((g) => g.editor)).toEqual([
      'area',
      'blocks',
      'schedules',
      'compare',
      'review',
    ])
  })

  it('gives every command an icon of its own', () => {
    const icons = Object.values(planningCommands).map((c) => c.icon)
    expect(new Set(icons).size).toBe(icons.length)
  })
})
