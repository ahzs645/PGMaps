import { useId, useState } from 'react'
import { Info } from 'lucide-react'

/** Short, keyboard-accessible help that also opens on touch. */
export function PegMeasurementHelp() {
  const label = 'About peg measurements'
  const id = useId()
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        className="inline-flex items-center gap-1 rounded px-1 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            setOpen(false)
          }
        }}
      >
        <Info className="size-3.5" aria-hidden="true" /> {label}
      </button>
      {open && (
        <span
          role="tooltip"
          id={id}
          className="absolute left-0 top-full z-50 mt-1 w-72 max-w-[75vw] rounded-lg border bg-popover p-3 text-xs leading-5 text-popover-foreground shadow-lg"
        >
          HD and grade describe straight peg-to-peg legs. Editing a distance or bearing moves that peg; adjacent legs
          and the fitted road recalculate. Ground-grade search changes the bearing, preserving leg length. Design PVIs
          remain separate.
        </span>
      )}
    </span>
  )
}
