import {
  CheckboxField,
  FORM_INPUT_CLASS,
  FormField,
  NativeSelect,
  NullableNumberField,
  NumberField,
} from '@/components/ui/form-field'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FileButton } from '@/components/ui/file-button'
import { TextButton } from '@/components/ui/text-button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { CollapsibleSection, InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { Camera } from 'lucide-react'
import { InfoTip } from '@/components/ui/info-tip'
import { createId } from './scene'
import { importFieldImage } from './toolImports'
import { projectToPhoto, type PhotoPose } from './photoPose'
import { maskAt } from './assessmentMasks'
import { haversineMeters } from './visibility'
import type { FieldRecord, ToolsDocument } from './assessmentTools'
import type { AnalysisResult, Viewpoint } from './types'
import { formatKm } from './measureFormat'

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
  result: AnalysisResult | null
  viewpoint: Viewpoint
  activeLandformId: string | null
  currentStation: number
  onUseView: (viewpoint: Viewpoint) => void
}
export function ToolFieldPanel({
  document: d,
  onChange,
  result,
  viewpoint,
  activeLandformId,
  currentStation,
  onUseView,
}: Props) {
  const [name, setName] = useState(''),
    [mode, setMode] = useState<'route' | 'station'>('station'),
    [selected, setSelected] = useState<string | null>(null),
    [kind, setKind] = useState<FieldRecord['kind']>('photo'),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [annotation, setAnnotation] = useState('Ridge')
  const field = d.fields.find((f) => f.id === selected) ?? null
  const change = (patch: Partial<FieldRecord>) => {
    if (field)
      onChange({
        ...d,
        fields: d.fields.map((f) =>
          f.id === field.id ? { ...f, ...patch, alignmentChecked: patch.alignmentChecked ?? false } : f,
        ),
      })
  }
  const addView = (point?: [number, number], fallback?: string) => {
    if (d.views.length >= 12) {
      setError('Twelve viewpoints are saved. Remove one or export this workspace.')
      return
    }
    const station = result?.stations[currentStation] ?? result?.stations[result.assessmentStationIndex]
    const vp = point
      ? {
          id: createId('viewpoint'),
          name: name.trim() || fallback || 'Field viewpoint',
          mode: 'spot' as const,
          coordinates: [point],
        }
      : mode === 'station' && station
        ? {
            id: createId('viewpoint'),
            name: name.trim() || `Station ${formatKm(station.distanceAlongMeters)}`,
            mode: 'spot' as const,
            coordinates: [[station.lng, station.lat] as [number, number]],
          }
        : structuredClone(viewpoint)
    if (!vp.coordinates.length) {
      setError('Place a viewpoint or run the road assessment first.')
      return
    }
    const id = createId('tool-view')
    onChange({
      ...d,
      views: [...d.views, { id, name: name.trim() || vp.name, viewpoint: vp, landformId: activeLandformId, notes: '' }],
      fields: field && point ? d.fields.map((f) => (f.id === field.id ? { ...f, viewId: id } : f)) : d.fields,
    })
    setName('')
    setError(null)
  }
  const documentRef = useRef(d)
  documentRef.current = d
  const upload = async (file: File) => {
    if (d.fields.length >= 24) {
      setError('The workspace holds at most 24 attachments.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const f = await importFieldImage(file, kind, d.views[0]?.id ?? null)
      const latest = documentRef.current
      if (latest.fields.length >= 24) throw new Error('The workspace holds at most 24 attachments.')
      if (!latest.views.some((v) => v.id === f.viewId)) f.viewId = null
      onChange({ ...latest, fields: [...latest.fields, f] })
      setSelected(f.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
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
  return (
    <SidebarSection
      title="Field records"
      icon={Camera}
      headingLevel={3}
      actions={
        <InfoTip label="About field records">
          Assessment viewpoints with their photographs and why each matters. They stay on this device and travel in the
          workspace export.
        </InfoTip>
      }
    >
      <div className="space-y-2">
        <FormField label="Viewpoint name">
          <input className={FORM_INPUT_CLASS} value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Save viewpoint from">
          <NativeSelect value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="station">Current sampled station</option>
            <option value="route">Entire current road or spot</option>
          </NativeSelect>
        </FormField>
        <Button size="sm" variant="outline" onClick={() => addView()} disabled={mode === 'station' && !result}>
          Record assessment viewpoint
        </Button>
        {d.views.map((v) => (
          <div key={v.id} className="space-y-1 border-b py-2">
            <p className="text-xs font-medium">
              {v.name} · {v.viewpoint.mode === 'spot' ? 'spot' : 'route'}
            </p>
            <FormField label={`Significance of ${v.name}`} hideLabel>
              <textarea
                className={FORM_INPUT_CLASS}
                value={v.notes}
                placeholder="Public use, viewing opportunity, field visit or engagement evidence"
                onChange={(e) =>
                  onChange((current) => ({
                    ...current,
                    views: current.views.map((x) => (x.id === v.id ? { ...x, notes: e.target.value } : x)),
                  }))
                }
              />
            </FormField>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => onUseView(v.viewpoint)}>
                Use viewpoint
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  onChange({
                    ...d,
                    views: d.views.filter((x) => x.id !== v.id),
                    fields: d.fields.map((f) => (f.viewId === v.id ? { ...f, viewId: null } : f)),
                  })
                }
              >
                Remove {v.name}
              </Button>
            </div>
          </div>
        ))}
        <FormField label="Attachment type">
          <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="photo">Reference field photo</option>
            <option value="simulation">Simulation image</option>
            <option value="map">Topographic map</option>
            <option value="design">Design analysis</option>
          </NativeSelect>
        </FormField>
        <FileButton
          label="Import field attachment"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onFiles={([file]) => void upload(file)}
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
            <TextButton className="min-w-0" onClick={() => setSelected(f.id)}>
              <span className="truncate">
                {f.name} · {f.kind}
              </span>
            </TextButton>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange({ ...d, fields: d.fields.filter((x) => x.id !== f.id) })}
            >
              Remove {f.name}
            </Button>
          </div>
        ))}
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
      {field && (
        <DialogShell
          title={field.name}
          subtitle="Field evidence and camera match"
          onClose={() => setSelected(null)}
          size="xl"
        >
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
                <input
                  className={FORM_INPUT_CLASS}
                  value={annotation}
                  onChange={(e) => setAnnotation(e.target.value)}
                />
              </FormField>
              <p className="text-xs">
                Click the image to label a ridge, drainage, skyline, natural pattern or design issue.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => change({ annotations: field.annotations.slice(0, -1) })}
              >
                Undo last annotation
              </Button>
              {!pose && (
                <InlineAlert>
                  Record position, heading, field of view and camera elevation to project the proposal. A matching
                  sampled station can supply estimated camera elevation.
                </InlineAlert>
              )}
            </div>
            <div className="space-y-3">
              <FormField label="Evidence name">
                <input
                  className={FORM_INPUT_CLASS}
                  value={field.name}
                  onChange={(e) => change({ name: e.target.value })}
                />
              </FormField>
              <FormField label="Evidence viewpoint">
                <NativeSelect value={field.viewId ?? ''} onChange={(e) => change({ viewId: e.target.value || null })}>
                  <option value="">Not linked</option>
                  {d.views.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </NativeSelect>
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
              <Button
                size="sm"
                variant="outline"
                disabled={field.lng === null || field.lat === null}
                onClick={() => {
                  if (field.lng !== null && field.lat !== null) addView([field.lng, field.lat], field.name)
                }}
              >
                Record photo location as viewpoint
              </Button>
            </div>
          </div>
        </DialogShell>
      )}
    </SidebarSection>
  )
}
