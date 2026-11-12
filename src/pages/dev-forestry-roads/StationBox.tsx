import { useState } from 'react'

/**
 * The station box of the station bar. The views follow each number as it is typed, but the text in
 * the box is the reader's until Enter or blur: where the typed station cannot be shown itself (a
 * terrain profile, or a road whose section cannot be evaluated there) the views show the nearest
 * calculated station, and writing that back into the box would rewrite the entry under the cursor.
 */
export function StationBox({
  selected,
  shown,
  length,
  onType,
  onCommit,
  onStep,
}: {
  /** The workspace's selected station. Any change the box did not ask for ends the entry. */
  selected: number
  /** The station the views show for it: the typed one, or the nearest calculated one. */
  shown: number
  length: number
  /** Selects exactly this station and returns it as held to the line. */
  onType: (entered: number) => number
  /** Enter or blur: the entry is finished, and the box shows the station the views resolved to. */
  onCommit: () => void
  /** Arrow up (1) or down (−1): the next or previous calculated station. */
  onStep: (direction: 1 | -1) => void
}) {
  const [entry, setEntry] = useState<{ requested: number; text: string } | null>(null)
  // A chart, the slider, playback or a table row selected another station: the entry is over.
  if (entry && entry.requested !== selected) setEntry(null)
  const text = entry?.requested === selected ? entry.text : null
  const finish = () => {
    setEntry(null)
    onCommit()
  }
  return (
    <label className="flex items-center gap-1 text-xs">
      {/* Narrow phones keep the slider on the same row; the input stays named. */}
      <span className="max-[399px]:sr-only">Station</span>{' '}
      <input
        aria-label="Selected station metres"
        type="number"
        min={0}
        max={Math.ceil(length * 10) / 10}
        step="any"
        className="w-[4.5rem] rounded-md border bg-background px-1 py-1 font-mono sm:w-20"
        title="Shows the section at exactly the station you type. Arrow keys select the next or previous calculated station."
        value={text ?? Number(shown.toFixed(1))}
        onChange={(e) => {
          const typed = e.target.value
          const value = Number(typed)
          // Empty or unfinished text ("", "-") keeps the selection where it is.
          setEntry({ requested: typed.trim() && Number.isFinite(value) ? onType(value) : selected, text: typed })
        }}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish()
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            setEntry(null)
            onStep(e.key === 'ArrowUp' ? 1 : -1)
          }
        }}
      />
    </label>
  )
}
