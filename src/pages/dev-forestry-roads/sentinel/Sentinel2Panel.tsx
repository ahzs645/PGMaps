import { useState } from 'react'
import { ChevronDown, ChevronUp, RotateCcw, Satellite, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert, MapGradientLegendItem } from '@/components/ui/map-panels'
import { RoadSelect } from '../Controls'
import { SENTINEL_FIRST_YEAR, SENTINEL_RECENT_DAYS, SENTINEL_MIN_ZOOM } from './limits'
import { NDVI_STOPS, SENTINEL_INDICES, type SentinelIndex } from './indices'
import { Sentinel2AreaSeries, type AreaDrawing } from './Sentinel2AreaSeries'
import { isChangeMode, modeIndex, type RatedScene, type Sentinel2State, type SentinelMode } from './useSentinel2'

const percent = (share: number) => `${Math.round(share * 100)}%`
const gradient = (stops: typeof NDVI_STOPS) => {
  const [low, high] = [stops[0][0], stops[stops.length - 1][0]]
  return stops.map(([value, [r, g, b]]) => `rgb(${r} ${g} ${b}) ${((value - low) / (high - low)) * 100}%`)
}

function sceneValues(scene: RatedScene) {
  const cloud = scene.cloudPercent === null ? 'cloud ?' : `cloud ${Math.round(scene.cloudPercent)}%`
  const clear =
    scene.rating === undefined
      ? 'rating…'
      : scene.rating === null
        ? 'unread'
        : `clear ${percent(scene.rating.clear)}${scene.rating.coverage < 0.995 ? ` · covers ${percent(scene.rating.coverage)}` : ''}`
  return `${cloud} · ${clear}`
}

const sceneOption = (scene: RatedScene) => ({ value: scene.id, label: `${scene.date} · ${sceneValues(scene)}` })

const INDEX_IDS = Object.keys(SENTINEL_INDICES) as SentinelIndex[]
const MODE_OPTIONS: { value: SentinelMode; label: string }[] = [
  { value: 'true-colour', label: 'True colour' },
  ...INDEX_IDS.map((id) => ({ value: id, label: SENTINEL_INDICES[id].label })),
  ...INDEX_IDS.map((id) => ({ value: `${id}-change` as SentinelMode, label: SENTINEL_INDICES[id].changeLabel })),
]

/**
 * The Sentinel-2 layer's card on the plan: the scene list, display mode and, for a change view, the
 * two scenes and the interval a clearing appeared in. Values here; explanations behind the InfoTips.
 */
export function Sentinel2Panel({
  state,
  paused,
  moving,
  onClose,
  drawing,
}: {
  state: Sentinel2State
  paused: boolean
  moving: boolean
  onClose: () => void
  /** The plan's area sketch, for the area series. */
  drawing: AreaDrawing
}) {
  const [folded, setFolded] = useState(false)
  const thisYear = new Date().getFullYear()
  const years = Array.from({ length: thisYear - SENTINEL_FIRST_YEAR + 1 }, (_, i) => thisYear - i)
  const pickable = state.pickable
  const index = modeIndex(state.mode)
  const spec = index ? SENTINEL_INDICES[index] : null
  const comparing = isChangeMode(state.mode)
  return (
    <section
      className={`${state.area || drawing.active ? 'w-80' : 'w-64'} max-w-full overflow-y-auto overscroll-none rounded-md border bg-background/95 p-2 text-xs shadow-sm`}
      style={{ maxHeight: 'inherit' }}
      aria-label="Sentinel-2 imagery"
      data-testid="road-sentinel2-panel"
      data-map-export-ignore
    >
      <div className="flex items-center gap-1">
        <Satellite className="size-3.5 shrink-0" aria-hidden="true" />
        <h3 className="min-w-0 flex-1 truncate font-semibold">Sentinel-2</h3>
        <InfoTip label="About Sentinel-2 imagery" bubbleClassName="max-w-72">
          Copernicus Sentinel-2 level-2A scenes from Element 84&apos;s Earth Search, read from the AWS archive. Pixels
          are 10 m, so a 4–6 m road shows only where its cleared corridor is wide enough. The imagery is evidence for
          review: it is never a constraint, never feeds a route search and is not proof of a road. &ldquo;Clear&rdquo;
          is the share of the map window whose scene classification sees ground (not cloud, shadow or snow).
        </InfoTip>
        <Button
          size="icon-2xs"
          variant="ghost"
          aria-label={folded ? 'Show Sentinel-2 settings' : 'Fold Sentinel-2 settings'}
          aria-expanded={!folded}
          onClick={() => setFolded(!folded)}
        >
          {folded ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
        </Button>
        <Button size="icon-2xs" variant="ghost" aria-label="Hide Sentinel-2 imagery" onClick={onClose}>
          <X className="size-3" />
        </Button>
      </div>
      {!folded && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-1">
            <RoadSelect
              ariaLabel="Sentinel-2 display"
              value={state.mode}
              onValueChange={(value) => state.setMode(value as SentinelMode)}
              options={MODE_OPTIONS}
            />
            <RoadSelect
              ariaLabel="Sentinel-2 scenes from"
              value={String(state.range)}
              onValueChange={(value) => state.setRange(value === 'recent' ? 'recent' : Number(value))}
              options={[
                { value: 'recent', label: `Last ${SENTINEL_RECENT_DAYS / 365} years` },
                ...years.map((year) => ({ value: String(year), label: `${year} Jun–Sep` })),
              ]}
            />
          </div>
          {paused && <InlineAlert>Zoom in to level {SENTINEL_MIN_ZOOM} to load Sentinel-2 for this view.</InlineAlert>}
          {!paused && moving && <InlineAlert>Imagery updates when you stop moving the map.</InlineAlert>}
          {state.failure && (
            <InlineAlert tone="error">
              <span>{state.failure.message}</span>
              {state.failure.retry && (
                <Button size="2xs" variant="outline" className="mt-1 w-full" onClick={state.retry}>
                  <RotateCcw className="size-3" />
                  Retry
                </Button>
              )}
            </InlineAlert>
          )}
          {state.searching && !state.scenes.length && <InlineAlert loading>Searching scenes…</InlineAlert>}
          {comparing
            ? pickable.length >= 2 && (
                <div className="space-y-1">
                  <div>
                    <span className="text-muted-foreground">Earlier scene</span>
                    <RoadSelect
                      ariaLabel="Earlier Sentinel-2 scene"
                      value={state.pair.before ?? ''}
                      placeholder="Pick a scene"
                      onValueChange={(before) => state.setPair((pair) => ({ ...pair, before }))}
                      options={pickable.map(sceneOption)}
                    />
                  </div>
                  <div>
                    <span className="text-muted-foreground">Later scene</span>
                    <RoadSelect
                      ariaLabel="Later Sentinel-2 scene"
                      value={state.pair.after ?? ''}
                      placeholder="Pick a scene"
                      onValueChange={(after) => state.setPair((pair) => ({ ...pair, after }))}
                      options={pickable.map(sceneOption)}
                    />
                  </div>
                </div>
              )
            : state.scenes.length > 0 && (
                <ul className="max-h-44 space-y-0.5 overflow-y-auto" aria-label="Sentinel-2 scenes">
                  {state.scenes.map((scene) => (
                    <li key={scene.id}>
                      <button
                        type="button"
                        className={`flex w-full items-baseline justify-between gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent ${state.sceneId === scene.id ? 'bg-accent font-medium text-accent-foreground' : ''}`}
                        aria-pressed={state.sceneId === scene.id}
                        data-scene-id={scene.id}
                        onClick={() => state.setSceneId(scene.id)}
                      >
                        <span className="shrink-0 tabular-nums">{scene.date}</span>
                        <span className="truncate text-2xs text-muted-foreground">{sceneValues(scene)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          {state.imageLoading && <InlineAlert loading>Reading imagery…</InlineAlert>}
          {spec && !comparing && state.image && (
            <div className="flex items-start gap-1">
              <MapGradientLegendItem
                className="flex-1"
                aria-label={`${spec.label} colours`}
                colors={gradient(spec.stops)}
                minLabel={`${spec.label} ≤ ${spec.stops[0][0]}`}
                maxLabel={`${spec.stops[spec.stops.length - 1][0]}+`}
                labelClassName="text-2xs"
              />
              <InfoTip label={`About ${spec.label}`} bubbleClassName="max-w-72">
                {spec.about} Cloud, shadow, snow and no-data pixels are left clear.
              </InfoTip>
            </div>
          )}
          {spec && comparing && state.image && state.change && (
            <>
              <MapGradientLegendItem
                aria-label={`${spec.changeLabel} colours`}
                colors={gradient(spec.changeStops)}
                minLabel="Loss"
                maxLabel="Gain"
                labelClassName="text-2xs"
              />
              <p data-testid="road-sentinel2-change">
                {state.change.changedHa > 0 ? (
                  <>
                    {spec.changed} on {state.change.changedHa.toFixed(1)} ha: {state.change.label} (Sentinel-2)
                  </>
                ) : (
                  <>{spec.unchanged}</>
                )}
                <InfoTip
                  label={`About the ${spec.changeLabel}`}
                  className="ml-1 align-middle"
                  bubbleClassName="max-w-72"
                >
                  {spec.about} A pixel counts when its {spec.label} fell by {spec.drop} or more between the two scenes,
                  where both see clear ground ({percent(state.change.comparedShare)} of the window). It means the ground
                  changed some time in that interval, not that a road was built or is drivable, and a spur cannot be
                  told apart from its block&apos;s own clearing. A bracket over November–April is marked as a snow gap.
                </InfoTip>
              </p>
            </>
          )}
          <Sentinel2AreaSeries
            area={state.area}
            series={state.series}
            drawing={drawing}
            selectedSceneId={comparing ? state.pair.after : state.sceneId}
            onClear={() => state.setArea(null)}
          />
          {state.credit && <p className="text-2xs text-muted-foreground">{state.credit}</p>}
        </div>
      )}
    </section>
  )
}
