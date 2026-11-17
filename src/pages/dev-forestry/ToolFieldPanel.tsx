import {
  CheckboxField,
  FORM_INPUT_CLASS,
  FormField,
  StyledSelect,
  NullableNumberField,
  NumberField,
} from '@/components/ui/form-field'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FileButton } from '@/components/ui/file-button'
import { TextButton } from '@/components/ui/text-button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { InfoTip } from '@/components/ui/info-tip'
import { PHOTO_FILE_ACCEPT } from '@/lib/heic/heicFile'
import { projectToPhoto, type PhotoPose } from './photoPose'
import { maskAt } from './assessmentMasks'
import { haversineMeters } from './visibility'
import type { FieldRecord, ToolsDocument, ToolView } from './assessmentTools'
import type { AnalysisResult, Viewpoint } from './types'

/** The camera record's coordinates and angles; a blank pitch or roll means level (0). */
const CAMERA_FIELDS = [
  { key: 'lng', label: 'Longitude', step: 0.0001 },
  { key: 'lat', label: 'Latitude', step: 0.0001 },
  { key: 'altitude', label: 'Camera elevation above sea level (m)', step: 1 },
  { key: 'bearing', label: 'True-north bearing (°)', step: 0.1 },
  { key: 'hfov', label: 'Horizontal field of view (°)', step: 0.1 },
  { key: 'pitch', label: 'Pitch above horizon (°)', step: 0.1 },
  { key: 'roll', label: 'Roll (°)', step: 0.1 },
] as const
type Props = {
  document: ToolsDocument
  onChange: (next: ToolsDocument | ((current: ToolsDocument) => ToolsDocument)) => void
  /** Viewpoints recorded here before the views of interest, kept for their photographs and runs (`earlierToolViews`). */
  earlier: ToolView[]
  /** Opens an attachment's dialog. */
  onOpen: (id: string) => void
  /** Imports an image as an attachment, filed under no viewpoint. */
  onImport: (file: File, kind: FieldRecord['kind']) => void
  busy: boolean
  error: string | null
  /** Stands there, as before: an earlier viewpoint's *Use viewpoint*. */
  onUseView: (viewpoint: Viewpoint) => void
  /** Lists an earlier spot viewpoint with the views of interest, under its own id; null when it cannot be. */
  onListView?: (view: ToolView) => string | null
}

/**
 * Step 2's field records: the photographs and evidence images of the assessment, each filed under a view of
 * interest (its row lists and adds them). Shown in the sidebar's *Field photos* section, under the photo line-up. Viewpoints are the views of interest; the ones recorded here before them
 * are kept, for their photographs and runs, until listed with the views or removed.
 */
export function ToolFieldPanel({
  document: d,
  onChange,
  earlier,
  onOpen,
  onImport,
  busy,
  error,
  onUseView,
  onListView,
}: Props) {
  const [kind, setKind] = useState<FieldRecord['kind']>('photo')
  const [listError, setListError] = useState<string | null>(null)
  return (
    <div className="space-y-2" role="group" aria-label="Field records">
      <div className="space-y-2">
        {earlier.length > 0 && (
          <div className="space-y-1.5" role="group" aria-label="Viewpoints recorded before the views of interest">
            <p className="text-2xs text-muted-foreground">
              Recorded here before the views of interest. List one with them to keep its photographs and runs there.
            </p>
            {earlier.map((v) => (
              <div key={v.id} className="space-y-1 border-b py-1.5">
                <p className="text-xs font-medium">
                  {v.name} · {v.viewpoint.mode === 'spot' ? 'spot' : 'route'}
                </p>
                {v.notes && <p className="text-2xs text-muted-foreground">{v.notes}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {onListView && (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={v.viewpoint.mode !== 'spot'}
                      title={
                        v.viewpoint.mode === 'spot'
                          ? 'List it with the views of interest, facing a block'
                          : 'A whole road is not a place: it stays here for its runs'
                      }
                      onClick={() => {
                        const id = onListView(v)
                        setListError(id ? null : 'Add a cutblock first, or remove a view of interest to make room.')
                      }}
                    >
                      List with views of interest
                    </Button>
                  )}
                  <Button size="xs" variant="outline" onClick={() => onUseView(v.viewpoint)}>
                    Use viewpoint
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      onChange((current) => ({
                        ...current,
                        views: current.views.filter((x) => x.id !== v.id),
                        fields: current.fields.map((f) => (f.viewId === v.id ? { ...f, viewId: null } : f)),
                      }))
                    }
                  >
                    Remove {v.name}
                  </Button>
                </div>
              </div>
            ))}
            {listError && <InlineAlert tone="warning">{listError}</InlineAlert>}
          </div>
        )}
        <FormField label="Attachment type">
          <StyledSelect value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="photo">Reference field photo</option>
            <option value="simulation">Simulation image</option>
            <option value="map">Topographic map</option>
            <option value="design">Design analysis</option>
          </StyledSelect>
        </FormField>
        <FileButton
          label="Import field attachment"
          accept={PHOTO_FILE_ACCEPT}
          disabled={busy}
          onFiles={([file]) => onImport(file, kind)}
        >
          {busy ? 'Reading image…' : 'Import photograph or evidence image'}
        </FileButton>
        <InfoTip label="About imported photographs" showLabel>
          A resized evidence copy is stored; keep the original high-resolution photographs. EXIF values are suggestions.
          Verify position, date, true-north heading and field of view; panoramas and edited or cropped photos need
          manual calibration.
        </InfoTip>
        {d.fields.map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-2">
            <TextButton className="min-w-0" onClick={() => onOpen(f.id)}>
              <span className="truncate">
                {f.name} · {f.kind}
              </span>
            </TextButton>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                onChange((current) => ({ ...current, fields: current.fields.filter((x) => x.id !== f.id) }))
              }
            >
              Remove {f.name}
            </Button>
          </div>
        ))}
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
    </div>
  )
}

/**
 * One attachment's evidence and camera match, opened from Field records or from its view's row. Rendered beside the
 * sidebar's sections rather than inside one, so folding a section never takes it away.
 */
export function FieldRecordDialog({
  document: d,
  onChange,
  views,
  result,
  selected,
  onClose,
  onAddViewAt,
}: {
  document: ToolsDocument
  onChange: (next: ToolsDocument | ((current: ToolsDocument) => ToolsDocument)) => void
  /** Every viewpoint a record can be filed under: the views of interest, then any recorded before them. */
  views: ToolView[]
  result: AnalysisResult | null
  selected: string | null
  onClose: () => void
  /** Lists a view of interest at the photo's place and returns its id; null when it cannot. */
  onAddViewAt?: (point: { lng: number; lat: number }, name: string) => string | null
}) {
  const [annotation, setAnnotation] = useState('Ridge')
  const field = d.fields.find((f) => f.id === selected) ?? null
  const change = (patch: Partial<FieldRecord>) => {
    if (field)
      onChange((current) => ({
        ...current,
        fields: current.fields.map((f) =>
          f.id === field.id ? { ...f, ...patch, alignmentChecked: patch.alignmentChecked ?? false } : f,
        ),
      }))
  }
  const station =
    field &&
    result?.stations.find(
      (s) => field.lng !== null && field.lat !== null && haversineMeters(s, { lng: field.lng, lat: field.lat }) <= 1,
    )
  const pose: PhotoPose | null =
    field &&
    field.lng !== null &&
    field.lat !== null &&
    field.bearing !== null &&
    field.hfov !== null &&
    (field.altitude !== null || station)
      ? {
          lng: field.lng,
          lat: field.lat,
          altitudeMeters:
            field.altitude ?? station!.groundElevationMeters + (result?.settings.observerHeightMeters ?? 1.6),
          bearing: field.bearing,
          pitch: field.pitch,
          roll: field.roll,
          width: field.width,
          height: field.height,
          focalPx: field.width / (2 * Math.tan((field.hfov * Math.PI) / 360)),
          k1: 0,
          k2: 0,
        }
      : null
  const dots =
    pose && result
      ? result.targets
          .filter((t) => t.role === 'block')
          .flatMap((t) =>
            Array.from({ length: Math.min(t.sampleCount, 1000) }, (_, i) => {
              const mask = maskAt(result.inputSnapshot?.masks ?? [], t.positions[i * 2], t.positions[i * 2 + 1])
              if (mask.excludeGreen || mask.excludeAlteration || mask.retained) return null
              const p = projectToPhoto(pose, t.positions[i * 2], t.positions[i * 2 + 1], t.elevations[i])
              return p && p.x >= 0 && p.x <= pose.width && p.y >= 0 && p.y <= pose.height ? p : null
            }).filter((p) => p !== null),
          )
      : []
  if (!field) return null
  return (
    <DialogShell title={field.name} subtitle="Field evidence and camera match" onClose={onClose} size="xl">
      <div className="grid gap-5 md:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          <div className="relative overflow-hidden" style={{ aspectRatio: `${field.width}/${field.height}` }}>
            <img src={field.image} alt={field.name} className="h-full w-full object-contain" />
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox={`0 0 ${field.width} ${field.height}`}
              aria-label="Photo annotations and projected proposal samples"
              onClick={(e) => {
                if (!annotation.trim() || field.annotations.length >= 50) return
                const rect = e.currentTarget.getBoundingClientRect()
                change({
                  annotations: [
                    ...field.annotations,
                    {
                      x: (e.clientX - rect.left) / rect.width,
                      y: (e.clientY - rect.top) / rect.height,
                      label: annotation.trim().slice(0, 100),
                    },
                  ],
                })
              }}
            >
              {dots.map((p, i) => (
                <circle key={i} cx={p!.x} cy={p!.y} r={3} fill="#ef4444" fillOpacity="0.5" />
              ))}
              {field.annotations.map((a, i) => (
                <g key={i}>
                  <circle cx={a.x * field.width} cy={a.y * field.height} r="5" fill="#fbbf24" />
                  <text
                    x={a.x * field.width + 8}
                    y={a.y * field.height}
                    fill="#fff"
                    stroke="#000"
                    strokeWidth="0.6"
                    fontSize="22"
                  >
                    {a.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>
          <InfoTip label="What the red points are" showLabel>
            Projected proposal ground samples, hidden ground included: an alignment aid. It does not mask terrain or
            canopy and is not a photographic percent-alteration measurement.
          </InfoTip>
          <FormField label="Annotation to place on image">
            <input className={FORM_INPUT_CLASS} value={annotation} onChange={(e) => setAnnotation(e.target.value)} />
          </FormField>
          <p className="text-xs">
            Click the image to label a ridge, drainage, skyline, natural pattern or design issue.
          </p>
          <Button size="sm" variant="outline" onClick={() => change({ annotations: field.annotations.slice(0, -1) })}>
            Undo last annotation
          </Button>
          {!pose && (
            <InlineAlert>
              Record position, heading, field of view and camera elevation to project the proposal. A matching sampled
              station can supply estimated camera elevation.
            </InlineAlert>
          )}
        </div>
        <div className="space-y-3">
          <FormField label="Evidence name">
            <input className={FORM_INPUT_CLASS} value={field.name} onChange={(e) => change({ name: e.target.value })} />
          </FormField>
          <FormField label="Evidence viewpoint">
            <StyledSelect value={field.viewId ?? ''} onChange={(e) => change({ viewId: e.target.value || null })}>
              <option value="">Not linked</option>
              {views.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </StyledSelect>
          </FormField>
          <FormField label="Field date">
            <input
              type="date"
              className={FORM_INPUT_CLASS}
              value={field.captured}
              onChange={(e) => change({ captured: e.target.value })}
            />
          </FormField>
          <CollapsibleSection toggleProps={{ 'data-forestry-disclosure': '' }} label="Camera record" defaultOpen>
            <div className="space-y-2 py-2">
              {CAMERA_FIELDS.map(({ key, label, step }) =>
                key === 'pitch' || key === 'roll' ? (
                  <NumberField
                    key={key}
                    label={label}
                    step={step}
                    blankValue="zero"
                    value={field[key]}
                    onValueChange={(value) => change({ [key]: value })}
                  />
                ) : (
                  <NullableNumberField
                    key={key}
                    label={label}
                    step={step}
                    value={field[key]}
                    onValueChange={(value) => change({ [key]: value })}
                  />
                ),
              )}
            </div>
          </CollapsibleSection>
          <FormField label="Camera elevation reference">
            <input
              className={FORM_INPUT_CLASS}
              value={field.verticalReference ?? ''}
              placeholder="Datum; verify EXIF altitude against terrain"
              onChange={(e) => change({ verticalReference: e.target.value })}
            />
          </FormField>
          <FormField label="Field and design notes">
            <textarea
              className={FORM_INPUT_CLASS}
              value={field.notes}
              onChange={(e) => change({ notes: e.target.value })}
            />
          </FormField>
          <CheckboxField
            label="I checked the camera record and image alignment against field evidence."
            checked={field.alignmentChecked}
            onCheckedChange={(alignmentChecked) => change({ alignmentChecked })}
          />
          {onAddViewAt && (
            <Button
              size="sm"
              variant="outline"
              disabled={field.lng === null || field.lat === null}
              title="List a view of interest where the photo was taken, and file the photo under it"
              onClick={() => {
                if (field.lng === null || field.lat === null) return
                const id = onAddViewAt({ lng: field.lng, lat: field.lat }, field.name)
                if (id) change({ viewId: id })
              }}
            >
              Add the photo&rsquo;s place to the views of interest
            </Button>
          )}
        </div>
      </div>
    </DialogShell>
  )
}
