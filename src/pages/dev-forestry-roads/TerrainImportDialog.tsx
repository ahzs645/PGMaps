import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { CheckboxField } from '@/components/ui/form-field'
import { InfoTip } from '@/components/ui/info-tip'
import { Field, roadFieldClass, RoadSelect } from './Controls'
import {
  ALIGNMENT_CRS_CHOICES,
  POINT_CLOUD_CRS_CHOICES,
  type TerrainImportAnswers,
  type TerrainImportNeeds,
} from './terrain'
import type { TerrainMetadata } from './types'

/**
 * Vertical datums BC terrain usually comes in. The CGVD2013 text is the published LiDAR sample's own,
 * so a cloud stated in it can be combined with that sample: sources combine only on identical text.
 */
export const VERTICAL_DATUM_CHOICES = [
  'CGVD2013 (CGG2013), EPSG:6647; metres',
  'CGVD28 (HT2.0), EPSG:5713; metres',
  'NAVD88, EPSG:5703; metres',
  'Ellipsoidal height (GRS80); metres',
] as const
const OTHER = 'other'
const whole = (n: number) => n.toLocaleString('en-CA', { maximumFractionDigits: 0 })
const listed = (files: string[]) =>
  files.length <= 3 ? files.join(', ') : `${files.slice(0, 2).join(', ')} and ${files.length - 2} more`

/**
 * Asks for what a terrain file does not state: the CRS of a point cloud without one, the vertical
 * datum, or both. Nothing is taken from the open terrain unless it is chosen here. It also asks
 * for the CRS of an alignment file that names none (`needs.crs.subject: 'alignment'`), for which
 * the open terrain's CRS is never preselected.
 */
export function TerrainImportDialog({
  needs,
  current,
  onAnswer,
  onCancel,
  portalContainer,
}: {
  needs: TerrainImportNeeds
  /** The open terrain, offered as a choice and never applied by default for the datum. */
  current: Pick<TerrainMetadata, 'kind' | 'epsg' | 'verticalReference'>
  onAnswer: (answers: TerrainImportAnswers) => void
  onCancel: () => void
  portalContainer?: HTMLElement | null
}) {
  const drawing = needs.crs?.subject === 'drawing'
  const alignment = needs.crs?.subject === 'alignment' || drawing
  const [unit, setUnit] = useState('')
  const choices = alignment ? ALIGNMENT_CRS_CHOICES : POINT_CLOUD_CRS_CHOICES
  const offered = (epsg: number | undefined) => choices.some((choice) => choice.epsg === epsg)
  const openEpsg = !alignment && current.kind === 'geotiff' && offered(current.epsg) ? current.epsg : undefined
  const [epsg, setEpsg] = useState(String(needs.crs?.suggestedEpsg ?? openEpsg ?? ''))
  const openDatum =
    current.kind === 'geotiff' && !VERTICAL_DATUM_CHOICES.includes(current.verticalReference as never)
      ? current.verticalReference
      : ''
  const [datum, setDatum] = useState('')
  const [otherDatum, setOtherDatum] = useState('')
  const [metres, setMetres] = useState(false)
  const stated = datum === OTHER ? otherDatum.trim() : datum
  const ready =
    (!needs.crs || !!epsg) &&
    (!needs.units || !!unit) &&
    (!needs.verticalDatum || (!!stated && stated.length <= 300 && metres))
  const files = [
    ...new Set([...(needs.crs?.files ?? []), ...(needs.verticalDatum?.files ?? []), ...(needs.units?.files ?? [])]),
  ]
  return (
    <PanelDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title={
        drawing || needs.units
          ? 'Place the imported drawing'
          : alignment
            ? 'Place the imported alignment'
            : 'Finish the terrain import'
      }
      subtitle={listed(files)}
      size="md"
      portalContainer={portalContainer}
      contentProps={{ 'data-testid': 'road-terrain-import-question' }}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!ready}
            onClick={() =>
              onAnswer({
                ...(needs.crs ? { epsg: Number(epsg) } : {}),
                ...(needs.units ? { unitM: Number(unit) } : {}),
                ...(needs.verticalDatum ? { verticalReference: stated } : {}),
              })
            }
          >
            Import
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {needs.crs && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium">
                {needs.crs.files.length === 1 ? 'This file states' : 'These files state'} no CRS
              </p>
              <InfoTip label="About stating a CRS">
                {alignment
                  ? "The CRS turns the design's coordinates into a place. The tool cannot check it: in the wrong zone the road lands somewhere else, off its terrain. Ask whoever made the design which CRS its coordinates are in."
                  : 'The CRS turns the file’s coordinates into a place. The tool cannot check it: in the wrong zone the terrain lands somewhere else, and every station of a road reads as missing. A CRS a file states is never overridden.'}
              </InfoTip>
            </div>
            <p className="text-xs tabular-nums text-muted-foreground" data-testid="road-terrain-import-extent">
              {alignment ? 'Coordinate extent' : 'Header extent'}: X {whole(needs.crs.bounds[0])} to{' '}
              {whole(needs.crs.bounds[2])} · Y {whole(needs.crs.bounds[1])} to {whole(needs.crs.bounds[3])}
            </p>
            <Field label={drawing ? 'CRS of the drawing' : alignment ? 'CRS of the design' : 'CRS of the point cloud'}>
              <RoadSelect
                ariaLabel={drawing ? 'CRS of the drawing' : alignment ? 'CRS of the design' : 'CRS of the point cloud'}
                className={roadFieldClass}
                value={epsg}
                placeholder="Choose the CRS"
                onValueChange={setEpsg}
                options={choices.map((choice) => ({
                  value: String(choice.epsg),
                  label:
                    choice.epsg === needs.crs?.suggestedEpsg
                      ? `${choice.label} (the other files)`
                      : choice.epsg === openEpsg
                        ? `${choice.label} (the open terrain)`
                        : choice.label,
                }))}
              />
            </Field>
          </div>
        )}
        {needs.units && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium">
                {needs.units.stated
                  ? `The drawing says its units are ${needs.units.stated}`
                  : 'The drawing does not say its units'}
              </p>
              <InfoTip label="About drawing units">
                CAD templates set a drawing&apos;s units by default, so the stated unit is often not what the
                coordinates are in. Choose what the coordinates were measured in; a projected CRS takes metres.
              </InfoTip>
            </div>
            <Field label="Coordinates are in">
              <RoadSelect
                ariaLabel="Coordinates are in"
                className={roadFieldClass}
                value={unit}
                placeholder="Choose the unit"
                onValueChange={setUnit}
                options={[
                  { value: '1', label: 'Metres' },
                  { value: '0.3048', label: 'International feet' },
                  { value: String(1200 / 3937), label: 'US survey feet' },
                ]}
              />
            </Field>
          </div>
        )}
        {needs.verticalDatum && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium">The elevations name no vertical datum</p>
              <InfoTip label="About the vertical datum">
                The datum is recorded with the terrain and printed on every export. Nothing is converted: CGVD28 and
                CGVD2013 differ by decimetres, and terrain can be combined only with terrain in the same datum.
              </InfoTip>
            </div>
            <Field label="Vertical datum of the elevations">
              <RoadSelect
                ariaLabel="Vertical datum of the elevations"
                className={roadFieldClass}
                value={datum}
                placeholder="Choose the datum"
                onValueChange={setDatum}
                options={[
                  ...(openDatum ? [{ value: openDatum, label: `Same as the open terrain: ${openDatum}` }] : []),
                  ...VERTICAL_DATUM_CHOICES.map((choice) => ({
                    value: choice,
                    label: choice === current.verticalReference ? `${choice} (the open terrain)` : choice,
                  })),
                  { value: OTHER, label: 'Another datum' },
                ]}
              />
            </Field>
            {datum === OTHER && (
              <Field label="Name of the vertical datum">
                <input
                  className={roadFieldClass}
                  value={otherDatum}
                  maxLength={300}
                  placeholder="e.g. local mine datum; metres"
                  onChange={(event) => setOtherDatum(event.target.value)}
                />
              </Field>
            )}
            <CheckboxField
              label="Elevations are in metres"
              description="Heights are recorded as metres and never converted."
              checked={metres}
              onCheckedChange={setMetres}
            />
          </div>
        )}
      </div>
    </PanelDialog>
  )
}
