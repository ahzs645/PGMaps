import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { InfoTip } from '@/components/ui/info-tip'
import { Field, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import { localPlaneProjection, MAX_CONTROL_POINTS, preparePlacement, type Placement } from './localPlane'
import { PROJECTED_CRS_CHOICES } from './terrain'
import type { Coordinate, RoadProject } from './types'

interface ControlRow {
  point: string
  lat: number | null
  lon: number | null
}

const fixed = (n: number, digits: number) => n.toLocaleString('en-CA', { maximumFractionDigits: digits })

/**
 * Places a project on the flat plane on the map (`localPlane.ts`): in the coordinate system its
 * coordinates are in, exactly, or by matching two or more design points to map positions. The fit
 * and each point's residual show before anything moves; nothing is written until **Place**.
 */
export function PlaceOnMapDialog({
  project,
  onPlace,
  onCancel,
  portalContainer,
}: {
  project: RoadProject
  onPlace: (placement: Placement) => void
  onCancel: () => void
  portalContainer?: HTMLElement | null
}) {
  const local = project.terrain.localPlane!
  const feet = Math.abs(local.unitM - 1) > 1e-12
  const [method, setMethod] = useState<'crs' | 'control'>(feet ? 'control' : 'crs')
  const [epsg, setEpsg] = useState('')
  const projection = useMemo(() => localPlaneProjection(local.offsetM), [local.offsetM])
  // Every road point, with the coordinates the design file gives it.
  const points = useMemo(
    () =>
      project.alignments.flatMap((road) =>
        road.points.map((p, k) => {
          const [x, y] = projection.toFile(p.coordinate)
          const which = k === 0 ? 'start' : k === road.points.length - 1 ? 'end' : `PI ${k}`
          return {
            value: `${road.id}:${k}`,
            label: `${road.name} · ${which} · E ${fixed(x / local.unitM, 2)} N ${fixed(y / local.unitM, 2)}`,
            coordinate: p.coordinate,
          }
        }),
      ),
    [project.alignments, projection, local.unitM],
  )
  const [rows, setRows] = useState<ControlRow[]>(() => [
    { point: points[0]?.value ?? '', lat: null, lon: null },
    { point: points[points.length - 1]?.value ?? '', lat: null, lon: null },
  ])
  const placement: Placement | null = useMemo(() => {
    if (method === 'crs') return epsg ? { kind: 'crs', epsg: Number(epsg) } : null
    const pairs: { from: Coordinate; to: Coordinate }[] = []
    for (const row of rows) {
      const from = points.find((p) => p.value === row.point)?.coordinate
      if (!from || row.lat === null || row.lon === null) return null
      pairs.push({ from, to: [row.lon, row.lat] })
    }
    return pairs.length >= 2 ? { kind: 'control', pairs } : null
  }, [method, epsg, rows, points])
  // A dry run: the fit and anything that would refuse, before the person commits. The terrain is
  // only resampled on Place.
  const trial = useMemo(() => {
    if (!placement) return null
    try {
      return { result: preparePlacement(project, placement), error: null }
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : 'This placement cannot be made.' }
    }
  }, [placement, project])
  const fit = trial?.result?.similarity ?? null
  const update = (k: number, change: Partial<ControlRow>) =>
    setRows((current) => current.map((row, i) => (i === k ? { ...row, ...change } : row)))
  return (
    <PanelDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title="Place on map"
      subtitle={local.source}
      size="md"
      portalContainer={portalContainer}
      contentProps={{ 'data-testid': 'road-place-on-map' }}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" disabled={!placement || !trial?.result} onClick={() => placement && onPlace(placement)}>
            Place
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-1.5">
          <p className="text-sm">
            This project is on a flat plane: its design named no coordinate system this workspace converts.
          </p>
          <InfoTip label="About placing a project">
            Roads, layers, D-lines, notes and terrain move together. In a coordinate system the design&apos;s own
            coordinates are read exactly and the terrain grid is kept cell for cell. With control points the design is
            shifted, turned and scaled to fit them, and the terrain is resampled. Undo puts it back on the plane.
          </InfoTip>
        </div>
        <Field label="How to place it">
          <RoadSelect
            ariaLabel="How to place it"
            className={roadFieldClass}
            value={method}
            onValueChange={(value) => setMethod(value as 'crs' | 'control')}
            options={[
              {
                value: 'crs',
                label: feet ? 'Coordinate system (needs a design in metres)' : 'Its coordinate system',
                disabled: feet,
              },
              { value: 'control', label: 'Control points' },
            ]}
          />
        </Field>
        {method === 'crs' ? (
          <Field label="Coordinate system of the design">
            <RoadSelect
              ariaLabel="Coordinate system of the design"
              className={roadFieldClass}
              value={epsg}
              placeholder="Choose the CRS"
              searchable
              onValueChange={setEpsg}
              options={PROJECTED_CRS_CHOICES.map((choice) => ({ value: String(choice.epsg), label: choice.label }))}
            />
          </Field>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Match design points to where they are, in latitude and longitude (WGS84 or NAD83).
            </p>
            {rows.map((row, k) => (
              <div key={k} className="grid grid-cols-[1fr_7rem_7rem_auto] items-end gap-2">
                <Field label={k === 0 ? 'Design point' : ''}>
                  <RoadSelect
                    ariaLabel={`Design point ${k + 1}`}
                    className={roadFieldClass}
                    value={row.point}
                    searchable
                    onValueChange={(point) => update(k, { point })}
                    options={points.map((p) => ({ value: p.value, label: p.label }))}
                  />
                </Field>
                <OptionalNumberField
                  label={k === 0 ? 'Latitude' : `Latitude ${k + 1}`}
                  hideLabel={k > 0}
                  value={row.lat}
                  min={-90}
                  max={90}
                  step={0.000001}
                  placeholder="°"
                  onChange={(lat) => update(k, { lat })}
                />
                <OptionalNumberField
                  label={k === 0 ? 'Longitude' : `Longitude ${k + 1}`}
                  hideLabel={k > 0}
                  value={row.lon}
                  min={-180}
                  max={180}
                  step={0.000001}
                  placeholder="°"
                  onChange={(lon) => update(k, { lon })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove control point ${k + 1}`}
                  disabled={rows.length <= 2}
                  onClick={() => setRows((current) => current.filter((_, i) => i !== k))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              disabled={rows.length >= MAX_CONTROL_POINTS}
              onClick={() =>
                setRows((current) => [...current, { point: points[0]?.value ?? '', lat: null, lon: null }])
              }
            >
              <Plus className="size-4" /> Control point
            </Button>
            {fit && (
              <p className="text-xs tabular-nums" data-testid="road-place-fit" role="status">
                Scale {fit.scale.toFixed(5)} · rotation {fit.rotationDeg.toFixed(3)}° · RMS {fit.rmsM.toFixed(3)} m
                {rows.length > 2 ? ` · residuals ${fit.residualsM.map((r) => r.toFixed(2)).join(', ')} m` : ''}
              </p>
            )}
          </div>
        )}
        {trial?.error && (
          <p className="text-xs text-destructive" role="alert">
            {trial.error}
          </p>
        )}
      </div>
    </PanelDialog>
  )
}
