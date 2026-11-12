import { useState } from 'react'
import { Pencil, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { Field, roadFieldClass, RoadSelect } from './Controls'
import type { CableRigging } from './cableMechanics'
import {
  deleteRiggingSet,
  matchingRiggingSet,
  renameRiggingSet,
  riggingSetNameError,
  riggingSetNamed,
  saveRiggingSet,
  type RiggingSet,
  type RiggingSetLimits,
} from './dline/riggingSets'

const EDITED = ''

/**
 * The project's named rigging sets beside one rigging: choose a set to apply it, save the rigging
 * shown as a set (a set of the same name is updated), rename or delete the chosen set. Shared by
 * D-lines and the extraction reach's cable yarder.
 */
export function RiggingSetPicker({
  sets,
  rigging,
  limits,
  onApply,
  onSetsChange,
  ignoreTensionMode = false,
  newId = () => crypto.randomUUID(),
}: {
  sets: readonly RiggingSet[]
  rigging: CableRigging
  /** Saved with the rigging when given (a D-line's saddle-angle limits). */
  limits?: RiggingSetLimits
  onApply: (set: RiggingSet) => void
  onSetsChange: (sets: RiggingSet[]) => void
  /** Block coverage always tensions to the allowable, so a set matches whatever its tension mode. */
  ignoreTensionMode?: boolean
  newId?: () => string
}) {
  const matched = matchingRiggingSet(sets, rigging, { ignoreTensionMode })
  const [chosenId, setChosenId] = useState<string | null>(null)
  const chosen = sets.find((set) => set.id === chosenId) ?? matched
  const [editing, setEditing] = useState<{ mode: 'save' | 'rename'; name: string } | null>(null)
  const [error, setError] = useState('')
  const nameError = editing
    ? riggingSetNameError(
        // Saving over a set of the same name updates it, so only a rename can clash.
        editing.mode === 'rename' ? sets : [],
        editing.name,
        editing.mode === 'rename' ? chosen?.id : undefined,
      )
    : null
  const finish = () => {
    if (!editing || nameError) return
    try {
      onSetsChange(
        editing.mode === 'save'
          ? saveRiggingSet(sets, editing.name, rigging, limits, newId)
          : renameRiggingSet(sets, chosen!.id, editing.name),
      )
      setEditing(null)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the rigging set.')
    }
  }
  const updating = editing?.mode === 'save' && !!riggingSetNamed(sets, editing.name)
  return (
    <div className="space-y-1" data-testid="rigging-set-picker">
      <div className="flex items-end gap-1">
        <div className="min-w-0 flex-1">
          <Field
            label="Rigging set"
            hint="The project's own rope, carriage and load. Choosing one fills the rigging; editing a value afterwards leaves the set unchanged until it is saved again."
          >
            <RoadSelect
              ariaLabel="Rigging set"
              className={roadFieldClass}
              value={matched?.id ?? EDITED}
              onValueChange={(id) => {
                const set = sets.find((s) => s.id === id)
                if (!set) return
                setChosenId(set.id)
                onApply(set)
              }}
              options={[
                {
                  value: EDITED,
                  label: sets.length ? 'Not a saved set' : 'No saved sets yet',
                  disabled: true,
                },
                ...sets.map((set) => ({ value: set.id, label: set.name })),
              ]}
            />
          </Field>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="Save this rigging as a set"
          title="Save this rigging as a set"
          onClick={() => setEditing({ mode: 'save', name: chosen?.name ?? '' })}
        >
          <Save className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          disabled={!chosen}
          aria-label={chosen ? `Rename rigging set ${chosen.name}` : 'Rename rigging set'}
          title="Rename the set"
          onClick={() => chosen && setEditing({ mode: 'rename', name: chosen.name })}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          disabled={!chosen}
          aria-label={chosen ? `Delete rigging set ${chosen.name}` : 'Delete rigging set'}
          title="Delete the set (Undo brings it back)"
          onClick={() => {
            if (!chosen) return
            onSetsChange(deleteRiggingSet(sets, chosen.id))
            setChosenId(null)
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {editing && (
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <input
              className={roadFieldClass}
              aria-label={editing.mode === 'save' ? 'New rigging set name' : 'Rigging set name'}
              placeholder="Set name, e.g. Madill 071 · 22 mm"
              value={editing.name}
              maxLength={120}
              autoFocus
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  finish()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  setEditing(null)
                }
              }}
            />
            {(nameError || error) && editing.name && (
              <p className="mt-0.5 text-2xs text-destructive">{nameError ?? error}</p>
            )}
          </div>
          <Button size="field" disabled={!!nameError} onClick={finish}>
            {editing.mode === 'rename' ? 'Rename' : updating ? 'Update' : 'Save'}
          </Button>
          <Button size="field" variant="ghost" onClick={() => setEditing(null)}>
            Cancel
          </Button>
        </div>
      )}
      <p className="flex items-center gap-1 text-2xs text-muted-foreground">
        {matched ? `Using ${matched.name}` : chosen ? `Edited since ${chosen.name}` : 'Rigging not saved as a set'}
        {sets.length ? ` · ${sets.length} set${sets.length === 1 ? '' : 's'} in the project` : ''}
        <InfoTip label="About rigging sets">
          A set holds the rope, carriage, load and load clearance{limits ? ', and the saddle-angle limits' : ''}. Sets
          are kept in the project file and shared by every D-line and the extraction reach&apos;s cable yarder. They are
          your own entries, not equipment ratings.
        </InfoTip>
      </p>
    </div>
  )
}
