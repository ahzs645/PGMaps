import { useState } from 'react'
import { ArrowDown, ArrowUp, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FileButton } from '@/components/ui/file-button'
import {
  CheckboxField,
  FORM_INPUT_CLASS,
  FormField,
  NullableNumberField,
  SelectField,
  StyledSelect,
} from '@/components/ui/form-field'
import { insetBox } from '@/components/ui/inset-box'
import { InlineAlert } from '@/components/ui/map-panels'
import { TextButton } from '@/components/ui/text-button'
import { downloadBlob } from '@/lib/download'
import { VIA_STYLE_PRESETS } from '@/lib/forestry/viaFigure/presets'
import { cn } from '@/lib/utils'

import { DEFAULT_OVERVIEW_SHEET_STYLE, OVERVIEW_SHEET_STYLES, type OverviewSheetStyle } from './reportMaps'
import { deleteOwnRecipe, putOwnRecipe, type OwnRecipes } from './userRecipeStore'
import { VIA_DOCUMENT_FORMATS } from './viaDocument/formats'
import { partCatalogue, partLabel } from './viaReport/recipeMakeup'
import { DEFAULT_OBLIQUE_PITCH, type ReportRecipe } from './viaReport/recipes'
import {
  copyRecipe,
  editRecipe,
  OBLIQUE_PITCH_RANGE,
  PAPER_SIZES,
  readRecipeFile,
  RECIPE_OPTION_FIELDS,
  recipeFileName,
  recipeFileText,
} from './viaReport/userRecipes'

const iconButton =
  'inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40'

/**
 * Your own recipe's choices, each written to this browser as it changes: its name and report title, the document
 * format, the figure style, the paper, cover and contents, the recipe options, the oblique renders' pitch, the overview
 * sheet, and its parts in order, each added from the shared parts and never copied.
 */
export function RecipeEditor({ recipe }: { recipe: ReportRecipe }) {
  const change = (next: Parameters<typeof editRecipe>[1]) => putOwnRecipe(editRecipe(recipe, next))
  const [adding, setAdding] = useState('')
  const catalogue = partCatalogue()
  const layout = { paper: 'letter' as const, cover: false, contents: false, ...recipe.layout }
  const move = (from: number, to: number) => {
    const parts = [...recipe.parts]
    const [part] = parts.splice(from, 1)
    parts.splice(to, 0, part)
    change({ parts })
  }
  const setOption = (key: string, value: unknown) => {
    const options: Record<string, unknown> = { ...recipe.options }
    if (value === undefined) delete options[key]
    else options[key] = value
    change({ options: options as ReportRecipe['options'] })
  }
  return (
    <div className="grid min-w-0 gap-3" aria-label="Edit your recipe">
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        <FormField label="Name">
          <input
            className={FORM_INPUT_CLASS}
            value={recipe.name}
            maxLength={200}
            onChange={(event) => event.target.value.trim() && change({ name: event.target.value })}
          />
        </FormField>
        <FormField label="Report title">
          <input
            className={FORM_INPUT_CLASS}
            value={recipe.title}
            maxLength={200}
            onChange={(event) => event.target.value.trim() && change({ title: event.target.value })}
          />
        </FormField>
      </div>
      <SelectField
        label="Document format"
        description="Its percent alteration, scales and wording; the VIA document takes the same format."
        value={recipe.format}
        onChange={(event) => change({ format: event.target.value })}
      >
        {VIA_DOCUMENT_FORMATS.map((format) => (
          <option key={format.id} value={format.id}>
            {format.name} ({format.sources.join(', ')})
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Figure style"
        value={recipe.figureStyle ?? ''}
        onChange={(event) => change({ figureStyle: event.target.value || undefined })}
      >
        <option value="">The document format’s own</option>
        {VIA_STYLE_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </SelectField>
      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
        <SelectField
          label="Paper"
          value={layout.paper}
          onChange={(event) => change({ layout: { ...layout, paper: event.target.value as 'letter' | 'legal' } })}
        >
          {PAPER_SIZES.map((paper) => (
            <option key={paper.value} value={paper.value}>
              {paper.label}
            </option>
          ))}
        </SelectField>
        <CheckboxField
          label="Cover page"
          checked={layout.cover}
          onCheckedChange={(cover) => change({ layout: { ...layout, cover } })}
        />
        <CheckboxField
          label="Contents"
          checked={layout.contents}
          onCheckedChange={(contents) => change({ layout: { ...layout, contents } })}
        />
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        <NullableNumberField
          label="Oblique renders’ pitch"
          unit="°"
          description={`${DEFAULT_OBLIQUE_PITCH}° looks down on the blocks (01); about 75° stands near eye level (02).`}
          min={OBLIQUE_PITCH_RANGE.min}
          max={OBLIQUE_PITCH_RANGE.max}
          value={recipe.obliquePitch ?? null}
          updateOn="commit"
          onValueChange={(value) => change({ obliquePitch: value ?? undefined })}
        />
        <SelectField
          label="Overview sheet"
          value={recipe.overviewSheetStyle ?? DEFAULT_OVERVIEW_SHEET_STYLE}
          onChange={(event) => change({ overviewSheetStyle: event.target.value as OverviewSheetStyle })}
        >
          {OVERVIEW_SHEET_STYLES.map((style) => (
            <option key={style.id} value={style.id}>
              {style.label}
            </option>
          ))}
        </SelectField>
      </div>
      <fieldset className="grid min-w-0 gap-1.5">
        <legend className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Options</legend>
        {RECIPE_OPTION_FIELDS.map((field) => {
          const value = recipe.options?.[field.key]
          if (field.kind === 'flag')
            return (
              <CheckboxField
                key={field.key}
                label={field.label}
                checked={typeof value === 'boolean' ? value : field.whenAbsent}
                onCheckedChange={(on) => setOption(field.key, on === field.whenAbsent ? undefined : on)}
              />
            )
          if (field.kind === 'choice')
            return (
              <SelectField
                key={field.key}
                label={field.label}
                value={typeof value === 'string' ? value : field.whenAbsent}
                onChange={(event) =>
                  setOption(field.key, event.target.value === field.whenAbsent ? undefined : event.target.value)
                }
              >
                {field.choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </SelectField>
            )
          return (
            <NullableNumberField
              key={field.key}
              label={field.label}
              description="Blank: pictures keep their own shape."
              min={field.min}
              max={field.max}
              step={field.step}
              value={typeof value === 'number' ? value : null}
              updateOn="commit"
              onValueChange={(next) => setOption(field.key, next ?? undefined)}
            />
          )
        })}
      </fieldset>
      <section className="grid min-w-0 gap-1.5" aria-label="Parts">
        <h5 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Parts, in print order</h5>
        <ol className={cn(insetBox({ padding: 'none' }), 'divide-y overflow-hidden')}>
          {recipe.parts.map((id, index) => {
            const part = catalogue.find((entry) => entry.id === id)
            return (
              <li key={`${index}-${id}`} className="flex min-w-0 items-center gap-1.5 px-2 py-1 text-xs">
                <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate" title={id}>
                  {partLabel(id)}
                  {part?.sources.length ? (
                    <span className="text-muted-foreground"> · {part.sources.join(', ')}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className={iconButton}
                  aria-label={`Move ${partLabel(id)} up`}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  className={iconButton}
                  aria-label={`Move ${partLabel(id)} down`}
                  disabled={index === recipe.parts.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  className={iconButton}
                  aria-label={`Remove ${partLabel(id)}`}
                  disabled={recipe.parts.length === 1}
                  onClick={() => change({ parts: recipe.parts.filter((_, at) => at !== index) })}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            )
          })}
        </ol>
        <div className="flex min-w-0 items-center gap-2">
          <StyledSelect
            aria-label="Part to add"
            className="min-w-0 flex-1 rounded-md border bg-background p-1"
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
          >
            <option value="">Add a shared part…</option>
            {catalogue.map((part) => (
              <option key={part.id} value={part.id}>
                {partLabel(part.id)} · {part.sources.join(', ') || 'PGMaps'}
                {recipe.parts.includes(part.id) ? ' (in this recipe)' : ''}
              </option>
            ))}
          </StyledSelect>
          <Button
            variant="outline"
            size="sm"
            disabled={!adding}
            onClick={() => {
              change({ parts: [...recipe.parts, adding] })
              setAdding('')
            }}
          >
            Add at the end
          </Button>
        </div>
      </section>
    </div>
  )
}

/**
 * The package's own-recipe tools under the recipe: make a copy of the recipe in use, import a shared recipe file, and
 * for one of your own, edit it, share it as a file or delete it. Recipes live in this browser (`userRecipeStore.ts`).
 */
export function OwnRecipeTools({
  current,
  recipes,
  own,
  onChoose,
}: {
  /** The recipe the package uses now. */
  current: ReportRecipe
  /** Every recipe, built-in and your own, for the ids and names an import must not take. */
  recipes: readonly ReportRecipe[]
  own: OwnRecipes
  onChoose: (id: string | null) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const taken = {
    ids: new Set(recipes.map((recipe) => recipe.id)),
    names: new Set(recipes.map((recipe) => recipe.name)),
  }
  const isOwn = !!current.own
  const makeCopy = () => {
    const copy = copyRecipe(current, taken.ids)
    putOwnRecipe(copy)
    onChoose(copy.id)
    setEditing(copy.id)
    setMessage(null)
  }
  const importFile = async (files: File[]) => {
    const file = files[0]
    if (!file) return
    const read = readRecipeFile(await file.text(), taken)
    if (!read.recipe) {
      setMessage({ tone: 'error', text: `${file.name} was not imported. ${read.error}` })
      return
    }
    putOwnRecipe(read.recipe)
    onChoose(read.recipe.id)
    setMessage({ tone: 'success', text: `Imported ${read.recipe.name}.` })
  }
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={makeCopy}>
          Make a copy
        </Button>
        <FileButton
          label="Import a recipe file"
          accept=".json,application/json"
          onFiles={(files) => void importFile(files)}
        >
          Import…
        </FileButton>
        {isOwn && (
          <>
            <Button
              variant="outline"
              size="sm"
              aria-expanded={editing === current.id}
              onClick={() => setEditing(editing === current.id ? null : current.id)}
            >
              {editing === current.id ? 'Done editing' : 'Edit'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadBlob(
                  new Blob([recipeFileText(current, new Date())], { type: 'application/json' }),
                  recipeFileName(current),
                )
              }
            >
              Share as a file
            </Button>
            {confirmDelete ? (
              <span className="flex items-center gap-2 text-2xs">
                Delete {current.name} from this browser?
                <TextButton
                  className="text-2xs text-destructive"
                  onClick={() => {
                    deleteOwnRecipe({ id: current.id })
                    onChoose(current.own?.basedOn ?? null)
                    setConfirmDelete(false)
                    setEditing(null)
                  }}
                >
                  Delete
                </TextButton>
                <TextButton className="text-2xs" onClick={() => setConfirmDelete(false)}>
                  Keep
                </TextButton>
              </span>
            ) : (
              <TextButton className="text-2xs" onClick={() => setConfirmDelete(true)}>
                Delete
              </TextButton>
            )}
          </>
        )}
      </div>
      <p className="text-2xs text-muted-foreground">
        {isOwn
          ? 'Your own recipe, kept in this browser for every assessment. Share it as a file to use it in another browser.'
          : 'Make a copy to change this recipe: its parts, their order, the format, the figure style, the paper and the options. Copies are kept in this browser.'}
      </p>
      {message && <InlineAlert tone={message.tone}>{message.text}</InlineAlert>}
      {own.writeError && <InlineAlert tone="warning">{own.writeError}</InlineAlert>}
      {own.unreadable.map((entry) => (
        <InlineAlert key={entry.index} tone="warning">
          A recipe kept in this browser no longer reads: {entry.error}{' '}
          <TextButton className="text-2xs" onClick={() => deleteOwnRecipe({ index: entry.index })}>
            Delete it
          </TextButton>
        </InlineAlert>
      ))}
      {isOwn && editing === current.id && (
        <div className={cn(insetBox({ padding: 'sm' }), 'min-w-0')}>
          <RecipeEditor recipe={current} />
        </div>
      )}
    </div>
  )
}
