/**
 * Volume weighting for suggested cable lines: off (area alone, the default), VRI live stand volume
 * fetched over the block, or an imported volume raster. States the source and how much of the
 * yardable ground it covers.
 */
import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { Field, RoadSelect } from './Controls'
import type { VolumeWeights } from './cableVolume'

export type VolumeChoice = 'none' | 'vri' | 'raster'
const OPTIONS: { value: VolumeChoice; label: string }[] = [
  { value: 'none', label: 'Area only' },
  { value: 'vri', label: 'VRI live volume' },
  { value: 'raster', label: 'Volume raster (m³/ha)' },
]

export function CableVolumeSource({
  choice,
  onChoice,
  weights,
  status,
  onFetchVri,
  onRaster,
  busy,
}: {
  choice: VolumeChoice
  onChoice: (choice: VolumeChoice) => void
  weights: VolumeWeights | null
  /** A message about the last read: an error, or what came back. */
  status: string
  onFetchVri: () => void
  onRaster: (file: File) => void
  busy: boolean
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-1" data-testid="cable-volume">
      <Field
        label="Weight lines by"
        hint={
          <>
            Off by default. With a volume, each suggested line is chosen by the volume of the new ground it yards rather
            than its area. Ground the source has no figure for counts at the mean of the known ground, and line volumes
            count known volume only.
          </>
        }
      >
        <RoadSelect
          ariaLabel="Weight suggested lines by"
          value={choice}
          onValueChange={(value) => onChoice(value as VolumeChoice)}
          options={OPTIONS}
        />
      </Field>
      {choice === 'vri' && (
        <div className="flex items-center gap-1">
          <Button size="xs" variant="outline" disabled={busy} onClick={onFetchVri}>
            {weights ? 'Read VRI again' : 'Read VRI over the block'}
          </Button>
          <InfoTip label="About VRI volume">
            VRI rank-1 LIVE_STAND_VOLUME_125, live from DataBC: the inventory&apos;s projected live volume at 12.5 cm+
            utilisation, a polygon average from photo interpretation and yield models, not a cruise.
          </InfoTip>
        </div>
      )}
      {choice === 'raster' && (
        <div className="flex items-center gap-1">
          <Button size="xs" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
            Choose GeoTIFF
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".tif,.tiff,image/tiff"
            className="hidden"
            aria-label="Volume raster GeoTIFF"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) onRaster(file)
              event.target.value = ''
            }}
          />
          <span className="text-2xs text-muted-foreground">Single band, m³/ha, north-up.</span>
        </div>
      )}
      {choice !== 'none' && weights && (
        <p className="text-2xs text-muted-foreground tabular-nums" data-testid="cable-volume-source">
          {weights.source}: {weights.knownHa.toFixed(1)} ha of yardable ground at a mean{' '}
          {Math.round(weights.meanPerHa ?? 0)} m³/ha
          {weights.unknownHa > 0 ? `; ${weights.unknownHa.toFixed(1)} ha has no figure` : ''}.
        </p>
      )}
      {choice !== 'none' && status && <p className="text-2xs text-muted-foreground">{status}</p>}
    </div>
  )
}
