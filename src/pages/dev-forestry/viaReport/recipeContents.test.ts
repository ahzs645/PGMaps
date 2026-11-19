import { describe, expect, it } from 'vitest'

import {
  addablePartOptions,
  baseRecipeOf,
  editedEntries,
  editRecipeContents,
  entriesChange,
  entryKeys,
  ownCopy,
  recipeContents,
  recipeEntries,
  recipeModified,
  recipePresets,
} from './recipeContents'
import { partLabel } from './recipeMakeup'
import { findReportRecipe, REPORT_RECIPES } from './recipes'
import { copyRecipe, editRecipe, readOwnRecipe, storedRecipe } from './userRecipes'

/** A fixed "random" so ids are stable. */
const fixed = () => 0.5
const taken = () => ({
  ids: new Set(REPORT_RECIPES.map((recipe) => recipe.id)),
  names: new Set(REPORT_RECIPES.map((recipe) => recipe.name)),
})

describe('a VIA report recipe as its contents', () => {
  const sheets = findReportRecipe('form-2001-sheets')!
  const photos = findReportRecipe('form-2001-photos')!

  it('lists every part in print order, named by its title, each printing', () => {
    const { parts, places } = recipeContents(sheets, { base: sheets.parts })
    expect(parts.map((part) => part.label)).toEqual(sheets.parts.map(partLabel))
    expect(parts.every((part) => part.state === 'on')).toBe(true)
    expect(parts[0].key).toBe(`${sheets.parts[0]}#1`)
    expect(Object.values(places)).toEqual(sheets.parts.map((_, index) => index))
    // A shipped part is switched off, never removed; nothing says more than is known before the report is assembled.
    expect(parts.some((part) => part.removable)).toBe(false)
    expect(parts.some((part) => part.detail)).toBe(false)
    expect(parts.find((part) => part.key === 'inventory#1')?.help).toMatch(/^From reference document/)
  })

  it('makes the first change to a shipped recipe your own copy, in the same step, with the part off in its place', () => {
    const made = editRecipeContents(sheets, { kind: 'state', key: 'notes-2001#1', on: false }, taken(), fixed)!
    expect(made.copied).toBe(true)
    expect(made.recipe.own).toEqual({ basedOn: 'form-2001-sheets' })
    expect(made.recipe.name).toBe('2001 VIA summary form with analysis sheets (your copy)')
    expect(made.recipe.parts).toEqual(sheets.parts.filter((part) => part !== 'notes-2001'))
    expect(made.recipe.leftOut).toEqual([{ part: 'notes-2001', at: sheets.parts.indexOf('notes-2001') }])
    expect(recipeModified(made.recipe)).toBe(true)
    // The row stays, dimmed, where it was; the printing parts' places close up round it.
    const { parts, places } = recipeContents(made.recipe, { base: sheets.parts })
    expect(parts.map((part) => part.key)).toEqual(recipeContents(sheets).parts.map((part) => part.key))
    expect(parts.find((part) => part.key === 'notes-2001#1')?.state).toBe('off')
    expect(places['notes-2001#1']).toBeUndefined()
    expect(places['calculations#1']).toBe(sheets.parts.length - 2)
    // A later change edits that copy, and switched on again the part comes back where it was.
    const back = editRecipeContents(made.recipe, { kind: 'state', key: 'notes-2001#1', on: true }, taken(), fixed)!
    expect(back.copied).toBe(false)
    expect(back.recipe.id).toBe(made.recipe.id)
    expect(back.recipe.parts).toEqual(sheets.parts)
    expect(back.recipe.leftOut).toBeUndefined()
    expect(storedRecipe(back.recipe)).not.toHaveProperty('leftOut')
    expect(recipeModified(back.recipe)).toBe(false)
  })

  it('keeps an off part at its place through moves, and through storage', () => {
    const off = editRecipeContents(sheets, { kind: 'state', key: 'inventory#1', on: false }, taken(), fixed)!.recipe
    const keys = recipeContents(off).parts.map((part) => part.key)
    // Move the last part to the top: the off part moves down one place with everything else.
    const order = [keys[keys.length - 1], ...keys.slice(0, -1)]
    const moved = editRecipeContents(off, { kind: 'move', order }, taken(), fixed)!.recipe
    expect(recipeEntries(moved).map((entry) => `${entry.part}:${entry.on}`)).toEqual(
      order.map((key) => `${key.split('#')[0]}:${key !== 'inventory#1'}`),
    )
    const stored = readOwnRecipe(JSON.parse(JSON.stringify(storedRecipe(moved)))).recipe!
    expect(recipeEntries(stored)).toEqual(recipeEntries(moved))
  })

  it('merges the parts switched off back in at their places, whatever order they are stored in', () => {
    const entries = [
      { part: 'a', on: false },
      { part: 'b', on: true },
      { part: 'c', on: false },
      { part: 'd', on: true },
      { part: 'e', on: false },
    ]
    const change = entriesChange(entries)
    expect(change).toEqual({
      parts: ['b', 'd'],
      leftOut: [
        { part: 'a', at: 0 },
        { part: 'c', at: 2 },
        { part: 'e', at: 4 },
      ],
    })
    expect(recipeEntries({ parts: change.parts, leftOut: [...change.leftOut!].reverse() })).toEqual(entries)
  })

  it('keys a part held twice by which time the list holds it, so each row stays its own', () => {
    const twice = editRecipe(copyRecipe(sheets, new Set(), fixed), { parts: [...sheets.parts, 'inventory'] })
    const keys = entryKeys(recipeEntries(twice))
    expect(keys.filter((key) => key.startsWith('inventory#'))).toEqual(['inventory#1', 'inventory#2'])
    expect(new Set(keys).size).toBe(keys.length)
    // The second is one you added: it is removed, the first is only switched off.
    const { parts } = recipeContents(twice, { base: sheets.parts })
    expect(parts.find((part) => part.key === 'inventory#2')?.removable).toBe(true)
    expect(parts.find((part) => part.key === 'inventory#1')?.removable).toBeUndefined()
    const removed = editRecipeContents(twice, { kind: 'remove', key: 'inventory#2' }, taken(), fixed)!.recipe
    expect(removed.parts).toEqual(sheets.parts)
  })

  it('adds a shared part at the end, by id, and refuses one PGMaps does not have', () => {
    const added = editRecipeContents(sheets, { kind: 'add', part: 'overview-map' }, taken(), fixed)!
    expect(added.copied).toBe(true)
    expect(added.recipe.parts.at(-1)).toBe('overview-map')
    expect(editedEntries(sheets, { kind: 'add', part: 'no-such-part' })).toBeNull()
    const options = addablePartOptions()
    expect(options.find((option) => option.id === 'overview-map')?.label).toBe(partLabel('overview-map'))
    // Grouped by where each comes from, each group together.
    const groups = options.map((option) => option.group)
    expect(groups.filter((group, index) => groups.indexOf(group) !== index && groups[index - 1] !== group)).toEqual([])
  })

  it('pins the cover first while the layout has a cover, and refuses a move off the top', () => {
    const { parts } = recipeContents(photos)
    expect(parts[0]).toMatchObject({ key: 'cover#1', pinned: true })
    expect(parts.slice(1).some((part) => part.pinned)).toBe(false)
    const keys = parts.map((part) => part.key)
    expect(editedEntries(photos, { kind: 'move', order: [keys[1], keys[0], ...keys.slice(2)] })).toBeNull()
    // Without a cover page the cover part is a part like any other.
    const rationale = findReportRecipe('design-rationale')!
    expect(rationale.layout?.cover).toBe(false)
    expect(recipeContents(rationale).parts[0].pinned).toBeUndefined()
  })

  it('never lets the last part printing go', () => {
    const one = editRecipe(copyRecipe(sheets, new Set(), fixed), {
      parts: ['inventory'],
      leftOut: [{ part: 'sign-off', at: 1 }],
    })
    const { parts } = recipeContents(one, { base: sheets.parts })
    expect(parts[0]).toMatchObject({ key: 'inventory#1', state: 'on' })
    expect(parts[0].locked).toBeTruthy()
    expect(parts[0].removable).toBeUndefined()
    expect(editedEntries(one, { kind: 'state', key: 'inventory#1', on: false })).toBeNull()
    expect(editedEntries(one, { kind: 'remove', key: 'inventory#1' })).toBeNull()
    // An edit that changes nothing changes nothing.
    expect(editRecipeContents(one, { kind: 'state', key: 'sign-off#1', on: false }, taken())).toBeNull()
    expect(editedEntries(one, { kind: 'move', order: ['inventory#1', 'sign-off#1'] })).toBeNull()
  })

  it('says what is known of each part once the report is assembled, and its page once the draft has pages', () => {
    const facts = sheets.parts.map((_, index) => ({ printed: index !== 1, toComplete: index === 2 ? 3 : 0 }))
    const pages = sheets.parts.map((_, index) => index + 1)
    const { parts } = recipeContents(sheets, { facts, pages })
    expect(parts[0].detail).toBe('p. 1')
    expect(parts[1].detail).toBe('p. 2 · prints nothing for this assessment')
    expect(parts[2].detail).toBe('p. 3 · 3 to complete')
    // Read by place among the printing parts: an off part has none, and the next takes the place it left.
    const off = editRecipeContents(sheets, { kind: 'state', key: `${sheets.parts[0]}#1`, on: false }, taken())!
    const shifted = recipeContents(off.recipe, { facts, pages }).parts
    expect(shifted[0].detail).toBeUndefined()
    expect(shifted[1].detail).toBe('p. 1')
  })

  it('names a copy so that it never takes a name in use, nor a typed one', () => {
    // A "random" that moves on, so a taken id is not drawn again for ever.
    let n = 0
    const counting = () => (n++ % 97) / 97
    const names = taken()
    const first = ownCopy(sheets, names, undefined, counting)
    names.ids = new Set([...names.ids, first.id])
    names.names = new Set([...names.names, first.name])
    const second = ownCopy(sheets, names, undefined, counting)
    expect(second.name).toBe(`${first.name} 2`)
    expect(second.id).not.toBe(first.id)
    const typed = ownCopy(sheets, names, 'Our district report', counting)
    expect(typed.name).toBe('Our district report')
    expect(typed.id).toMatch(/^own-our-district-report-/)
    expect(typed.own).toEqual({ basedOn: 'form-2001-sheets' })
  })

  it('offers the recipes as presets: shipped first, then your own as saved, each by name', () => {
    const own = copyRecipe(sheets, new Set(), fixed)
    const presets = recipePresets([...REPORT_RECIPES, own])
    expect(presets.slice(0, REPORT_RECIPES.length).map((preset) => preset.label)).toEqual(
      REPORT_RECIPES.map((recipe) => recipe.name),
    )
    expect(presets.at(-1)).toEqual({ id: own.id, label: own.name, saved: true })
    expect(baseRecipeOf(own)?.id).toBe('form-2001-sheets')
    expect(baseRecipeOf(sheets)?.id).toBe('form-2001-sheets')
    // A copy not yet changed reads as its recipe; a changed title is a change.
    expect(recipeModified(own)).toBe(false)
    expect(recipeModified(editRecipe(own, { title: 'Another title' }))).toBe(true)
    expect(recipeModified(sheets)).toBe(false)
  })
})
