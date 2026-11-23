import type { ReactNode } from 'react'
import { SlidersHorizontal, Trees } from 'lucide-react'

import { CheckboxField, StyledSelect } from '@/components/ui/form-field'
import { InfoTip } from '@/components/ui/info-tip'
import { ToolbarPopover } from '@/components/ui/toolbar-popover'
import { LIVE_PRESETS } from '@/lib/forestry/viaFigure/presets'
import { LABEL_STYLES, type LabelStyleId } from '@/lib/mapSheet/callouts'
import { cn } from '@/lib/utils'

import {
  ENGINE_CLOUDS,
  ENGINE_LOOKS,
  ENGINE_VISIBILITY,
  ENGINE_WIND,
  ENGINE_WEATHER,
  SITE_TIME_ZONES,
  localDate,
  ROAD_RENDERERS,
  roadRendererUnavailable,
  roadRendererUrl,
  type EngineEnvironmentChoice,
  type RoadRendererId,
} from './externalRenderers'
import { setEngineBrowserOptions, useEngineBrowserOptions } from './engineBrowserOptions'
import { EngineRenderControls } from './EngineRenderControls'
import { DrawnTimberPanel, type DriveState } from './Sidebar'
import type { TargetPolygon } from './types'
import { LENS_FOCAL_LENGTHS, lensLabel } from './viewsOfInterest'
import { compassPoint, EVQO_COLORS, EVQO_NAMES, type EvqoCode } from './visualsNarrative'

const SELECT_CLASS =
  'h-7 w-full min-w-0 rounded-md border border-border bg-background px-1.5 text-2xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

export type LookArrow = { id: string; label: string; bearing: number }

/** How many of the panel's choices change the picture from its plain default, for the button's badge. */
export function roadViewOptionsCount(drive: DriveState): number {
  return [
    drive.showAnalysis,
    drive.reportLook,
    drive.showEvqo,
    drive.showLandform,
    drive.haze,
    !!drive.figureStyle,
  ].filter(Boolean).length
}

function Group({ title, help, children }: { title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t border-border/60 pt-2.5 first:border-t-0 first:pt-0" aria-label={title}>
      <h3 className="flex items-center gap-1 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
        {help}
      </h3>
      {children}
    </section>
  )
}

/**
 * One option: its label (with its explanation beside it) on the left, its control in a column of one width on the
 * right, so every row of the panel lines up. `stacked` puts a control too wide for the column (a date and a time)
 * under its label, full width. Not a `<label>`: a click on the explanation must not open the control.
 */
export function OptionRow({
  label,
  info,
  stacked = false,
  children,
}: {
  label: string
  info?: ReactNode
  stacked?: boolean
  children: ReactNode
}) {
  const title = (
    <span className="flex min-w-0 items-center gap-1 text-xs text-foreground">
      <span className="truncate">{label}</span>
      {info}
    </span>
  )
  if (stacked)
    return (
      <div className="space-y-1">
        {title}
        {children}
      </div>
    )
  return (
    <div className="flex items-center justify-between gap-2">
      {title}
      <div className="w-[10.5rem] shrink-0">{children}</div>
    </div>
  )
}
const Row = OptionRow

/**
 * Everything about how the road view looks, in its own panel on the road view's bar: where to look
 * and a jump to a view of the block, what is drawn over the ground, the VIA figure and label style,
 * and how the timber is drawn. Display only: none of it is in `sceneFingerprint` or the run.
 */
export function RoadViewOptions({
  drive,
  onDriveChange,
  blocks,
  lookArrows = [],
  jump,
  lensMm = null,
  onLensChange,
  distantTreesNote = null,
}: {
  drive: DriveState
  onDriveChange: (patch: Partial<DriveState>) => void
  blocks: ReadonlyArray<Pick<TargetPolygon, 'id' | 'name'>>
  /** Standing at an inventory viewpoint: its arrows, each a direction the view can face. */
  lookArrows?: ReadonlyArray<LookArrow>
  /** *Go to a view of the block*: places on the road that see the most of it. */
  jump?: ReactNode
  /**
   * The road view's lens, full-frame-equivalent millimetres (`LENS_FOCAL_LENGTHS`); null for MapLibre's own field.
   * Display only: a view saved with a lens set frames its analysis sheet with that lens.
   */
  lensMm?: number | null
  onLensChange?: (focalMm: number | null) => void
  /** *Distant trees*: why none are drawn yet, or at all (`useDriveTerrain`'s `forestContextNote`); null says nothing. */
  distantTreesNote?: string | null
}) {
  const arrowAt = (bearing: number) => lookArrows.find((entry) => Math.abs(entry.bearing - bearing) < 0.5)
  const engineOptions = useEngineBrowserOptions()
  const setEnvironment = (change: Partial<EngineEnvironmentChoice>) =>
    onDriveChange({ engineEnvironment: { ...drive.engineEnvironment, ...change } })
  return (
    <div className="space-y-2.5" data-testid="road-view-options">
      <Group title="Look">
        <Row label="Where to look">
          <StyledSelect
            className={cn(SELECT_CLASS, 'w-full')}
            value={
              drive.lookAtTargetId ??
              (drive.lookBearing !== null
                ? (() => {
                    const arrow = arrowAt(drive.lookBearing)
                    return arrow ? `arrow:${arrow.id}` : 'bearing'
                  })()
                : '')
            }
            onChange={(event) => {
              const value = event.target.value
              if (value === 'bearing') return
              const arrow = value.startsWith('arrow:')
                ? lookArrows.find((entry) => `arrow:${entry.id}` === value)
                : null
              onDriveChange(
                arrow
                  ? { lookAtTargetId: null, lookBearing: arrow.bearing }
                  : { lookAtTargetId: value || null, lookBearing: null },
              )
            }}
            aria-label="Where to look"
          >
            <option value="">Along the road</option>
            {blocks.map((block) => (
              <option key={block.id} value={block.id}>
                Face {block.name}
              </option>
            ))}
            {lookArrows.map((arrow) => (
              <option key={arrow.id} value={`arrow:${arrow.id}`}>
                {arrow.label}
              </option>
            ))}
            {/* Set by turning the view cone on the plan; picking it again keeps that bearing. */}
            {drive.lookBearing !== null && !arrowAt(drive.lookBearing) && (
              <option value="bearing">
                Turned on the map · {compassPoint(drive.lookBearing)} ({Math.round(drive.lookBearing)}°)
              </option>
            )}
          </StyledSelect>
        </Row>
        {onLensChange && (
          <Row
            label="Lens"
            info={
              <InfoTip label="About the lens">
                The field of view across the road view, as a full-frame camera lens. 50 mm is the reference sheets&apos;
                lens. A view saved with a lens set frames its analysis sheet with that lens; the field photo, while one
                is lined up, sets its own.
              </InfoTip>
            }
          >
            <StyledSelect
              className={cn(SELECT_CLASS, 'w-full')}
              value={lensMm === null ? '' : String(lensMm)}
              onChange={(event) => onLensChange(event.target.value ? Number(event.target.value) : null)}
              aria-label="Lens"
            >
              <option value="">Road view default</option>
              {LENS_FOCAL_LENGTHS.map((focal) => (
                <option key={focal} value={focal}>
                  {lensLabel(focal)}
                </option>
              ))}
              {/* A planned view's own lens (a field or focal length typed on its row) while it is stood at. */}
              {lensMm !== null && !(LENS_FOCAL_LENGTHS as readonly number[]).includes(lensMm) && (
                <option value={String(lensMm)}>{`${lensLabel(lensMm)} (the view's own)`}</option>
              )}
            </StyledSelect>
          </Row>
        )}
        {jump}
      </Group>

      <Group
        title="Show"
        help={
          <InfoTip label="About what the road view shows">
            Analysis points are the block ground the terrain lets the nearest station see. EVQO polygons drape the
            established objectives over the ground, coloured by class, as a planner&apos;s Google Earth layer does.
            Landform drapes the landform being assessed (light blue) and the other ridge layers read for it (purple), so
            you can see which band of the mountain the block takes a share of. Distance haze fades each ridge a little
            more than the one in front, as real air does; it changes only the picture. Note screenshot look is how
            planning-note screenshots are taken in Google Earth: imagery, the proposed blocks filled white, no drawn
            timber or points. Satellite imagery is the road view&apos;s Layers button.
          </InfoTip>
        }
      >
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5" role="group" aria-label="Show in the road view">
          <CheckboxField
            className="min-w-0 text-xs"
            label="Analysis points"
            checked={drive.showAnalysis}
            onCheckedChange={() => onDriveChange({ showAnalysis: !drive.showAnalysis })}
          />
          <CheckboxField
            className="min-w-0 text-xs"
            label="Note screenshot look"
            checked={drive.reportLook}
            onCheckedChange={() =>
              onDriveChange(
                drive.reportLook
                  ? { reportLook: false }
                  : { reportLook: true, harvestPhase: 'after', showAnalysis: false, imagery: true, forest: false },
              )
            }
          />
          <CheckboxField
            className="min-w-0 text-xs"
            label="EVQO polygons"
            checked={drive.showEvqo}
            onCheckedChange={() => onDriveChange({ showEvqo: !drive.showEvqo })}
          />
          <CheckboxField
            className="min-w-0 text-xs"
            label="Landform"
            checked={drive.showLandform}
            onCheckedChange={() => onDriveChange({ showLandform: !drive.showLandform })}
          />
          <CheckboxField
            className="min-w-0 text-xs"
            label="Distance haze"
            checked={drive.haze}
            onCheckedChange={() => onDriveChange({ haze: !drive.haze })}
          />
        </div>
        {drive.showEvqo && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-3xs text-muted-foreground">
            {(Object.entries(EVQO_COLORS) as Array<[EvqoCode, string]>).map(([code, color]) => (
              <span key={code} className="inline-flex items-center gap-1" title={EVQO_NAMES[code]}>
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
                {code}
              </span>
            ))}
          </p>
        )}
      </Group>

      <Group
        title="Figure"
        help={
          <InfoTip label="About the figure style">
            Figure style drapes the outlines of a BC VIA figure style (landform, blocks, openings, private land, rock)
            over the terrain, which hides them behind nearer ridges; a saved view&apos;s analysis sheet (Save &amp;
            export) is drawn in the same style. Hatched rock is outlined here and hatched in the sheet.
          </InfoTip>
        }
      >
        <Row label="Figure style">
          <StyledSelect
            aria-label="Figure style"
            className={SELECT_CLASS}
            value={drive.figureStyle ?? ''}
            onChange={(event) => onDriveChange({ figureStyle: event.target.value || null })}
          >
            <option value="">None</option>
            {LIVE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </StyledSelect>
        </Row>
        <Row label="Label style">
          <StyledSelect
            aria-label="Label style"
            className={SELECT_CLASS}
            value={drive.labelStyle ?? ''}
            onChange={(event) => onDriveChange({ labelStyle: (event.target.value || null) as LabelStyleId | null })}
          >
            <option value="">The figure style&apos;s own</option>
            {LABEL_STYLES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </StyledSelect>
        </Row>
      </Group>

      <Group title="Drawing">
        <Row
          label="While moving"
          info={
            <InfoTip label="About drawing while moving">
              Lighter draws the road view at a lower resolution while it moves and at the screen&apos;s own half a
              second after it stops: on a high-density screen that is about 60% fewer pixels a frame, for a smoother
              drive on a slower computer. Saved views and images are taken still, at full resolution.
            </InfoTip>
          }
        >
          <StyledSelect
            aria-label="While moving"
            className={SELECT_CLASS}
            value={drive.movingResolution}
            onChange={(event) =>
              onDriveChange({ movingResolution: event.target.value as DriveState['movingResolution'] })
            }
          >
            <option value="full">Full resolution</option>
            <option value="reduced">Lighter</option>
          </StyledSelect>
        </Row>
        <Row label="Display quality">
          <StyledSelect
            aria-label="Display quality"
            className={SELECT_CLASS}
            value={drive.quality}
            onChange={(event) => onDriveChange({ quality: event.target.value as DriveState['quality'] })}
          >
            <option value="auto">Default</option>
            <option value="detailed">Detailed</option>
            <option value="fast">Faster</option>
          </StyledSelect>
        </Row>
        <Row
          label="Renderer"
          info={
            <InfoTip label="About the renderer">
              Which engine draws the road view. PGMaps is the road view&apos;s own drawing; the others are separate
              engines on trial, given the same ground, stems, openings and eye, and following the drive. They draw only:
              every figure, saved view and image is still PGMaps&apos; own. Engines differ in how much of the view a
              tree covers, so judge screening on PGMaps.
              {ROAD_RENDERERS.map((entry) => (
                <span key={entry.id} className="mt-1 block">
                  <b>{entry.label}</b> ({entry.licence}): {entry.summary}
                </span>
              ))}
            </InfoTip>
          }
        >
          <StyledSelect
            aria-label="Renderer"
            className={SELECT_CLASS}
            value={drive.renderer}
            onChange={(event) => onDriveChange({ renderer: event.target.value as RoadRendererId })}
          >
            {ROAD_RENDERERS.map((entry) => {
              const reason = roadRendererUnavailable(entry.id, {
                url: roadRendererUrl(entry.id, import.meta.env),
                webGpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
              })
              return (
                <option key={entry.id} value={entry.id} disabled={!!reason} title={reason ?? undefined}>
                  {entry.label}
                </option>
              )
            })}
          </StyledSelect>
        </Row>
        {roadRendererUrl('nanite', import.meta.env) && (
          <Row
            label="Nanite trees"
            info={
              <InfoTip label="About keeping grown trees">
                Nanite Forest grows each tree type when its page starts, which takes about a second. Kept in this
                browser, the next start skips that. They take about 120 MB for one scene&apos;s tree types and at most
                about 300 MB; set back to Not kept, the engine deletes them the next time it starts. The choice is this
                browser&apos;s, not the scene&apos;s, and changes no picture or figure.
              </InfoTip>
            }
          >
            <StyledSelect
              aria-label="Nanite Forest grown trees"
              className={SELECT_CLASS}
              value={engineOptions.keepGrownTrees ? 'kept' : 'off'}
              onChange={(event) => setEngineBrowserOptions({ keepGrownTrees: event.target.value === 'kept' })}
            >
              <option value="off">Not kept</option>
              <option value="kept">Kept in this browser</option>
            </StyledSelect>
          </Row>
        )}
        {drive.renderer !== 'pgmaps' && (
          <>
            <EngineRenderControls renderer={drive.renderer} />
            <Row
              stacked
              label="When"
              info={
                <InfoTip label="About the engine's light">
                  Where the sun stands in the engine&apos;s picture: this date and time on the site&apos;s clock.
                  Display only, like the engine itself: PGMaps&apos; own drawing and every figure ignore it.
                </InfoTip>
              }
            >
              <span className="flex gap-1">
                <input
                  type="date"
                  aria-label="Engine date"
                  className={cn(SELECT_CLASS, 'flex-1')}
                  value={
                    drive.engineEnvironment.date ?? localDate(new Date(), drive.engineEnvironment.timeZone ?? undefined)
                  }
                  onChange={(event) => setEnvironment({ date: event.target.value || null })}
                />
                <input
                  type="time"
                  aria-label="Engine time"
                  className={cn(SELECT_CLASS, 'w-[6.5rem] flex-none')}
                  value={drive.engineEnvironment.time}
                  onChange={(event) => setEnvironment({ time: event.target.value || '14:00' })}
                />
              </span>
            </Row>
            <Row
              label="Clock"
              info={
                <InfoTip label="About the site's clock">
                  The time zone the date and time are read in. From the site takes B.C.&apos;s clock at the road:
                  Pacific, Mountain in the East Kootenay, Mountain standard all year in the Peace, Fort Nelson and
                  Creston. The same entry then means the same moment on any computer.
                </InfoTip>
              }
            >
              <StyledSelect
                aria-label="Engine time zone"
                className={SELECT_CLASS}
                value={drive.engineEnvironment.timeZone ?? ''}
                onChange={(event) => setEnvironment({ timeZone: event.target.value || null })}
              >
                <option value="">From the site</option>
                {SITE_TIME_ZONES.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </StyledSelect>
            </Row>
            <Row
              label="Sun"
              info={
                <InfoTip label="About the sun">
                  True position lights the scene from where the sun is at that moment: low and long-shadowed near
                  sunset, and no sunlight at night. Kept to daylight lets the engine lift a low sun and move a night
                  clock to dusk, for a picture that stays lit. The status line names the sun the light came from.
                </InfoTip>
              }
            >
              <StyledSelect
                aria-label="Engine sun"
                className={SELECT_CLASS}
                value={drive.engineEnvironment.sun}
                onChange={(event) => setEnvironment({ sun: event.target.value as EngineEnvironmentChoice['sun'] })}
              >
                <option value="true">True position</option>
                <option value="daylight">Kept to daylight</option>
              </StyledSelect>
            </Row>
            <Row label="Ground">
              <StyledSelect
                aria-label="Engine ground"
                className={SELECT_CLASS}
                value={drive.engineEnvironment.ground}
                onChange={(event) =>
                  setEnvironment({ ground: event.target.value as EngineEnvironmentChoice['ground'] })
                }
              >
                <option value="bare">Bare</option>
                <option value="snow">Snow</option>
              </StyledSelect>
            </Row>
            <Row label="Weather">
              <StyledSelect
                aria-label="Engine weather"
                className={SELECT_CLASS}
                value={drive.engineEnvironment.weather}
                onChange={(event) =>
                  setEnvironment({ weather: event.target.value as EngineEnvironmentChoice['weather'] })
                }
              >
                {ENGINE_WEATHER.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </StyledSelect>
            </Row>
            <Row
              label="Clouds"
              info={
                <InfoTip label="About clouds">
                  How much of the sky is under cloud in clear weather. Every engine draws this much cloud, so two
                  renderers can be compared under one sky. Overcast, rain and snow are fully clouded.
                </InfoTip>
              }
            >
              <StyledSelect
                aria-label="Engine clouds"
                className={SELECT_CLASS}
                disabled={drive.engineEnvironment.weather !== 'clear'}
                value={String(drive.engineEnvironment.cloudCover)}
                onChange={(event) => setEnvironment({ cloudCover: Number(event.target.value) })}
              >
                {ENGINE_CLOUDS.map((entry) => (
                  <option key={entry.value} value={String(entry.value)}>
                    {entry.label}
                  </option>
                ))}
              </StyledSelect>
            </Row>
            <Row
              label="Visibility"
              info={
                <InfoTip label="About visibility">
                  How far one can see: the haze every engine lays over distance (Koschmieder&apos;s law, the farthest
                  slope fading to the sky at this range). The same setting gives the same haze in every renderer.
                </InfoTip>
              }
            >
              <StyledSelect
                aria-label="Engine visibility"
                className={SELECT_CLASS}
                value={String(drive.engineEnvironment.visibilityKm)}
                onChange={(event) => setEnvironment({ visibilityKm: Number(event.target.value) })}
              >
                {ENGINE_VISIBILITY.map((entry) => (
                  <option key={entry.value} value={String(entry.value)}>
                    {entry.label}
                  </option>
                ))}
              </StyledSelect>
            </Row>
            <Row
              label="Wind"
              info={
                <InfoTip label="About wind">
                  Wind over water: calm draws a mirror lake with the far shore in it, and more wind ripples it until it
                  reflects the sky more than the shore. Display only.
                </InfoTip>
              }
            >
              <StyledSelect
                aria-label="Engine wind"
                className={SELECT_CLASS}
                value={String(drive.engineEnvironment.windMs ?? 0)}
                onChange={(event) => setEnvironment({ windMs: Number(event.target.value) })}
              >
                {ENGINE_WIND.map((entry) => (
                  <option key={entry.value} value={String(entry.value)}>
                    {entry.label}
                  </option>
                ))}
              </StyledSelect>
            </Row>
            <Row
              label="Look"
              info={
                <InfoTip label="About the look">
                  VIA convention draws as the consultants&apos; renders do: a dark olive canopy, little haze to 8–10 km,
                  mirror lakes and a cloudless sky. Photo match draws as a photograph: haze from Visibility, blue-grey
                  far forest and wind-rippled water. Neither changes a figure.
                </InfoTip>
              }
            >
              <StyledSelect
                aria-label="Engine look"
                className={SELECT_CLASS}
                value={drive.engineEnvironment.look ?? 'via'}
                onChange={(event) =>
                  setEnvironment({ look: event.target.value as NonNullable<EngineEnvironmentChoice['look']> })
                }
              >
                {ENGINE_LOOKS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </StyledSelect>
            </Row>
          </>
        )}
        <Row
          label="Tree shading"
          info={
            <InfoTip label="About tree shading">
              Lit shades each tree as a crown: the sunny side brighter, the lower crown in its own shade, light through
              the needles when you look toward the sun. Flat draws each tree in the drawing&apos;s own colours. Either
              way every tree covers the same part of the view, so screening and every number are unchanged.
            </InfoTip>
          }
        >
          <StyledSelect
            aria-label="Tree shading"
            className={SELECT_CLASS}
            value={drive.treeLook}
            onChange={(event) => onDriveChange({ treeLook: event.target.value as DriveState['treeLook'] })}
          >
            <option value="lit">Lit</option>
            <option value="flat">Flat</option>
          </StyledSelect>
        </Row>
        <Row
          label="Tree light"
          info={
            <InfoTip label="About tree light">
              Fixed lights every tree from the same late-morning direction, as the page always has. Site date and time
              lights them from where the sun is at the date and time set for the view (the same clock the other
              renderers are given), kept at least 12° above the horizon so a low sun does not turn the stand black. A
              light only: every tree covers the same part of the view.
            </InfoTip>
          }
        >
          <StyledSelect
            aria-label="Tree light"
            className={SELECT_CLASS}
            value={drive.treeSun}
            onChange={(event) => onDriveChange({ treeSun: event.target.value as DriveState['treeSun'] })}
          >
            <option value="fixed">Fixed</option>
            <option value="site">Site date and time</option>
          </StyledSelect>
        </Row>
        <Row
          label="Tree shadows"
          info={
            <InfoTip label="About tree shadows">
              The trees within 140 m lay a soft shadow on the ground, away from the trees&apos; light, so a stem stands
              on its ground instead of on a flat sheet. A drawing aid: shadows fall on the ground only, are bent over it
              at three points and can sit a little off steep ground, and no tree covers more or less of the view for
              them.
            </InfoTip>
          }
        >
          <StyledSelect
            aria-label="Tree shadows"
            className={SELECT_CLASS}
            value={drive.treeShadows ? 'on' : 'off'}
            onChange={(event) => onDriveChange({ treeShadows: event.target.value === 'on' })}
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </StyledSelect>
        </Row>
        <Row
          label="Tree colours"
          info={
            <InfoTip label="About tree colours">
              By treatment colours the trees of blocks with a stand prescription: before harvest the trees marked to
              cut, after it the trees kept, and protected trees in both. A colour only: every tree covers the same part
              of the view, so screening and every number are unchanged.
            </InfoTip>
          }
        >
          <StyledSelect
            aria-label="Tree colours"
            className={SELECT_CLASS}
            value={drive.treeColours}
            onChange={(event) => onDriveChange({ treeColours: event.target.value as DriveState['treeColours'] })}
          >
            <option value="natural">Natural</option>
            <option value="treatment">By treatment</option>
          </StyledSelect>
        </Row>
        <Row
          label="Detail when stopped"
          info={
            <InfoTip label="About detail when stopped">
              While the view moves, every tree is a picture card, which keeps walking and driving smooth. Once it holds
              still for half a second, the trees within this distance are drawn again as full 3D trees (branches in
              whorls, foliage sprays) for a better still frame and screenshot. The same trees in the same places, at the
              same heights and crown widths: nothing about the stand or the numbers changes.
            </InfoTip>
          }
        >
          <StyledSelect
            aria-label="Detail when stopped"
            className={SELECT_CLASS}
            value={String(drive.detailRadiusMeters)}
            onChange={(event) => onDriveChange({ detailRadiusMeters: Number(event.target.value) })}
          >
            <option value="0">Off</option>
            <option value="80">Within 80 m</option>
            <option value="150">Within 150 m</option>
            <option value="250">Within 250 m</option>
          </StyledSelect>
        </Row>
        <Row
          label="Distant trees"
          info={
            <InfoTip label="About distant trees">
              Out to 8 km stands a coarse stand on the hills behind a small scene, one tree for every 160 m, on coarser
              terrain and the inventory&apos;s open ground read for the purpose: water, rock, meadow and other open
              ground stay clear, and ground that could not be read stays empty. A drawing only: a saved view&apos;s
              pictures show the distant trees (and its <em>with drawn timber</em> figure counts them), but its pixel
              figure, the camera, the sightline run and the scene given to another renderer keep the road view&apos;s
              own ground and timber.
            </InfoTip>
          }
        >
          <StyledSelect
            aria-label="Distant trees"
            className={SELECT_CLASS}
            value={drive.distantTrees ? 'on' : 'off'}
            onChange={(event) => onDriveChange({ distantTrees: event.target.value === 'on' })}
          >
            <option value="off">Off</option>
            <option value="on">Out to 8 km</option>
          </StyledSelect>
        </Row>
        {drive.distantTrees && distantTreesNote && (
          <p className="text-2xs text-muted-foreground" role="status">
            {distantTreesNote}
          </p>
        )}
      </Group>
    </div>
  )
}

/** The road view bar's *View options* button and its panel. */
export function RoadViewOptionsButton(props: Parameters<typeof RoadViewOptions>[0]) {
  return (
    <ToolbarPopover
      label="View options"
      icon={<SlidersHorizontal className="size-3.5" aria-hidden="true" />}
      count={roadViewOptionsCount(props.drive)}
      width={344}
      buttonClassName="touch:size-10"
    >
      {/* The popover adds no padding of its own. */}
      <div className="p-3">
        <RoadViewOptions {...props} />
      </div>
    </ToolbarPopover>
  )
}

/**
 * The road view bar's *Drawn timber* button: the timber the view is drawn with, beside *View options* rather than in
 * the sidebar, so it is changed where its effect is seen. A drawing only; the figures never change.
 */
export function DrawnTimberButton(props: Parameters<typeof DrawnTimberPanel>[0]) {
  return (
    <ToolbarPopover
      label="Drawn timber"
      icon={<Trees className="size-3.5" aria-hidden="true" />}
      width={320}
      buttonClassName="touch:size-10"
    >
      <div className="p-3">
        <DrawnTimberPanel {...props} />
      </div>
    </ToolbarPopover>
  )
}
