import { useEffect, useRef, useState } from 'react'
import { StyledSelect } from '@/components/ui/styled-select'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { FORM_INPUT_CLASS } from '@/components/ui/form-field'
import type { ElevationSource } from '@/lib/forestry/terrain/terrain'
import type { FieldRecord } from './assessmentTools'
import type { MatchedCamera } from './matchedCamera'
import { skylineReach, type SkylineRay } from './skylineReach'
import { chosenValues, referenceLabels, type ReferenceRow, type ReferenceValues } from './referenceMeasurements'
import {
  imagePixel,
  skylinePixel,
  pixelError,
  refineAim,
  projectTrace,
  type ReferenceCamera,
  type RegistrationPoint,
  type Pixel,
} from './referenceProjection'
import type { ProjectAttachment } from './projectArchive'
import type { CandidateRole, ReferenceGeometryActions } from './ReferenceGeometryPanel'

export type PhotoInputs = {
  ground: ElevationSource | null
  photos: FieldRecord[]
  /**
   * Hands the confirmed camera to the own photo window as a matched camera for that photo record, where the
   * reviewer checks and accepts it (`acceptGate`). This dialog never writes a photo's pose.
   */
  lineUpInOwnPhoto: (recordId: string, camera: MatchedCamera, checks: string[]) => void
}
const numericFields = [
  'longitude',
  'latitude',
  'eyeAltitude',
  'heading',
  'pitch',
  'roll',
  'span',
  'cropLeft',
  'cropTop',
  'cropWidth',
  'cropHeight',
] as const
function points<T>(text: string | undefined, check: (v: T) => boolean): T[] {
  const v: unknown = JSON.parse(text || '[]')
  if (!Array.isArray(v) || v.length > 160 || !v.every(check)) throw Error('Invalid saved image points.')
  return v as T[]
}
const pixel = (p: unknown): p is Pixel => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
export function ReferenceRegistration({
  row,
  attachments,
  inputs,
  actions,
  onChange,
}: {
  row: ReferenceRow
  attachments: ProjectAttachment[]
  inputs: PhotoInputs
  actions: ReferenceGeometryActions
  onChange: (row: ReferenceRow) => void
}) {
  // Mounted only once its tab has been shown, so nothing is read before the reviewer asks.
  return (
    <section className="space-y-2" aria-label="Register an image and project a trace">
      <Registration
        key={row.id + (chosenValues(row).referenceImage ?? '')}
        {...{ row, attachments, inputs, actions, onChange }}
      />
    </section>
  )
}
function Registration({
  row,
  attachments,
  inputs,
  actions,
  onChange,
}: {
  row: ReferenceRow
  attachments: ProjectAttachment[]
  inputs: PhotoInputs
  actions: ReferenceGeometryActions
  onChange: (row: ReferenceRow) => void
}) {
  const v = chosenValues(row)
  const images = attachments.filter((a) => /\.(?:jpe?g|png|webp)$/i.test(a.name))
  const field = inputs.photos.find((f) => 'field:' + f.id === v.referenceImage)
  const file = images.find((f) => 'file:' + f.name === v.referenceImage)
  const image = useRef<HTMLImageElement>(null)
  const [size, setSize] = useState<[number, number]>([0, 0])
  const [mode, setMode] = useState<'trace' | 'fit' | 'check' | 'skyline'>('trace'),
    [spot, setSpot] = useState<Pixel | null>(null),
    [pendingImage, setPendingImage] = useState<string | null>(null),
    [mapped, setMapped] = useState(['', '', ''])
  const [message, setMessage] = useState(''),
    [role, setRole] = useState<CandidateRole>('landscape')
  const [traceResult, setTraceResult] = useState<{ key: string; result: ReturnType<typeof projectTrace> } | null>(null)
  const [skyline, setSkyline] = useState<{ eye: string; ground: ElevationSource; rays: SkylineRay[] } | null>(null)
  const edit = (fields: ReferenceValues) =>
    onChange({
      ...row,
      corrections: { ...row.corrections, ...fields },
      useSource: row.useSource?.filter((k) => !(k in fields)),
    })
  useEffect(() => {
    const blobUrl = file ? URL.createObjectURL(file.blob) : ''
    if (image.current) image.current.src = blobUrl || field?.image || ''
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [file, field?.image])
  let controls: RegistrationPoint[] = [],
    trace: Pixel[] = [],
    marks: Pixel[] = [],
    invalid = ''
  try {
    controls = points<RegistrationPoint>(
      v.controls,
      (p) =>
        p &&
        pixel(p.pixel) &&
        [p.lng, p.lat, p.elevation].every(Number.isFinite) &&
        Math.abs(p.lng) <= 180 &&
        Math.abs(p.lat) < 85 &&
        typeof p.heldOut === 'boolean',
    )
    trace = points<Pixel>(v.trace, pixel)
    marks = points<Pixel>(v.skylineTrace, pixel)
  } catch (e) {
    invalid = String(e)
  }
  const defaults: Partial<Record<(typeof numericFields)[number], number>> = {
    cropLeft: 0,
    cropTop: 0,
    cropWidth: size[0],
    cropHeight: size[1],
    pitch: 0,
    roll: 0,
  }
  const num = (k: (typeof numericFields)[number]) => (v[k]?.trim() ? Number(v[k]) : (defaults[k] ?? NaN))
  const c: ReferenceCamera = {
    projection: v.projection as ReferenceCamera['projection'],
    lng: num('longitude'),
    lat: num('latitude'),
    altitudeMeters: num('eyeAltitude'),
    bearing: num('heading'),
    pitch: num('pitch'),
    roll: num('roll'),
    span: num('span'),
    left: num('cropLeft'),
    top: num('cropTop'),
    width: num('cropWidth'),
    height: num('cropHeight'),
  }
  const ready =
    !!(file || field?.image) &&
    !!size[0] &&
    !invalid &&
    ['pinhole', 'cylindrical', 'equirectangular'].includes(c.projection) &&
    numericFields.every((k) => Number.isFinite(num(k))) &&
    Math.abs(c.lng) <= 180 &&
    Math.abs(c.lat) < 85 &&
    Math.abs(c.pitch) <= 90 &&
    c.span > 0 &&
    c.span <= (c.projection === 'pinhole' ? 179 : 360) &&
    c.left >= 0 &&
    c.top >= 0 &&
    c.width > 0 &&
    c.height > 0 &&
    c.left + c.width <= size[0] &&
    c.top + c.height <= size[1] &&
    (c.projection !== 'equirectangular' || (c.height / c.width) * c.span <= 180)
  const eyeKey = JSON.stringify([c.lng, c.lat, c.altitudeMeters])
  const rays = skyline?.eye === eyeKey && skyline.ground === inputs.ground ? skyline.rays : []
  const stamp = JSON.stringify([v.referenceImage, c, controls, marks])
  const accepted = ready && v.acceptedCamera === stamp
  const traceKey = JSON.stringify([stamp, trace, v.ridgeGap])
  const projected = traceResult?.key === traceKey ? traceResult.result : null
  const inside = ([x, y]: Pixel) => x >= c.left && x <= c.left + c.width && y >= c.top && y <= c.top + c.height
  const guard = (fn: () => void) => {
    try {
      fn()
      setMessage('')
    } catch (e) {
      setMessage(String(e))
    }
  }
  const switchImage = (referenceImage: string) =>
    edit({ referenceImage, controls: '[]', trace: '[]', skylineTrace: '[]', acceptedCamera: '' })
  return (
    <div className="space-y-2">
      <label className="grid gap-1">
        Reference image or field record
        <StyledSelect
          className={FORM_INPUT_CLASS}
          value={v.referenceImage ?? ''}
          onChange={(e) => {
            // Marked points belong to the image they were marked on: ask in place before clearing them.
            if (controls.length || trace.length || marks.length) setPendingImage(e.target.value)
            else switchImage(e.target.value)
          }}
        >
          <option value="">Choose an image</option>
          {inputs.photos.map((f) => (
            <option key={f.id} value={'field:' + f.id}>
              {f.name} · field record
            </option>
          ))}
          {images.map((a, i) => (
            <option key={i} value={'file:' + a.name}>
              {a.name}
            </option>
          ))}
        </StyledSelect>
      </label>
      {pendingImage !== null && (
        <InlineAlert tone="warning">
          Changing the image clears its marked points, skyline marks and trace.
          <span className="mt-1.5 flex flex-wrap gap-2">
            <Button
              type="button"
              size="xs"
              onClick={() => {
                switchImage(pendingImage)
                setPendingImage(null)
              }}
            >
              Clear and change
            </Button>
            <Button type="button" size="xs" variant="outline" onClick={() => setPendingImage(null)}>
              Keep this image
            </Button>
          </span>
        </InlineAlert>
      )}
      {field && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            edit(
              Object.fromEntries(
                Object.entries({
                  longitude: field.lng,
                  latitude: field.lat,
                  eyeAltitude: field.altitude,
                  bearing: field.bearing,
                  heading: field.bearing,
                  pitch: field.pitch,
                  roll: field.roll,
                  span: field.hfov,
                  cameraEvidence: field.name + ' · ' + field.captured,
                })
                  .filter(([k, x]) => k !== 'bearing' && x != null)
                  .map(([k, x]) => [k, String(x)]),
              ),
            )
          }
        >
          Use field record pose values
        </Button>
      )}
      <label className="grid gap-1">
        Image projection
        <StyledSelect
          className={FORM_INPUT_CLASS}
          value={v.projection ?? ''}
          onChange={(e) => edit({ projection: e.target.value })}
        >
          <option value="">Choose a projection</option>
          {['pinhole', 'cylindrical', 'equirectangular'].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </StyledSelect>
      </label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {numericFields.map((k) => (
          <label key={k}>
            {referenceLabels[k]}
            <input
              className={FORM_INPUT_CLASS}
              type="number"
              step="any"
              key={v[k] ?? defaults[k] ?? ''}
              defaultValue={v[k] ?? defaults[k] ?? ''}
              onBlur={(e) => {
                if (e.target.value !== (v[k] ?? String(defaults[k] ?? ''))) edit({ [k]: e.target.value })
              }}
            />
          </label>
        ))}
      </div>
      <label className="grid gap-1">
        Image click adds
        <StyledSelect
          className={FORM_INPUT_CLASS}
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as typeof mode)
            setSpot(null)
          }}
        >
          <option value="trace">Outline vertex</option>
          <option value="skyline">Skyline fit mark</option>
          <option value="fit">Mapped fit point</option>
          <option value="check">Held-out check point</option>
        </StyledSelect>
      </label>
      {(file || field?.image) && (
        <div className="relative">
          <img
            className="block w-full"
            ref={image}
            alt="Reference registration frame"
            onLoad={(e) => setSize([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])}
          />
          {size[0] > 0 && (
            <svg
              className="absolute inset-0 h-full w-full cursor-crosshair"
              viewBox={'0 0 ' + size.join(' ')}
              onClick={(e) => {
                const b = e.currentTarget.getBoundingClientRect(),
                  p: Pixel = [((e.clientX - b.left) * size[0]) / b.width, ((e.clientY - b.top) * size[1]) / b.height]
                if (!inside(p)) {
                  setMessage('Choose a point inside the crop.')
                  return
                }
                if (mode === 'trace') {
                  if (trace.length < 160) edit({ trace: JSON.stringify([...trace, p]) })
                } else if (mode === 'skyline') {
                  if (marks.length < 160) edit({ skylineTrace: JSON.stringify([...marks, p]) })
                } else setSpot(p)
              }}
            >
              <rect
                x={c.left}
                y={c.top}
                width={c.width}
                height={c.height}
                fill="none"
                stroke="white"
                vectorEffect="non-scaling-stroke"
              />
              <polygon
                points={trace.map((p) => p.join(',')).join(' ')}
                fill="none"
                stroke="orange"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
              {rays.map((ray) => {
                const point = skylinePixel(c, ray)
                return (
                  point &&
                  inside(point) && (
                    <circle
                      key={ray.bearingDegrees}
                      cx={point[0]}
                      cy={point[1]}
                      r={size[0] / 400}
                      fill={ray.unknownMeters ? 'gray' : 'lime'}
                    />
                  )
                )
              })}
              {marks.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={size[0] / 240} fill="magenta" />
              ))}
              {controls.map((p, i) => {
                const end = ready ? imagePixel(c, p) : null
                return (
                  <g key={i}>
                    <circle cx={p.pixel[0]} cy={p.pixel[1]} r={size[0] / 140} fill={p.heldOut ? 'cyan' : 'yellow'} />
                    {end && (
                      <line
                        x1={p.pixel[0]}
                        y1={p.pixel[1]}
                        x2={end[0]}
                        y2={end[1]}
                        stroke="red"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                  </g>
                )
              })}
              {spot && <circle cx={spot[0]} cy={spot[1]} r={size[0] / 140} fill="white" />}
              {projected?.gaps.map((p, i) => (
                <circle key={i} cx={p[0]} cy={p[1]} r={size[0] / 200} fill="red" />
              ))}
            </svg>
          )}
        </div>
      )}
      {spot && mode !== 'trace' && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-1">
            {['Mapped longitude', 'Mapped latitude', 'Elevation (m)'].map((label, i) => (
              <label key={label}>
                {label}
                <input
                  className={FORM_INPUT_CLASS}
                  type="number"
                  step="any"
                  value={mapped[i]}
                  onChange={(e) => setMapped(mapped.map((n, j) => (i === j ? e.target.value : n)))}
                />
              </label>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            disabled={
              controls.length >= 160 ||
              !mapped.every((n) => n.trim() && Number.isFinite(Number(n))) ||
              Math.abs(Number(mapped[0])) > 180 ||
              Math.abs(Number(mapped[1])) >= 85
            }
            onClick={() => {
              edit({
                controls: JSON.stringify([
                  ...controls,
                  {
                    pixel: spot,
                    lng: Number(mapped[0]),
                    lat: Number(mapped[1]),
                    elevation: Number(mapped[2]),
                    heldOut: mode === 'check',
                  },
                ]),
              })
              setSpot(null)
              setMapped(['', '', ''])
            }}
          >
            Add mapped point
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!ready || !inputs.ground}
          onClick={() =>
            guard(() => {
              const ground = inputs.ground!
              const sky = skylineReach(
                ground,
                { lng: c.lng, lat: c.lat, elevation: c.altitudeMeters },
                [{ fromDegrees: 0, toDegrees: 359 }],
                { stepDegrees: 1 },
              )
              setSkyline({ eye: eyeKey, ground, rays: sky.rays })
            })
          }
        >
          Overlay terrain skyline
        </Button>
        {!!marks.length && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => edit({ skylineTrace: JSON.stringify(marks.slice(0, -1)) })}
          >
            Undo skyline mark
          </Button>
        )}
      </div>
      {!!rays.length && (
        <p>
          Green dots show the terrain skyline. Gray dots mark incomplete terrain coverage. Magenta marks enter the fit
          with the mapped fit points.
        </p>
      )}
      {controls.map((p, i) => (
        <div key={i}>
          {p.heldOut ? 'Held-out' : 'Fit'} point {i + 1} ·{' '}
          {ready && pixelError(c, p) !== null ? pixelError(c, p)!.toFixed(1) + ' px' : 'unmeasured'}{' '}
          <Button
            type="button"
            size="2xs"
            variant="ghost"
            onClick={() => edit({ controls: JSON.stringify(controls.filter((_, j) => i !== j)) })}
          >
            Remove point
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!ready || controls.filter((p) => !p.heldOut).length < 2 || (!!marks.length && !rays.length)}
          onClick={() =>
            guard(() => {
              const fit = refineAim(c, controls, { rays, marks })
              edit({ heading: String(fit.bearing), pitch: String(fit.pitch) })
            })
          }
        >
          Fit heading and pitch
        </Button>
        <Button type="button" size="sm" disabled={!ready || accepted} onClick={() => edit({ acceptedCamera: stamp })}>
          {accepted ? 'Sheet camera confirmed' : 'Confirm sheet camera'}
        </Button>
        {field?.kind === 'photo' &&
          accepted &&
          c.projection === 'pinhole' &&
          c.left === 0 &&
          c.top === 0 &&
          c.width === size[0] &&
          c.height === size[1] &&
          c.span >= 1 &&
          c.span <= 179 &&
          Math.abs(c.roll) <= 180 &&
          c.altitudeMeters >= -500 &&
          c.altitudeMeters <= 9000 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                const heldOut = controls.filter((p) => p.heldOut)
                const errors = heldOut.map((p) => pixelError(c, p)).filter((e): e is number => e !== null)
                inputs.lineUpInOwnPhoto(
                  field.id,
                  {
                    lng: c.lng,
                    lat: c.lat,
                    altitudeMeters: c.altitudeMeters,
                    bearing: ((c.bearing % 360) + 360) % 360,
                    pitch: c.pitch,
                    roll: c.roll,
                    hfov: c.span,
                    method: 'reference registration (mapped fit points and skyline)',
                    trusted: null,
                    heldOut: [],
                    photoName: field.name,
                  },
                  [
                    errors.length
                      ? `Held-out points in the registration: ${errors.map((e) => e.toFixed(1) + ' px').join(', ')}.`
                      : 'The registration held out no points: check the camera against mapped features.',
                  ],
                )
                setMessage('Opened in the own photo window as a matched camera. Check it there and accept it.')
              }}
            >
              Line up in the own photo window
            </Button>
          )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!trace.length}
          onClick={() => edit({ trace: JSON.stringify(trace.slice(0, -1)) })}
        >
          Undo trace vertex
        </Button>
      </div>
      <label className="grid gap-1">
        Maximum range jump between rays (m)
        <input
          className={FORM_INPUT_CLASS}
          type="number"
          min="1"
          key={v.ridgeGap ?? ''}
          defaultValue={v.ridgeGap ?? 500}
          onBlur={(e) => edit({ ridgeGap: e.target.value })}
        />
      </label>
      <Button
        type="button"
        size="sm"
        disabled={!accepted || !inputs.ground || trace.length < 3}
        onClick={() =>
          guard(() => {
            if (!trace.every(inside)) throw Error('The trace extends outside the camera crop.')
            setTraceResult({ key: traceKey, result: projectTrace(c, trace, inputs.ground!, Number(v.ridgeGap ?? 500)) })
          })
        }
      >
        Project trace onto terrain
      </Button>
      {!inputs.ground && <p>Run the scene or open the road view to load terrain for tracing.</p>}
      {projected && (
        <p>
          {projected.gaps.length
            ? projected.gaps.length + ' gaps at missed or separated terrain rays, marked in red.'
            : 'Closed terrain outline available.'}
        </p>
      )}
      {projected?.geometry && (
        <div className="flex gap-2">
          <StyledSelect
            aria-label="Projected outline role"
            className={FORM_INPUT_CLASS}
            value={role}
            onChange={(e) => setRole(e.target.value as CandidateRole)}
          >
            <option value="landscape">Visible landform</option>
            <option value="private">Private exclusion</option>
            <option value="natural">Natural exclusion (numerical green area)</option>
            <option value="rock">Rock exclusion (numerical and image area)</option>
            <option value="retained">Retention patch</option>
          </StyledSelect>
          <Button
            type="button"
            size="sm"
            disabled={!accepted}
            onClick={() =>
              guard(() =>
                actions.onAdopt(
                  row,
                  {
                    geometry: projected.geometry!,
                    name: v.landform || 'Image trace',
                    source: (v.referenceImage ?? '') + ' · reviewed ' + c.projection + ' trace',
                  },
                  role,
                  '',
                ),
              )
            }
          >
            Adopt trace
          </Button>
        </div>
      )}
      {(message || invalid) && <p role="status">{message || invalid}</p>}
    </div>
  )
}
