/**
 * The road view video's options in Save & export: what it records, the speed and stretch of road or the views and
 * how long each is held, and the caption. Kept in this browser (`ROAD_VIDEO_STORAGE_KEY`), never in the scene or the
 * project file; the plan is `roadVideo.ts`'s.
 */
import { useEffect, useState } from 'react'

import { CheckboxField, FORM_INPUT_CLASS, NumberField, StyledSelect, unitInside } from '@/components/ui/form-field'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { cn } from '@/lib/utils'

import { DRIVE_SPEEDS_KMH } from './driveMath'
import {
  DEFAULT_ROAD_VIDEO_SETTINGS,
  parseRoadVideoSettings,
  ROAD_VIDEO_LIMITS,
  ROAD_VIDEO_STORAGE_KEY,
  type RoadVideoPlan,
  type RoadVideoScene,
  type RoadVideoSettings,
} from './roadVideo'

function stored(): RoadVideoSettings {
  try {
    const text = window.localStorage.getItem(ROAD_VIDEO_STORAGE_KEY)
    return text ? parseRoadVideoSettings(JSON.parse(text)) : { ...DEFAULT_ROAD_VIDEO_SETTINGS }
  } catch {
    return { ...DEFAULT_ROAD_VIDEO_SETTINGS }
  }
}

/** The video's choices, kept per browser. Only state: the export hook calls it on every render of the page. */
export function useRoadVideoSettings() {
  const [settings, setSettings] = useState<RoadVideoSettings>(stored)
  useEffect(() => {
    try {
      window.localStorage.setItem(ROAD_VIDEO_STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Storage may be blocked; the choices still apply for this tab.
    }
  }, [settings])
  return [settings, setSettings] as const
}

const INLINE_FIELD = 'flex-row items-center justify-between gap-3'
const km = (metres: number) => Math.round(metres / 10) / 100

export function RoadVideoOptions({
  scene,
  plan,
  settings,
  onChange,
  disabled = false,
}: {
  scene: RoadVideoScene
  plan: RoadVideoPlan
  settings: RoadVideoSettings
  onChange: (update: (current: RoadVideoSettings) => RoadVideoSettings) => void
  /** A take is under way: the choices hold until it ends. */
  disabled?: boolean
}) {
  const set = (patch: Partial<RoadVideoSettings>) => onChange((current) => ({ ...current, ...patch }))
  const route = plan.route
  const chosen = settings.viewIds ? new Set(settings.viewIds) : null
  const filmable = scene.views.filter((view) => view.reason === null)
  const toggleView = (id: string, on: boolean) =>
    onChange((current) => {
      const ids = current.viewIds ? new Set(current.viewIds) : new Set(filmable.map((view) => view.id))
      if (on) ids.add(id)
      else ids.delete(id)
      // Every view the road view can stand at, in the list's order, reads as no choice at all.
      const next = scene.views.filter((view) => ids.has(view.id)).map((view) => view.id)
      return {
        ...current,
        viewIds: next.length === filmable.length && filmable.every((v) => ids.has(v.id)) ? null : next,
      }
    })
  return (
    <fieldset className="grid gap-2" disabled={disabled}>
      <SegmentedControl
        size="sm"
        label="Video records"
        value={plan.mode}
        onChange={(mode) => set({ mode })}
        options={[
          {
            value: 'road' as const,
            label: 'Along the road',
            disabled: disabled || !!plan.modes.road,
            ...(plan.modes.road ? { title: plan.modes.road } : {}),
          },
          {
            value: 'views' as const,
            label: 'Views of interest',
            disabled: disabled || !!plan.modes.views,
            ...(plan.modes.views ? { title: plan.modes.views } : {}),
          },
        ]}
      />
      {plan.modes[plan.mode === 'road' ? 'views' : 'road'] && (
        <p className="text-2xs text-muted-foreground">
          {plan.mode === 'road' ? 'Views of interest' : 'Along the road'}:{' '}
          {plan.modes[plan.mode === 'road' ? 'views' : 'road']}
        </p>
      )}
      {plan.mode === 'road' && route && (
        <>
          <label className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">Speed</span>
            <StyledSelect
              aria-label="Video speed"
              className="w-28 rounded-md border bg-background p-1"
              value={String(route.speedKmh)}
              onChange={(event) => set({ speedKmh: Number(event.target.value) })}
            >
              {DRIVE_SPEEDS_KMH.map((speed) => (
                <option key={speed} value={String(speed)}>
                  {speed} km/h
                </option>
              ))}
            </StyledSelect>
          </label>
          <NumberField
            label="From"
            contentClassName={INLINE_FIELD}
            {...unitInside(cn(FORM_INPUT_CLASS, 'w-28'))}
            unit="km"
            min={0}
            max={km(route.lengthMeters)}
            step={0.1}
            precision={2}
            value={km(route.fromMeters)}
            updateOn="commit"
            onValueChange={(value) => set({ fromMeters: value <= 0 ? null : value * 1000 })}
          />
          <NumberField
            label="To"
            contentClassName={INLINE_FIELD}
            {...unitInside(cn(FORM_INPUT_CLASS, 'w-28'))}
            unit="km"
            min={0}
            max={km(route.lengthMeters)}
            step={0.1}
            precision={2}
            value={km(route.toMeters)}
            updateOn="commit"
            onValueChange={(value) => set({ toMeters: value * 1000 >= route.lengthMeters - 5 ? null : value * 1000 })}
          />
          {scene.facingNow && (
            <label className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">Facing</span>
              <StyledSelect
                aria-label="Video facing"
                className="w-56 rounded-md border bg-background p-1"
                value={route.facing}
                onChange={(event) => set({ facing: event.target.value === 'view' ? 'view' : 'road' })}
              >
                <option value="road">Along the road</option>
                <option value="view">Toward {scene.facingNow}, as the road view faces</option>
              </StyledSelect>
            </label>
          )}
          <p className="text-2xs text-muted-foreground">
            The road is {km(route.lengthMeters).toFixed(2)} km. The road view’s own speed and place are not changed.
          </p>
        </>
      )}
      {plan.mode === 'views' && (
        <>
          <NumberField
            label="Hold each view"
            contentClassName={INLINE_FIELD}
            {...unitInside(cn(FORM_INPUT_CLASS, 'w-24'))}
            unit="s"
            min={ROAD_VIDEO_LIMITS.minHoldSeconds}
            max={ROAD_VIDEO_LIMITS.maxHoldSeconds}
            step={1}
            value={settings.holdSeconds}
            updateOn="commit"
            onValueChange={(holdSeconds) => set({ holdSeconds })}
          />
          <ul aria-label="Views to film" className="grid gap-1">
            {scene.views.map((view) => (
              <li key={view.id}>
                <CheckboxField
                  label={view.name}
                  checked={view.reason === null && (!chosen || chosen.has(view.id))}
                  disabled={disabled || view.reason !== null}
                  onCheckedChange={(on) => toggleView(view.id, on)}
                  description={view.reason ? `Not filmed: ${view.reason}.` : `${view.block} · ${view.lens}`}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      <CheckboxField
        label="Caption on every frame: what is shown, and that PGMaps drew it"
        checked={settings.caption}
        onCheckedChange={(caption) => set({ caption })}
      />
      <p className="text-2xs text-muted-foreground">
        Kept in this browser; nothing goes in the scene or the project file. The look is the road view’s own: its
        harvest phase, View options and Drawn timber.
      </p>
    </fieldset>
  )
}
