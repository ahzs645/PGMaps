import { useState } from 'react'
import { ChevronDown, ChevronUp, RotateCcw, Satellite, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert, MapGradientLegendItem } from '@/components/ui/map-panels'
import { RoadSelect } from '../Controls'
import { SENTINEL_CLEARING_NDVI_DROP, SENTINEL_FIRST_YEAR, SENTINEL_RECENT_DAYS } from './limits'
import { NDVI_CHANGE_STOPS, NDVI_STOPS } from './render'
import type { RatedScene, Sentinel2State, SentinelMode } from './useSentinel2'

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

/**
 * The Sentinel-2 layer's card on the plan: the scene list, display mode and, for a change view, the
 * two scenes and the interval a clearing appeared in. Values here; explanations behind the InfoTips.
 */
export function Sentinel2Panel({ state, onClose }: { state: Sentinel2State; onClose: () => void }) {
  const [folded, setFolded] = useState(false)
  const thisYear = new Date().getFullYear()
  const years = Array.from({ length: thisYear - SENTINEL_FIRST_YEAR + 1 }, (_, i) => thisYear - i)
  const pickable = state.pickable
  return (
    <section
      className="w-64 max-w-full overflow-y-auto overscroll-none rounded-md border bg-background/95 p-2 text-xs shadow-sm"
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
          is the share of the terrain window whose scene classification sees ground (not cloud, shadow or snow).
        </InfoTip>
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          aria-label={folded ? 'Show Sentinel-2 settings' : 'Fold Sentinel-2 settings'}
          aria-expanded={!folded}
          onClick={() => setFolded(!folded)}
        >
          {folded ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
        </Button>
        <Button size="icon" variant="ghost" className="size-6" aria-label="Hide Sentinel-2 imagery" onClick={onClose}>
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
              options={[
                { value: 'true-colour', label: 'True colour' },
                { value: 'ndvi', label: 'NDVI' },
                { value: 'change', label: 'NDVI change' },
              ]}
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
          {state.failure && (
            <InlineAlert tone="error">
              <span>{state.failure.message}</span>
              {state.failure.retry && (
                <Button size="sm" variant="outline" className="mt-1 h-6 w-full" onClick={state.retry}>
                  <RotateCcw className="size-3" />
                  Retry
                </Button>
              )}
            </InlineAlert>
          )}
          {state.searching && !state.scenes.length && <InlineAlert loading>Searching scenes…</InlineAlert>}
          {state.mode === 'change'
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
                        className={`flex w-full items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left hover:bg-accent ${state.sceneId === scene.id ? 'bg-accent font-medium text-accent-foreground' : ''}`}
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
          {state.mode === 'ndvi' && state.image && (
            <MapGradientLegendItem
              aria-label="NDVI colours"
              colors={gradient(NDVI_STOPS)}
              minLabel={`NDVI ≤ ${NDVI_STOPS[0][0]}`}
              maxLabel={`${NDVI_STOPS[NDVI_STOPS.length - 1][0]}+`}
              labelClassName="text-2xs"
            />
          )}
          {state.mode === 'change' && state.image && state.change && (
            <>
              <MapGradientLegendItem
                aria-label="NDVI change colours"
                colors={gradient(NDVI_CHANGE_STOPS)}
                minLabel="Loss"
                maxLabel="Gain"
                labelClassName="text-2xs"
              />
              <p data-testid="road-sentinel2-change">
                {state.change.clearedHa > 0 ? (
                  <>
                    Clearing on {state.change.clearedHa.toFixed(1)} ha: {state.change.label} (Sentinel-2)
                  </>
                ) : (
                  <>No clearing between the two scenes</>
                )}
                <InfoTip label="About the NDVI change" className="ml-1 align-middle" bubbleClassName="max-w-72">
                  A clearing is a pixel whose NDVI fell by {SENTINEL_CLEARING_NDVI_DROP} or more between the two scenes,
                  where both see clear ground ({percent(state.change.comparedShare)} of the window). It means the ground
                  was cleared some time in that interval, not that a road was built or is drivable, and a spur cannot be
                  told apart from its block&apos;s own clearing. A bracket over November–April is marked as a snow gap.
                </InfoTip>
              </p>
            </>
          )}
          {state.credit && <p className="text-2xs text-muted-foreground">{state.credit}</p>}
        </div>
      )}
    </section>
  )
}
