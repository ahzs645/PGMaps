/**
 * *Two candidates*, the Camera tab's third view (doc section **A photo of your own**, *The Camera tab*): any two rows of
 * the options card side by side, beside the photo, with where their model views differ. The rows are the card's own and
 * their views the ones drawn ahead for it, so nothing is drawn or searched here; *Use* makes a row the camera, as the
 * card's own button does.
 */
import { useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { SelectField } from '@/components/ui/form-field'

import { sameCamera } from './photoAcceptance'
import type { PhotoOption } from './photoOptions'
import { modelViewFor, ownAcceptancePose } from './PhotoOptionsCard'
import type { FieldPhotoState, ModelViewImage } from './useFieldPhoto'

/** The rows that can be compared: those whose model view has been drawn. */
export function comparableRows(photo: FieldPhotoState): Array<{ option: PhotoOption; view: ModelViewImage }> {
  const own = photo.own
  if (!own) return []
  const work = photo.workFor(own.id)
  return photo.optionsFor(own.id).flatMap((option) => {
    const view = modelViewFor(work, option.pose)
    return view ? [{ option, view }] : []
  })
}

export function PhotoCandidatePair({
  photo,
  active,
  picked,
  onPick,
}: {
  photo: FieldPhotoState
  active: boolean
  /** The rows chosen, left and right, by id; null for the default (the camera in use, the strongest other row). */
  picked: readonly [string | null, string | null]
  onPick: (picked: [string | null, string | null]) => void
}) {
  const own = photo.own
  const rows = own ? comparableRows(photo) : []
  const current = ownAcceptancePose(own)
  const inUse = rows.find((row) => current && sameCamera(row.option.pose, current))
  // The camera in use against the strongest other row, until the reviewer picks.
  const first = rows.find((row) => row.option.id === picked[0]) ?? inUse ?? rows[0]
  const second =
    rows.find((row) => row.option.id === picked[1] && row !== first) ?? rows.find((row) => row !== first) ?? null
  if (!own || !active) return null
  if (rows.length < 2)
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
        Two rows of the options need their model views first; they are drawn by themselves as the options arrive.
      </p>
    )
  const choose = (slot: 0 | 1, id: string) => onPick(slot === 0 ? [id, picked[1]] : [picked[0], id])
  return (
    <div className="space-y-2" aria-label="Two candidates side by side">
      <div className="grid grid-cols-2 gap-2">
        {([first, second] as const).map((row, slot) => (
          <SelectField
            key={slot}
            label={slot === 0 ? 'Left' : 'Right'}
            value={row?.option.id ?? ''}
            onChange={(event) => choose(slot as 0 | 1, event.currentTarget.value)}
          >
            {rows.map(({ option }) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </SelectField>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 text-3xs text-muted-foreground">
        {([first, second] as const).map((row, slot) =>
          row ? (
            <figure key={slot} className="space-y-1">
              <img
                src={row.view.url}
                alt={`${row.option.label}: model view at heading ${row.view.bearing.toFixed(0)}°`}
                className="w-full rounded-sm bg-muted"
              />
              <figcaption className="flex items-center justify-between gap-2 tabular-nums">
                <span className="min-w-0">
                  {row.option.label} · {row.view.bearing.toFixed(0)}°
                  {Number.isFinite(row.view.score) ? ` · agreement ${row.view.score.toFixed(2)}` : ''}
                </span>
                {current && sameCamera(row.option.pose, current) ? (
                  <span className="shrink-0 text-foreground">In use</span>
                ) : (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    className="shrink-0 touch:h-10"
                    aria-label={`Use ${row.option.label.toLowerCase()}`}
                    onClick={() => photo.chooseOption(own.id, row.option.id)}
                  >
                    Use
                  </Button>
                )}
              </figcaption>
            </figure>
          ) : null,
        )}
        {/* The two views first, under their pickers; the photo and where they differ under them. */}
        <figure>
          <img src={own.src} alt="Your photo" className="w-full rounded-sm" />
          <figcaption>Photo</figcaption>
        </figure>
        <Difference a={first?.view ?? null} b={second?.view ?? null} />
      </div>
    </div>
  )
}

/** Bright where two model views differ: where the two cameras would show the photo different ground. */
function Difference({ a, b }: { a: ModelViewImage | null; b: ModelViewImage | null }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const target = canvas.current
    if (!target || !a || !b) return
    let stopped = false
    const load = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = reject
        image.src = src
      })
    void Promise.all([load(a.url), load(b.url)])
      .then(([first, second]) => {
        if (stopped) return
        const width = first.naturalWidth
        const height = first.naturalHeight
        target.width = width
        target.height = height
        const context = target.getContext('2d')
        if (!context) return
        context.drawImage(first, 0, 0)
        const one = context.getImageData(0, 0, width, height)
        context.clearRect(0, 0, width, height)
        context.drawImage(second, 0, 0, width, height)
        const two = context.getImageData(0, 0, width, height)
        const out = context.createImageData(width, height)
        for (let i = 0; i < out.data.length; i += 4) {
          if (!one.data[i + 3] || !two.data[i + 3]) continue
          const d =
            (Math.abs(one.data[i] - two.data[i]) +
              Math.abs(one.data[i + 1] - two.data[i + 1]) +
              Math.abs(one.data[i + 2] - two.data[i + 2])) /
            3
          out.data[i] = out.data[i + 1] = out.data[i + 2] = Math.min(255, d * 2)
          out.data[i + 3] = 255
        }
        context.putImageData(out, 0, 0)
      })
      .catch(() => {
        /* A view that failed to load leaves the difference blank. */
      })
    return () => {
      stopped = true
    }
  }, [a, b])
  return (
    <figure>
      <canvas ref={canvas} className="w-full rounded-sm bg-muted" aria-label="Where the two model views differ" />
      <figcaption>Difference: bright where the two differ</figcaption>
    </figure>
  )
}
