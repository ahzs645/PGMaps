import { describe, expect, it } from 'vitest'
import { checkedSheetSymbol } from '@/lib/styleExchange/checkedSymbol'
import { SYMBOL_CATALOGUE } from '@/lib/forestry/blockSheet/symbolCatalogue'
import {
  addStyles,
  assignRole,
  defaultRoleSymbol,
  emptyRoadStyleLibrary,
  parseRoadStyleLibrary,
  removeStyle,
  roleOverrides,
  STYLE_ROLES,
} from './styleLibrary'

const creek = { kind: 'line' as const, label: 'Creek', layers: [{ color: '#0000ff', width: 1.5, dash: [4, 2] }] }
const style = (name: string, symbol = creek) => ({
  name,
  fileName: 'streams.qml',
  format: 'qml' as const,
  savedOn: '2026-11-14T00:00:00.000Z',
  symbol,
  notes: [],
})

describe('road style library', () => {
  it('checks every catalogue symbol and refuses broken ones', () => {
    for (const entry of SYMBOL_CATALOGUE) expect(checkedSheetSymbol(entry.symbol)).toEqual(entry.symbol)
    expect(() =>
      checkedSheetSymbol({ kind: 'point', label: 'x', icon: 'not-an-icon', size: 4, color: '#000' }),
    ).toThrow(/not a PGMaps icon/)
    expect(() => checkedSheetSymbol({ kind: 'line', label: 'x', layers: [{ color: 'red-ish', width: 1 }] })).toThrow(
      /colour/,
    )
    expect(() => checkedSheetSymbol({ kind: 'area', label: 'x', outline: [] })).toThrow(/draws nothing/)
  })

  it('numbers repeated names, assigns a role of the same kind only, and forgets the role with the style', () => {
    let library = addStyles(emptyRoadStyleLibrary(), [style('Creek'), style('Creek')])
    expect(library.styles.map((s) => s.name)).toEqual(['Creek', 'Creek (2)'])
    const id = library.styles[0].id
    library = assignRole(library, 'stream', id)
    expect(roleOverrides(library).stream).toEqual({ ...creek, label: 'Creek' })
    expect(() => assignRole(library, 'constraint', id)).toThrow(
      'Creek is a line symbol; Constraint areas need an area symbol.',
    )
    library = removeStyle(library, id)
    expect(library.roles.stream).toBeUndefined()
  })

  it('survives a round trip through storage and drops what no longer checks', () => {
    let library = addStyles(emptyRoadStyleLibrary(), [style('Creek')])
    library = assignRole(library, 'stream', library.styles[0].id)
    const stored = JSON.parse(JSON.stringify(library))
    expect(parseRoadStyleLibrary(stored)).toEqual(library)
    stored.styles.push({ ...stored.styles[0], id: 'bad', symbol: { kind: 'nope' } })
    stored.roles.ncd = 'bad'
    const read = parseRoadStyleLibrary(stored)
    expect(read.styles).toHaveLength(1)
    expect(read.roles.ncd).toBeUndefined()
  })

  it('has a PGMaps symbol of the right kind for every role', () => {
    for (const { role, kind } of STYLE_ROLES) expect(defaultRoleSymbol(role).kind).toBe(kind)
  })
})
