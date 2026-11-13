import type { ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'

import { FormField, StyledSelect } from '@/components/ui/form-field'
import { InfoTip } from '@/components/ui/info-tip'
import { ToggleRow } from '@/components/ui/toggle-row'
import { ToolbarPopover } from '@/components/ui/toolbar-popover'
import { LIVE_PRESETS } from '@/lib/forestry/viaFigure/presets'
import { LABEL_STYLES, type LabelStyleId } from '@/lib/mapSheet/callouts'
import { cn } from '@/lib/utils'

import {
  ENGINE_WEATHER,
  localDate,
  ROAD_RENDERERS,
  roadRendererUnavailable,
  roadRendererUrl,
  type EngineEnvironmentChoice,
  type RoadRendererId,
} from './externalRenderers'
import type { DriveState } from './Sidebar'
import type { TargetPolygon } from './types'
import { compassPoint, EVQO_COLORS, EVQO_NAMES, type EvqoCode } from './visualsNarrative'

const SELECT_CLASS =
  'h-7 max-w-full rounded-md border border-border bg-background px-1.5 text-2xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

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

function Row({ label, info, children }: { label: string; info?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="flex items-center gap-1">
        {label}
        {info}
      </span>
      {children}
    </label>
  )
}

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
}: {
  drive: DriveState
  onDriveChange: (patch: Partial<DriveState>) => void
  blocks: ReadonlyArray<Pick<TargetPolygon, 'id' | 'name'>>
  /** Standing at an inventory viewpoint: its arrows, each a direction the view can face. */
  lookArrows?: ReadonlyArray<LookArrow>
  /** *Go to a view of the block*: places on the road that see the most of it. */
  jump?: ReactNode
}) {
  const arrowAt = (bearing: number) => lookArrows.find((entry) => Math.abs(entry.bearing - bearing) < 0.5)
  const setEnvironment = (change: Partial<EngineEnvironmentChoice>) =>
    onDriveChange({ engineEnvironment: { ...drive.engineEnvironment, ...change } })
  return (
    <div className="space-y-2.5" data-testid="road-view-options">
      <Group title="Look">
        <FormField
          label="Where to look"
          contentClassName="block"
          labelClassName="mb-1 block text-2xs font-medium text-muted-foreground"
        >
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
        </FormField>
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
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Show in the road view">
          <ToggleRow
            layout="tile"
            tone="primary"
            label="Analysis points"
            active={drive.showAnalysis}
            onClick={() => onDriveChange({ showAnalysis: !drive.showAnalysis })}
          />
          <ToggleRow
            layout="tile"
            tone="primary"
            label="Note screenshot look"
            active={drive.reportLook}
            onClick={() =>
              onDriveChange(
                drive.reportLook
                  ? { reportLook: false }
                  : { reportLook: true, harvestPhase: 'after', showAnalysis: false, imagery: true, forest: false },
              )
            }
          />
          <ToggleRow
            layout="tile"
            tone="primary"
            label="EVQO polygons"
            active={drive.showEvqo}
            onClick={() => onDriveChange({ showEvqo: !drive.showEvqo })}
          />
          <ToggleRow
            layout="tile"
            tone="primary"
            label="Landform"
            active={drive.showLandform}
            onClick={() => onDriveChange({ showLandform: !drive.showLandform })}
          />
          <ToggleRow
            layout="tile"
            tone="primary"
            label="Distance haze"
            active={drive.haze}
            onClick={() => onDriveChange({ haze: !drive.haze })}
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
        {drive.renderer !== 'pgmaps' && (
          <>
            <Row
              label="When"
              info={
                <InfoTip label="About the engine's light">
                  Where the sun stands in the engine&apos;s picture: this date and local time at the road. Display only,
                  like the engine itself: PGMaps&apos; own drawing and every figure ignore it.
                </InfoTip>
              }
            >
              <span className="flex gap-1">
                <input
                  type="date"
                  aria-label="Engine date"
                  className={cn(SELECT_CLASS, 'w-[8.75rem]')}
                  value={drive.engineEnvironment.date ?? localDate(new Date())}
                  onChange={(event) => setEnvironment({ date: event.target.value || null })}
                />
                <input
                  type="time"
                  aria-label="Engine time"
                  className={cn(SELECT_CLASS, 'w-[6.5rem]')}
                  value={drive.engineEnvironment.time}
                  onChange={(event) => setEnvironment({ time: event.target.value || '14:00' })}
                />
              </span>
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
      width={320}
      buttonClassName="touch:size-10"
    >
      <RoadViewOptions {...props} />
    </ToolbarPopover>
  )
}
