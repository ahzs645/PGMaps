import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'

const holdDelayMs = 350
const repeatDelayMs = 100

const stepButtonClass =
  'flex touch-none select-none items-center justify-center leading-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring'

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
  const inputId = useId()
  const [entry, setEntry] = useState<{ requested: number; text: string } | null>(null)
  // A chart, the slider, playback or a table row selected another station: the entry is over.
  if (entry && entry.requested !== selected) setEntry(null)
  const text = entry?.requested === selected ? entry.text : null
  const finish = () => {
    setEntry(null)
    onCommit()
  }
  const step = (direction: 1 | -1) => {
    setEntry(null)
    onStep(direction)
  }
  const latestStep = useRef(step)
  const repeatTimer = useRef<number>()
  const didRepeat = useRef(false)
  useLayoutEffect(() => {
    latestStep.current = step
  })
  function stopRepeat() {
    window.clearTimeout(repeatTimer.current)
    repeatTimer.current = undefined
  }
  useEffect(() => {
    window.addEventListener('blur', stopRepeat)
    return () => {
      window.removeEventListener('blur', stopRepeat)
      stopRepeat()
    }
  }, [])
  function startRepeat(event: PointerEvent<HTMLButtonElement>, direction: 1 | -1) {
    if (!event.isPrimary || event.button !== 0) return
    stopRepeat()
    didRepeat.current = false
    function repeat() {
      didRepeat.current = true
      latestStep.current(direction)
      repeatTimer.current = window.setTimeout(repeat, repeatDelayMs)
    }
    repeatTimer.current = window.setTimeout(repeat, holdDelayMs)
  }
  const stopHandlers = {
    onPointerUp: stopRepeat,
    onPointerLeave: stopRepeat,
    onPointerCancel: stopRepeat,
  }
  return (
    <div className="road-station-entry flex shrink-0 items-center gap-1 text-xs">
      <label htmlFor={inputId} className="max-md:sr-only">
        Station
      </label>
      <div className="road-station-field flex rounded-md border border-input bg-background text-foreground focus-within:ring-1 focus-within:ring-ring">
        <input
          id={inputId}
          aria-label="Selected station metres"
          type="number"
          min={0}
          max={Math.ceil(length * 10) / 10}
          step="any"
          className="min-w-0 w-[4.5rem] rounded-l-md bg-transparent px-2 font-mono text-xs focus:outline-none sm:w-20"
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
              step(e.key === 'ArrowUp' ? 1 : -1)
            }
          }}
        />
        <div
          className="m-px grid w-6 shrink-0 grid-rows-2 overflow-hidden rounded-sm border border-input bg-muted/30"
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className={`${stepButtonClass} border-b border-input`}
            aria-label="Next road station"
            {...stopHandlers}
            onPointerDown={(event) => startRepeat(event, 1)}
            onClick={(event) => {
              if (event.detail === 0 || !didRepeat.current) step(1)
            }}
          >
            <ChevronUp className="size-2.5 max-md:size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={stepButtonClass}
            aria-label="Previous road station"
            {...stopHandlers}
            onPointerDown={(event) => startRepeat(event, -1)}
            onClick={(event) => {
              if (event.detail === 0 || !didRepeat.current) step(-1)
            }}
          >
            <ChevronDown className="size-2.5 max-md:size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}
