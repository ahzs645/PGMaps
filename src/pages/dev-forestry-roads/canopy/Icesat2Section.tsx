import { useRef } from 'react'
import { fromUrl } from 'geotiff'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { stationBounds } from '@/lib/forestry/canopy/chmView'
import { EGM2008_URL, geoidAt, readGeoid, type GeoidTiff } from '@/lib/forestry/canopy/geoid'
import {
  fetchGroundPhotons,
  granuleDate,
  ICESAT2_MAX_BOX_DEG2,
  SLIDERULE_CREDIT,
} from '@/lib/forestry/canopy/sliderule'
import { RoadSection } from '../SidebarParts'
import { isoDate } from '../projectIssue'
import { terrainFromMetadata } from '../terrain'
import type { Alignment, RoadAnalysis, TerrainMetadata } from '../types'
import { ICESAT2_CHECK, icesat2Check } from './icesat2Check'
import { getIcesat2Run, icesat2Key, setIcesat2Run, useIcesat2Run } from './icesat2Store'

const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)} m`

/**
 * Review's ICESat-2 ground check: reads ground photons round the active road from SlideRule (one to
 * several minutes), puts them on EGM2008 and compares 20 m bins with the project terrain. The result
 * stays for the session and feeds Review's "Terrain at the height ICESat-2 measures" row.
 */
export function Icesat2Section({
  terrain,
  alignment,
  analysis,
}: {
  terrain: TerrainMetadata
  alignment: Pick<Alignment, 'id' | 'name'>
  analysis: Pick<RoadAnalysis, 'stations'>
}) {
  const key = icesat2Key(terrain, alignment.id)
  const run = useIcesat2Run(key)
  const abort = useRef<AbortController | null>(null)
  const unavailable =
    terrain.kind === 'demo'
      ? 'The training terrain is synthetic: there is nothing to check it against.'
      : !analysis.stations.length
        ? 'The road has no calculated stations.'
        : null
  const box = analysis.stations.length
    ? stationBounds(
        analysis.stations.map((s) => s.coordinate),
        ICESAT2_CHECK.marginM,
      )
    : null
  const tooLarge = box && (box[2] - box[0]) * (box[3] - box[1]) > ICESAT2_MAX_BOX_DEG2

  const start = async () => {
    if (!box || getIcesat2Run(key)?.status === 'running') return
    const source = terrainFromMetadata(terrain)
    if (!source) return setIcesat2Run(key, { status: 'error', message: 'The terrain is not loaded in this session.' })
    const controller = new AbortController()
    abort.current = controller
    const startedAt = Date.now()
    let stage = 'Listing ICESat-2 passes (NASA CMR)'
    setIcesat2Run(key, { status: 'running', startedAt, bytes: 0, stage })
    try {
      const reply = await fetchGroundPhotons(box, fetch, {
        signal: controller.signal,
        onStage: (next) => {
          stage = next
          setIcesat2Run(key, { status: 'running', startedAt, bytes: 0, stage })
        },
        onProgress: (bytes) => setIcesat2Run(key, { status: 'running', startedAt, bytes, stage }),
      })
      setIcesat2Run(key, { status: 'running', startedAt, bytes: 0, stage: 'Reading the EGM2008 geoid' })
      const geoid = await readGeoid(
        box,
        (await fromUrl(EGM2008_URL, { allowFullFile: false, credentials: 'omit' })) as unknown as GeoidTiff,
      )
      const result = icesat2Check({
        photons: reply.photons,
        allDates: reply.allDates,
        unreadDates: reply.granulesFailed.flatMap((g) => granuleDate(g) ?? []),
        passesAsked: reply.granulesRead,
        geoidAt: (lon, lat) => geoidAt(geoid, lon, lat),
        elevationAt: (lon, lat) => source.elevationAt(lon, lat),
        terrainName: terrain.name,
        terrainDatum: terrain.verticalReference || 'no vertical datum',
        box,
        checkedOn: isoDate(new Date()),
        seconds: (Date.now() - startedAt) / 1000,
      })
      setIcesat2Run(key, { status: 'done', result })
    } catch (error) {
      setIcesat2Run(
        key,
        controller.signal.aborted
          ? null
          : { status: 'error', message: error instanceof Error ? error.message : 'The ICESat-2 check failed.' },
      )
    }
  }

  const result = run?.status === 'done' ? run.result : null
  const all = result?.summary.all
  const summary = result
    ? all
      ? `${signed(all.medianM)} · ${all.bins} bins`
      : 'no bins'
    : run?.status === 'running'
      ? 'running…'
      : 'not checked'
  return (
    <RoadSection
      title="ICESat-2 ground check"
      summary={summary}
      help={`Compares the terrain with NASA's ICESat-2 laser ground photons (ATL08 ground class, snow-free June–October passes) within ${ICESAT2_CHECK.marginM} m of the road, read through SlideRule Earth's public service and put on EGM2008. Each ${ICESAT2_CHECK.binM} m of a beam is one bin. ICESat-2 ground matched airborne LiDAR to 0.05 m near Prince George, so a median offset says the terrain's datum or source is off; it says nothing about any single station, and passes are often hundreds of metres apart. Evidence beside the terrain: it never changes it. The check lasts for this session.`}
      data-testid="road-icesat2-section"
    >
      {unavailable && <InlineAlert>{unavailable}</InlineAlert>}
      {!unavailable && tooLarge && (
        <InlineAlert tone="warning">
          The road&apos;s box is larger than SlideRule can read in reasonable time ({ICESAT2_MAX_BOX_DEG2} deg²).
        </InlineAlert>
      )}
      {run?.status === 'running' && (
        <InlineAlert loading>
          {run.stage}
          {run.bytes ? ` · ${(run.bytes / 1e6).toFixed(1)} MB` : ''}. SlideRule opens each snow-free pass's granule,
          which takes one to ten minutes as its public cluster allows.
        </InlineAlert>
      )}
      {run?.status === 'error' && <InlineAlert tone="error">{run.message}</InlineAlert>}
      {result && (
        <div className="space-y-1 text-xs" data-testid="road-icesat2-result">
          {all ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
              <dt className="text-muted-foreground">Terrain − ICESat-2</dt>
              <dd>
                median {signed(all.medianM)} · spread {all.robustSpreadM.toFixed(2)} m · {all.bins} bins
              </dd>
              {result.summary.bySlope
                .filter((s) => s.stats)
                .map((s) => (
                  <div key={s.slope} className="contents">
                    <dt className="text-muted-foreground">Slope {s.slope}</dt>
                    <dd>
                      {signed(s.stats!.medianM)} · {s.stats!.bins} {s.stats!.bins === 1 ? 'bin' : 'bins'}
                    </dd>
                  </div>
                ))}
              <dt className="text-muted-foreground">Passes</dt>
              <dd>
                {result.passes.length} snow-free
                {result.winterPasses.length ? ` · ${result.winterPasses.length} winter left out` : ''}
                {result.unreadPasses.length
                  ? ` · ${result.unreadPasses.length} SlideRule could not read (${result.unreadPasses.join(', ')})`
                  : ''}
              </dd>
            </dl>
          ) : (
            <p>
              No ICESat-2 ground bins fall on the terrain round this road: {result.passesAsked} snow-free passes asked
              for, none with ground photons here
              {result.unreadPasses.length
                ? `. SlideRule could not read ${result.unreadPasses.length} of them (${result.unreadPasses.join(', ')}), so check again later`
                : ''}
              .
            </p>
          )}
          <p className="text-muted-foreground">
            {result.terrainName} ({result.terrainDatum}) · {result.photons.toLocaleString('en-CA')} photons ·{' '}
            {result.checkedOn} · {Math.round(result.seconds)} s. {SLIDERULE_CREDIT}.
          </p>
        </div>
      )}
      {!unavailable && !tooLarge && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            disabled={run?.status === 'running'}
            onClick={() => void start()}
          >
            {result ? 'Check again' : 'Check against ICESat-2'}
          </Button>
          {run?.status === 'running' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                abort.current?.abort()
                setIcesat2Run(key, null)
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      )}
    </RoadSection>
  )
}
