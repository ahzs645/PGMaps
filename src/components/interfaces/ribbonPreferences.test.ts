import { describe, expect, it } from 'vitest'
import { moveTo, orderTabs, tabOrderFor } from './ribbonPreferences'
import type { WorkspaceToolbar } from './workspaceLayouts'

const toolbar = (...labels: string[]) =>
  ({ dock: 'top', groups: labels.map((label) => ({ label })) }) as WorkspaceToolbar
const labels = (value: WorkspaceToolbar) => value.groups.map((tab) => tab.label)

describe('moveTo', () => {
  it('moves an entry to its new place', () => {
    expect(moveTo(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveTo(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('leaves the list as it was for a place outside it', () => {
    expect(moveTo(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
    expect(moveTo(['a', 'b'], -1, 0)).toEqual(['a', 'b'])
  })
})

describe('orderTabs', () => {
  const served = toolbar('File', 'Terrain', 'Road', 'View')

  it('puts the tabs in the saved order', () => {
    expect(labels(orderTabs(served, ['View', 'File', 'Terrain', 'Road']))).toEqual(['View', 'File', 'Terrain', 'Road'])
  })

  it('returns the served toolbar itself with no order or the served order', () => {
    expect(orderTabs(served, [])).toBe(served)
    expect(orderTabs(served, ['File', 'Terrain', 'Road', 'View'])).toBe(served)
  })

  it('drops tabs the layout no longer has', () => {
    expect(labels(orderTabs(served, ['View', 'Retired', 'File', 'Terrain', 'Road']))).toEqual([
      'View',
      'File',
      'Terrain',
      'Road',
    ])
  })

  it('keeps a tab the layout gained after the tab it follows', () => {
    const grown = toolbar('File', 'Terrain', 'Section', 'Road', 'View')
    expect(labels(orderTabs(grown, ['Road', 'View', 'File', 'Terrain']))).toEqual([
      'Road',
      'View',
      'File',
      'Terrain',
      'Section',
    ])
    expect(labels(orderTabs(toolbar('Home', 'File', 'Road'), ['Road', 'File']))).toEqual(['Home', 'Road', 'File'])
  })
})

describe('tabOrderFor', () => {
  const served = toolbar('File', 'Road', 'View')

  it('stores nothing for the served order, so a later served change still applies', () => {
    expect(tabOrderFor(served, toolbar('File', 'Road', 'View'))).toEqual([])
  })

  it('stores a changed order', () => {
    expect(tabOrderFor(served, toolbar('Road', 'File', 'View'))).toEqual(['Road', 'File', 'View'])
  })
})
