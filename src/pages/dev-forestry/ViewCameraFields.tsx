import { Crosshair, MapPin } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { MapMarker, MarkerContent } from '@/components/ui/map'
import { DisclosureRow } from '@/components/ui/disclosure'
import { FORM_INPUT_CLASS, FormField, NumberField, SelectField, unitInside } from '@/components/ui/form-field'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { formatMeasure } from '@/lib/format'

import {
  EYE_GROUND_TOLERANCE_METERS,
  MAX_CROP_FACTOR,
  MAX_EYE_ELEVATION_METERS,
  MAX_EYE_HEIGHT_METERS,
  MAX_HFOV_DEG,
  MIN_CROP_FACTOR,
  MIN_EYE_ELEVATION_METERS,
  MIN_EYE_HEIGHT_METERS,
  MIN_HFOV_DEG,
  equivalentFocalMm,
  eyeCheck,
  eyeCheckText,
  fieldsOfView,
  focalLabel,
  lensEntryHfov,
  lensEntryProblem,
  type ViewEye,
  type ViewLensEntry,
} from './viewCamera'
import {
  BC_UTM_ZONES,
  DATUM_ASSUMPTION,
  formatDecimalDegrees,
  formatDms,
  formatUtm,
  placeCrsLabel,
  placeEntryOf,
  placeInputOf,
  precisionLabel,
  readPlaceInput,
  type CoordinateDatum,
  type PlaceInput,
} from './viewCoordinates'
import { VIEW_OF_INTEREST_COLORS } from './planMapStyle'
import { SINGLE_FRAME_ASPECT } from './viewCapturePlan'
import type { ViewOfInterest } from './viewsOfInterest'
import { haversineMeters } from './visibility'

const metres = (value: number, digits = 1) => formatMeasure(value, 'm', { maximumFractionDigits: digits })

type EyeChoice = 'model' | ViewEye['reference']

export type ViewCameraFieldsProps = {
  view: ViewOfInterest
  /** Writes the view: out of the run, so no edit here stales it (an eye at the view stood at goes to its stand). */
  onUpdate: (patch: Partial<ViewOfInterest>) => void
  /** A typed point to show on the plan before it is applied; null takes it away. */
  onPreview?: (point: { lng: number; lat: number } | null) => void
  /** Brings a point into sight on the plan. */
  onShowPoint?: (point: { lng: number; lat: number }) => void
  /** The terrain model's ground at the view, where the road view's terrain is loaded; null elsewhere. */
  modelGroundMeters?: number | null
  /** The run's eye height above the ground. */
  observerHeightMeters: number
  /** The road view's canvas while it is open, for the lens's vertical field there. */
  roadViewCanvas?: { width: number; height: number } | null
  /** The run's stations, when the run stands at this view: they stand at the pullout's ends, not at the eye. */
  runStations?: ReadonlyArray<{ lng: number; lat: number }> | null
  /**
   * A surveyed eye the stand holds that this view does not (entered before views kept their own): offered once, to
   * keep on the view.
   */
  standEyeMeters?: number | null
}

/**
 * A view of interest's place and camera, in its row's View tab (backlog VQ-12 and VQ-13): its coordinates shown back
 * in both systems, a place typed as latitude and longitude or UTM (shown on the plan before it is applied), the lens
 * as entered when it is not one of the four offered, and a surveyed eye. All of it is the view's own record, out of the
 * run (`sceneFingerprint` drops the views); the capture stands on it (`viewCaptureCamera`).
 */
export function ViewCameraFields({
  view,
  onUpdate,
  onPreview,
  onShowPoint,
  modelGroundMeters = null,
  observerHeightMeters,
  roadViewCanvas = null,
  runStations = null,
  standEyeMeters = null,
}: ViewCameraFieldsProps) {
  return (
    <div className="space-y-2" data-view-camera={view.id}>
      <PlaceFields
        view={view}
        onUpdate={onUpdate}
        onPreview={onPreview}
        onShowPoint={onShowPoint}
        runStations={runStations}
      />
      {view.lens && !view.photo && <LensFields lens={view.lens} onUpdate={onUpdate} roadViewCanvas={roadViewCanvas} />}
      <EyeFields
        view={view}
        onUpdate={onUpdate}
        modelGroundMeters={modelGroundMeters}
        observerHeightMeters={observerHeightMeters}
        standEyeMeters={standEyeMeters}
      />
    </div>
  )
}

function PlaceFields({
  view,
  onUpdate,
  onPreview,
  onShowPoint,
  runStations,
}: Pick<ViewCameraFieldsProps, 'view' | 'onUpdate' | 'onPreview' | 'onShowPoint' | 'runStations'>) {
  const typed = placeEntryOf(view)
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState<PlaceInput>(() =>
    typed ? placeInputOf(typed) : { system: 'utm', datum: 'NAD83', zone: 10, easting: '', northing: '' },
  )
  const blank = input.system === 'latlon' ? !input.text.trim() : !input.easting.trim() && !input.northing.trim()
  const read = useMemo(() => (blank ? null : readPlaceInput(input)), [blank, input])
  const point = read?.parsed.ok ? { lng: read.parsed.lng, lat: read.parsed.lat } : null
  const pointKey = point ? `${point.lng},${point.lat}` : null
  // The typed point shows on the plan while the entry is open and reads; it goes when either stops.
  useEffect(() => {
    if (!onPreview) return
    if (!open || !pointKey) {
      onPreview(null)
      return
    }
    const [lng, lat] = pointKey.split(',').map(Number)
    onPreview({ lng, lat })
  }, [open, pointKey, onPreview])
  useEffect(() => () => onPreview?.(null), [onPreview])
  const zone = typed?.zone
  const movedFrom = view.place && !typed ? haversineMeters(view, view.place) : null
  const away = point ? haversineMeters(view, point) : null
  const gaps = runStations?.length ? runStations.map((station) => haversineMeters(view, station)) : null
  const setSystem = (system: PlaceInput['system']) =>
    setInput((current) =>
      current.system === system
        ? current
        : system === 'latlon'
          ? { system, datum: current.datum, text: '' }
          : { system, datum: current.datum, zone: 10, easting: '', northing: '' },
    )
  return (
    <section className="space-y-1" aria-label={`Where ${view.name} stands`}>
      <p className="flex items-center gap-1 text-2xs font-medium text-foreground">
        Place
        <InfoTip label="About a view's place">
          Where the view stands, in both systems. A plan click lands a few metres from a recorded station; typing the
          coordinates puts the view where they say. The text as typed, its system and datum, and the precision its
          digits state are kept on the view and printed with its exports while it stands there. {DATUM_ASSUMPTION}
        </InfoTip>
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-2xs text-muted-foreground" data-view-place={view.id}>
        <dt>Decimal</dt>
        <dd className="text-foreground">{formatDecimalDegrees(view.lng, view.lat)}</dd>
        <dt>DMS</dt>
        <dd className="text-foreground">{formatDms(view.lng, view.lat)}</dd>
        <dt>UTM</dt>
        <dd className="text-foreground">{formatUtm(view.lng, view.lat, zone)}</dd>
        {typed && (
          <>
            <dt>Entered</dt>
            <dd className="text-foreground" data-view-place-entered={view.id}>
              {typed.text} · {placeCrsLabel(typed)} · {precisionLabel(typed.precisionMeters)} from the digits given
            </dd>
          </>
        )}
      </dl>
      {movedFrom !== null && (
        <p className="text-2xs text-muted-foreground">
          Moved {metres(movedFrom)} on the plan since it was typed as {view.place!.text}: that entry no longer describes
          it and is not printed.
        </p>
      )}
      {gaps && (
        <p className="text-2xs text-muted-foreground" data-view-station-gap={view.id}>
          The run&apos;s stations stand {gaps.map((gap) => metres(gap)).join(' and ')} from this eye, at the
          pullout&apos;s ends: its figures are read there, the capture here.
        </p>
      )}
      <DisclosureRow
        title="Enter coordinates"
        open={open}
        onOpenChange={setOpen}
        toggleProps={{ 'data-view-place-entry': view.id }}
        className="text-2xs"
      >
        <div className="grid grid-cols-2 gap-1.5">
          <SelectField
            label="System"
            value={input.system}
            onValueChange={(value) => setSystem(value === 'latlon' ? 'latlon' : 'utm')}
          >
            <option value="utm">UTM easting, northing</option>
            <option value="latlon">Latitude, longitude</option>
          </SelectField>
          <SelectField
            label="Datum"
            value={input.datum}
            onValueChange={(value) => setInput((current) => ({ ...current, datum: value as CoordinateDatum }))}
          >
            <option value="NAD83">NAD83</option>
            <option value="WGS84">WGS84 (GPS)</option>
          </SelectField>
        </div>
        {input.system === 'latlon' ? (
          <FormField label="Latitude, longitude">
            <input
              type="text"
              className={FORM_INPUT_CLASS}
              value={input.text}
              placeholder={`53.91234, -122.71234 or 53°54'44.4"N 122°42'44.4"W`}
              maxLength={120}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setInput({ ...input, text: event.target.value })}
            />
          </FormField>
        ) : (
          <div className="grid grid-cols-[4.5rem_1fr_1fr] gap-1.5">
            <SelectField
              label="Zone"
              value={String(input.zone)}
              onValueChange={(value) => setInput({ ...input, zone: Number(value) })}
            >
              {BC_UTM_ZONES.map((entry) => (
                <option key={entry} value={String(entry)}>
                  {entry}N
                </option>
              ))}
            </SelectField>
            <FormField label="Easting (m)">
              <input
                type="text"
                inputMode="decimal"
                className={FORM_INPUT_CLASS}
                value={input.easting}
                placeholder="512345.6"
                maxLength={20}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setInput({ ...input, easting: event.target.value })}
              />
            </FormField>
            <FormField label="Northing (m)">
              <input
                type="text"
                inputMode="decimal"
                className={FORM_INPUT_CLASS}
                value={input.northing}
                placeholder="5973210.4"
                maxLength={20}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setInput({ ...input, northing: event.target.value })}
              />
            </FormField>
          </div>
        )}
        {read && !read.parsed.ok && <p className="text-2xs text-danger">{read.parsed.error}</p>}
        {read?.parsed.ok && point && (
          <div className="space-y-1 text-2xs text-muted-foreground" data-view-place-preview={view.id}>
            <p>
              {formatDecimalDegrees(point.lng, point.lat)} · {formatUtm(point.lng, point.lat, read.entry?.zone)} ·{' '}
              {precisionLabel(read.parsed.precisionMeters)} from the digits given · {metres(away ?? 0)} from where the
              view stands now. Shown on the plan.
            </p>
            {read.parsed.warnings.map((warning) => (
              <p key={warning} className="text-warning">
                {warning}
              </p>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="2xs"
            disabled={!point}
            onClick={() => point && onShowPoint?.(point)}
          >
            <Crosshair className="h-3.5 w-3.5" />
            Show on plan
          </Button>
          <Button
            type="button"
            size="2xs"
            disabled={!read?.entry}
            title="Move the view to the typed point and keep what was typed"
            onClick={() => {
              const entry = read?.entry
              if (!entry) return
              onUpdate({ lng: entry.lng, lat: entry.lat, place: entry })
              setOpen(false)
            }}
          >
            <MapPin className="h-3.5 w-3.5" />
            Move the view here
          </Button>
        </div>
      </DisclosureRow>
    </section>
  )
}

function LensFields({
  lens,
  onUpdate,
  roadViewCanvas,
}: {
  lens: ViewLensEntry
  onUpdate: (patch: Partial<ViewOfInterest>) => void
  roadViewCanvas: { width: number; height: number } | null
}) {
  const [problem, setProblem] = useState<string | null>(null)
  const commit = (next: ViewLensEntry) => {
    const why = lensEntryProblem(next)
    setProblem(why)
    if (!why) onUpdate({ lens: next, focalMm: equivalentFocalMm(next) })
  }
  const hfov = lensEntryHfov(lens)
  const single = fieldsOfView(hfov, SINGLE_FRAME_ASPECT, 1)
  const onCanvas =
    roadViewCanvas && roadViewCanvas.width > 0 && roadViewCanvas.height > 0
      ? fieldsOfView(hfov, roadViewCanvas.width, roadViewCanvas.height)
      : null
  return (
    <section className="space-y-1.5" aria-label="The view's own lens">
      <SelectField
        label="Lens entered as"
        value={lens.kind}
        onValueChange={(value) =>
          // Switching how it is entered keeps the same lens: the field across, or its full-frame focal length.
          commit(
            value === 'hfov'
              ? { kind: 'hfov', hfovDeg: hfov }
              : { kind: 'focal', focalMm: equivalentFocalMm(lens), cropFactor: 1 },
          )
        }
      >
        <option value="hfov">Field across (degrees)</option>
        <option value="focal">Focal length and crop factor</option>
      </SelectField>
      {lens.kind === 'hfov' ? (
        <NumberField
          label="Horizontal field of view"
          unit="°"
          {...unitInside(FORM_INPUT_CLASS)}
          value={lens.hfovDeg}
          min={Math.ceil(MIN_HFOV_DEG * 10) / 10}
          max={Math.floor(MAX_HFOV_DEG * 10) / 10}
          step={0.1}
          updateOn="commit"
          onValueChange={(hfovDeg) => commit({ kind: 'hfov', hfovDeg })}
        />
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField
            label="Focal length"
            unit="mm"
            {...unitInside(FORM_INPUT_CLASS)}
            value={lens.focalMm}
            min={1}
            max={1200}
            step={0.1}
            updateOn="commit"
            onValueChange={(focalMm) => commit({ ...lens, focalMm })}
          />
          <NumberField
            label="Crop factor"
            hintAction={
              <InfoTip label="About the crop factor">
                1 for a figure stated as 35 mm equivalent (full frame); 1.5 or 1.6 for an APS-C body; about 2 for Micro
                Four Thirds. The lens&apos;s full-frame equivalent is its focal length times this.
              </InfoTip>
            }
            {...unitInside(FORM_INPUT_CLASS)}
            value={lens.cropFactor}
            min={MIN_CROP_FACTOR}
            max={MAX_CROP_FACTOR}
            step={0.01}
            updateOn="commit"
            onValueChange={(cropFactor) => commit({ ...lens, cropFactor })}
          />
        </div>
      )}
      {problem && <p className="text-2xs text-danger">{problem}</p>}
      <p className="text-2xs text-muted-foreground" data-view-lens={hfov.toFixed(2)}>
        {focalLabel(equivalentFocalMm(lens))} full-frame equivalent · {hfov.toFixed(1)}° across ·{' '}
        {single.vfovDeg.toFixed(1)}° high on a 3:2 frame (a single-frame figure)
        {onCanvas
          ? ` · ${onCanvas.vfovDeg.toFixed(1)}° high on the road view's ${Math.round(roadViewCanvas!.width)} × ${Math.round(roadViewCanvas!.height)} canvas`
          : ''}
        .
      </p>
    </section>
  )
}

function EyeFields({
  view,
  onUpdate,
  modelGroundMeters,
  observerHeightMeters,
  standEyeMeters,
}: Pick<ViewCameraFieldsProps, 'view' | 'onUpdate' | 'observerHeightMeters'> & {
  modelGroundMeters: number | null
  standEyeMeters: number | null
}) {
  if (view.photo)
    return (
      <p className="text-2xs text-muted-foreground">
        Eye: the photo&apos;s camera
        {view.photo.altitudeMeters !== null ? `, ${metres(view.photo.altitudeMeters, 0)} above sea level` : ''}. Accept
        its camera again to change it.
      </p>
    )
  const eye = view.eye ?? null
  const choice: EyeChoice = eye ? eye.reference : 'model'
  const modelEye =
    modelGroundMeters !== null && Number.isFinite(modelGroundMeters) ? modelGroundMeters + observerHeightMeters : null
  const check = eyeCheck(eye, modelGroundMeters, observerHeightMeters)
  const setEye = (next: ViewEye | null) => onUpdate({ eye: next ?? undefined })
  return (
    <section className="space-y-1.5" aria-label="The view's eye">
      <div className="grid grid-cols-2 gap-1.5">
        <SelectField
          label="Eye"
          value={choice}
          hintAction={
            <InfoTip label="About the view's eye">
              On the terrain model, the eye stands the run&apos;s eye height ({metres(observerHeightMeters)}) over the
              regional DEM. A surveyed elevation (a VIA&apos;s camera block, a GPS reading plus your eye height) stands
              it there instead, for the road view, the capture and the run at this stand, as a stood-at viewpoint&apos;s
              surveyed eye does. A height above the ground raises or lowers the road view&apos;s eye and the capture
              only; the run&apos;s stations keep the run&apos;s eye height. A surveyed elevation more than{' '}
              {EYE_GROUND_TOLERANCE_METERS} m from the terrain model&apos;s eye is flagged, never refused.
            </InfoTip>
          }
          onValueChange={(value) => {
            if (value === 'model') setEye(null)
            else if (value === 'elevation')
              setEye({ reference: 'elevation', meters: Math.round((modelEye ?? standEyeMeters ?? 0) * 10) / 10 })
            else setEye({ reference: 'ground', meters: observerHeightMeters })
          }}
        >
          <option value="model">On the terrain model</option>
          <option value="elevation">Surveyed elevation</option>
          <option value="ground">Height above ground</option>
        </SelectField>
        {eye && (
          <NumberField
            label={eye.reference === 'elevation' ? 'Above sea level' : 'Above the ground'}
            unit="m"
            {...unitInside(FORM_INPUT_CLASS)}
            value={eye.meters}
            min={eye.reference === 'elevation' ? MIN_EYE_ELEVATION_METERS : MIN_EYE_HEIGHT_METERS}
            max={eye.reference === 'elevation' ? MAX_EYE_ELEVATION_METERS : MAX_EYE_HEIGHT_METERS}
            step={0.1}
            updateOn="commit"
            onValueChange={(meters) => setEye({ reference: eye.reference, meters })}
          />
        )}
      </div>
      {check?.flagged && (
        <InlineAlert tone="warning">
          <span data-view-eye-flag={view.id}>
            {eyeCheckText(check)} More than {EYE_GROUND_TOLERANCE_METERS} m apart: check the elevation and its datum.
            The capture stands at the surveyed eye; the figure&apos;s camera information gives both.
          </span>
        </InlineAlert>
      )}
      {check && !check.flagged && (
        <p className="text-2xs text-muted-foreground">
          Within {EYE_GROUND_TOLERANCE_METERS} m of the terrain model&apos;s eye ({metres(check.modelEyeMeters)}).
        </p>
      )}
      {eye?.reference === 'elevation' && modelGroundMeters === null && (
        <p className="text-2xs text-muted-foreground">
          The terrain model is read once the road view&apos;s ground is loaded here: stand here to compare.
        </p>
      )}
      {!eye && standEyeMeters !== null && (
        <p className="flex flex-wrap items-center gap-1 text-2xs text-muted-foreground">
          The stand holds a surveyed eye of {metres(standEyeMeters)} entered before views kept their own.
          <Button
            type="button"
            variant="outline"
            size="2xs"
            onClick={() => setEye({ reference: 'elevation', meters: standEyeMeters })}
          >
            Keep it on this view
          </Button>
        </p>
      )}
    </section>
  )
}

/**
 * A typed place on the plan before it is applied: a hollow ring in the views' colour, taking no clicks. Shown only while
 * a view's *Enter coordinates* is open and the entry reads, like a drawing's draft; it is not a plan layer.
 */
export function ViewPlacePreviewMarker({ point }: { point: { lng: number; lat: number } }) {
  return (
    <MapMarker longitude={point.lng} latitude={point.lat}>
      <MarkerContent>
        <span
          role="img"
          aria-label="The typed place, not applied yet"
          title="The typed place, not applied yet"
          data-testid="view-place-preview"
          className="fixed-palette pointer-events-none block size-5 rounded-full border-[3px] bg-white/40 shadow"
          style={{ borderColor: VIEW_OF_INTEREST_COLORS.view }}
        />
      </MarkerContent>
    </MapMarker>
  )
}
