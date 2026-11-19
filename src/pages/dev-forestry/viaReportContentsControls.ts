/**
 * The controls of the VIA report's contents list (`DocumentContents`), for Save & export's *What goes in* and the own
 * recipe's editor alike, so the one list behaves the same in both. The rules are `viaReport/recipeContents.ts`; this
 * file writes their result to this browser's recipes (`userRecipeStore.ts`) and chooses it as the package's recipe
 * (`onChoose`, the same state as *Package recipe*). Never a per-output recipe, never a scene or a project file.
 */
import type { ContentsControls } from './VisualsExportDialog'
import { deleteOwnRecipe, putOwnRecipe } from './userRecipeStore'
import {
  addablePartOptions,
  baseRecipeOf,
  editRecipeContents,
  ownCopy,
  recipeModified,
  recipePresets,
  type ContentsEdit,
} from './viaReport/recipeContents'
import type { ReportRecipe } from './viaReport/recipes'

export function recipeContentsControls({
  recipe,
  recipes,
  onChoose,
  presets = true,
}: {
  /** The package's recipe, shown in the list. */
  recipe: ReportRecipe
  /** Every recipe, shipped and own: the presets, and the ids and names a copy must not take. */
  recipes: readonly ReportRecipe[]
  /** Chooses the package's recipe (null: none, the VIA document's format chooses). */
  onChoose: (id: string | null) => void
  /** Draw the preset row; off where the recipe is chosen beside the list already. */
  presets?: boolean
}): ContentsControls {
  const taken = { ids: new Set(recipes.map((entry) => entry.id)), names: new Set(recipes.map((entry) => entry.name)) }
  // The first change to a shipped recipe makes the person's own copy and chooses it, in the same step.
  const apply = (edit: ContentsEdit) => {
    const next = editRecipeContents(recipe, edit, taken)
    if (!next) return
    putOwnRecipe(next.recipe)
    if (next.copied) onChoose(next.recipe.id)
  }
  const base = baseRecipeOf(recipe)
  return {
    onState: (key, state) => apply({ kind: 'state', key, on: state === 'on' }),
    onMove: (_key, _to, order) => apply({ kind: 'move', order }),
    onRemove: (key) => apply({ kind: 'remove', key }),
    add: {
      label: 'Add a part…',
      options: addablePartOptions(),
      onAdd: (part) => apply({ kind: 'add', part }),
    },
    ...(presets
      ? {
          presets: {
            options: recipePresets(recipes),
            value: recipe.id,
            modified: recipeModified(recipe),
            onChoose: (id: string) => onChoose(id),
            // Back to the shipped recipe it was copied from; the copy stays in the library.
            onReset: () => onChoose(base?.id ?? recipe.id),
            onSaveAs: (name: string) => {
              const copy = ownCopy(recipe, taken, name)
              putOwnRecipe(copy)
              onChoose(copy.id)
            },
            onDelete: (id: string) => {
              const deleted = recipes.find((entry) => entry.id === id)
              deleteOwnRecipe({ id })
              if (id === recipe.id) onChoose(deleted?.own?.basedOn ?? null)
            },
            deleteDetail: `It is removed from this browser${
              base ? `, and the report goes back to ${base.name}` : ''
            }. A file shared from it keeps it.`,
          },
        }
      : {}),
  }
}
