import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReportRecipe } from './viaReport/recipes'

const store = vi.hoisted(() => ({ put: [] as ReportRecipe[], deleted: [] as unknown[] }))
vi.mock('./userRecipeStore', () => ({
  putOwnRecipe: (recipe: ReportRecipe) => store.put.push(recipe),
  deleteOwnRecipe: (target: unknown) => store.deleted.push(target),
}))

const { recipeContentsControls } = await import('./viaReportContentsControls')
const { findReportRecipe, REPORT_RECIPES } = await import('./viaReport/recipes')

describe('the VIA report contents controls', () => {
  const sheets = findReportRecipe('form-2001-sheets')!
  beforeEach(() => {
    store.put = []
    store.deleted = []
  })

  it('writes the first change to a shipped recipe as your own copy and chooses it as the package’s recipe', () => {
    const onChoose = vi.fn()
    const controls = recipeContentsControls({ recipe: sheets, recipes: REPORT_RECIPES, onChoose })
    controls.onState!('notes-2001#1', 'off')
    expect(store.put).toHaveLength(1)
    const copy = store.put[0]
    expect(copy.own).toEqual({ basedOn: 'form-2001-sheets' })
    expect(copy.leftOut).toEqual([{ part: 'notes-2001', at: sheets.parts.indexOf('notes-2001') }])
    expect(onChoose).toHaveBeenCalledWith(copy.id)
    // A later change edits that copy in place and chooses nothing new.
    onChoose.mockClear()
    const later = recipeContentsControls({ recipe: copy, recipes: [...REPORT_RECIPES, copy], onChoose })
    later.onState!('notes-2001#1', 'on')
    expect(store.put[1].id).toBe(copy.id)
    expect(store.put[1].parts).toEqual(sheets.parts)
    expect(onChoose).not.toHaveBeenCalled()
    // It reads as modified from the recipe it was copied from, and Reset goes back to that recipe.
    expect(later.presets?.modified).toBe(true)
    const restored = store.put[1]
    expect(recipeContentsControls({ recipe: restored, recipes: [restored], onChoose }).presets?.modified).toBe(false)
    later.presets!.onReset!()
    expect(onChoose).toHaveBeenCalledWith('form-2001-sheets')
    expect(store.deleted).toEqual([])
  })

  it('saves a copy under the typed name, and deleting the recipe in use goes back to the one it was copied from', () => {
    const onChoose = vi.fn()
    recipeContentsControls({ recipe: sheets, recipes: REPORT_RECIPES, onChoose }).presets!.onSaveAs!('District form')
    const named = store.put[0]
    expect(named.name).toBe('District form')
    expect(onChoose).toHaveBeenCalledWith(named.id)
    const own = recipeContentsControls({ recipe: named, recipes: [...REPORT_RECIPES, named], onChoose })
    expect(own.presets?.options.at(-1)).toEqual({ id: named.id, label: 'District form', saved: true })
    own.presets!.onDelete!(named.id)
    expect(store.deleted).toEqual([{ id: named.id }])
    expect(onChoose).toHaveBeenLastCalledWith('form-2001-sheets')
  })

  it('offers no preset row where the recipe is chosen beside the list', () => {
    const controls = recipeContentsControls({
      recipe: sheets,
      recipes: REPORT_RECIPES,
      onChoose: () => {},
      presets: false,
    })
    expect(controls.presets).toBeUndefined()
    expect(controls.add?.options.length).toBeGreaterThan(10)
  })
})
