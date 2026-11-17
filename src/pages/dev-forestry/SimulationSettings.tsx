import type { ReactNode } from 'react'
import { Settings2 } from 'lucide-react'

import { CheckboxField, NumberField, StyledSelect } from '@/components/ui/form-field'
import { InfoTip } from '@/components/ui/info-tip'
import { ToolbarPopover } from '@/components/ui/toolbar-popover'
import { ToolSubsection } from '@/components/ui/tool-section'
import { formatMeasure } from '@/lib/format'
import { MAX_DEM_ZOOM, MIN_DEM_ZOOM, demResolutionMeters } from '@/lib/forestry/terrain/terrain'
import { cn } from '@/lib/utils'

import { OptionRow } from './RoadViewOptions'
import type { AnalysisSettings, Viewpoint } from './types'
import { surveyedEyeElevation } from './viewpointStand'

const CONTROL_CLASS =
  'h-7 w-full min-w-0 rounded-md border border-border bg-background px-1.5 text-2xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return <InfoTip label={`About ${label.toLowerCase()}`}>{children}</InfoTip>
}

/** A number in an `OptionRow`'s right-hand column, its unit beside it. */
function NumberRow({
  label,
  shown = label,
  focusFirst = false,
  info,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  /** The input's accessible name. */
  label: string
  /** The row's printed label, when the full name would not fit the row. */
  shown?: string
  /** Takes focus when the popover opens, rather than the row's (i), whose bubble would cover the panel. */
  focusFirst?: boolean
  info?: ReactNode
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <OptionRow label={shown} info={info && <Tip label={label}>{info}</Tip>}>
      <NumberField
        label={label}
        hideLabel
        {...(focusFirst ? { 'data-autofocus': '' } : {})}
        value={value}
        min={min}
        max={max}
        step={step}
        suffix={suffix}
        inputClassName={CONTROL_CLASS}
        unitClassName="text-2xs"
        onValueChange={onChange}
      />
    </OptionRow>
  )
}

/**
 * The run's inputs, in the sidebar header's settings popover (`SimulationSettingsButton`): where the eye stands, how
 * far and how finely the run looks, what screens it, and what the landform's denominator leaves out. Each one is a
 * run input: changing it stales the run.
 */
export function SimulationSettingsPanel({
  settings,
  onSettingsChange,
  viewpoint,
}: {
  settings: AnalysisSettings
  onSettingsChange: (settings: AnalysisSettings) => void
  viewpoint: Viewpoint
}) {
  const set = (patch: Partial<AnalysisSettings>) => onSettingsChange({ ...settings, ...patch })
  const latitude = viewpoint.coordinates[0]?.[1] ?? 54
  // Shown, never edited here: it belongs to one viewpoint's point and is entered in that view's row.
  const surveyedEye = surveyedEyeElevation(viewpoint)
  return (
    <div className="space-y-2.5" data-testid="simulation-settings">
      <p className="text-2xs text-muted-foreground">Run inputs: changing one makes the run out of date.</p>
      <ToolSubsection title="Viewer">
        <NumberRow
          label="Eye height above the road"
          shown="Eye height"
          focusFirst
          info="1.6 m is a person standing; raise it for a loaded truck cab or a lookout."
          value={settings.observerHeightMeters}
          min={0}
          max={100}
          step={0.1}
          suffix="m"
          onChange={(observerHeightMeters) => set({ observerHeightMeters })}
        />
        {surveyedEye !== null && (
          <p className="text-2xs text-muted-foreground" data-testid="simulation-surveyed-eye">
            Eye at a surveyed {formatMeasure(surveyedEye, 'm', { maximumFractionDigits: 1 })} at this viewpoint, so the
            ground is taken {formatMeasure(settings.observerHeightMeters, 'm', { maximumFractionDigits: 1 })} below it.
            Change it in step 2&apos;s <span className="text-foreground">Where you stand</span>.
          </p>
        )}
        {viewpoint.mode === 'corridor' && (
          <NumberRow
            label="Station spacing"
            info="The distance between viewing stations along the road. Closer stations catch short windows through the trees at the cost of run time."
            value={settings.stationSpacingMeters}
            min={20}
            max={2000}
            step={10}
            suffix="m"
            onChange={(stationSpacingMeters) => set({ stationSpacingMeters })}
          />
        )}
        <NumberRow
          label="Max view distance"
          value={settings.maxViewDistanceMeters / 1000}
          min={0.5}
          max={40}
          step={0.5}
          suffix="km"
          onChange={(value) => set({ maxViewDistanceMeters: value * 1000 })}
        />
        <NumberRow
          label="Target height"
          info="Height above the ground of each point on the block the sightlines aim at."
          value={settings.targetOffsetMeters}
          min={0}
          max={60}
          step={0.5}
          suffix="m"
          onChange={(targetOffsetMeters) => set({ targetOffsetMeters })}
        />
      </ToolSubsection>
      <ToolSubsection title="Detail">
        <OptionRow
          label="Terrain detail"
          info={
            <Tip label="Terrain detail">
              {formatMeasure(demResolutionMeters(latitude, settings.demZoom), 'm', { maximumFractionDigits: 0 })}{' '}
              between elevation samples. Finer detail means many more tiles to fetch.
            </Tip>
          }
        >
          <StyledSelect
            aria-label="Terrain detail"
            className={CONTROL_CLASS}
            value={settings.demZoom}
            onChange={(event) => set({ demZoom: Number(event.target.value) })}
          >
            {Array.from({ length: MAX_DEM_ZOOM - MIN_DEM_ZOOM + 1 }, (_, index) => {
              const zoom = MIN_DEM_ZOOM + index
              return (
                <option key={zoom} value={zoom}>
                  Zoom {zoom} · {formatMeasure(demResolutionMeters(latitude, zoom), 'm', { maximumFractionDigits: 0 })}
                </option>
              )
            })}
          </StyledSelect>
        </OptionRow>
        <NumberRow
          label="Sample points per polygon"
          shown="Sample points"
          info="More points resolve the edges of a block and small openings on a large landform; the run warns when a proposal covers too few landform cells. The grid is coarsened automatically if a run would take too long."
          value={settings.sampleBudget}
          min={100}
          max={20000}
          step={100}
          onChange={(sampleBudget) => set({ sampleBudget })}
        />
      </ToolSubsection>
      <ToolSubsection title="Timber">
        <NumberRow
          label="Green-up age"
          value={settings.greenUpAgeYears}
          min={0}
          max={100}
          step={1}
          suffix="yr"
          onChange={(greenUpAgeYears) => set({ greenUpAgeYears })}
        />
        <NumberRow
          label="Screening crown closure"
          shown="Screening closure"
          value={settings.minCrownClosurePercent}
          min={0}
          max={100}
          step={5}
          suffix="%"
          onChange={(minCrownClosurePercent) => set({ minCrownClosurePercent })}
        />
        <div className="flex items-start gap-1">
          <CheckboxField
            className="flex-1"
            label={<span className="text-xs">Screen with standing timber</span>}
            checked={settings.screeningEnabled}
            onCheckedChange={(screeningEnabled) => set({ screeningEnabled })}
          />
          <Tip label="Screening with standing timber">
            Adds VRI rank-1&apos;s projected stand height to the ground along each sightline, so a block behind mature
            timber reads as hidden. Openings and the proposal itself are treated as cleared. Full-landscape coverage,
            and a slow query — it fetches every inventory polygon over the run&apos;s extent.
          </Tip>
        </div>
        {settings.screeningEnabled && (
          <NumberRow
            label="Timber cleared round the eye"
            shown="Cleared round the eye"
            info="VRI stand polygons run over roads, beaches and shorelines, so without a clearing the eye stands inside a stand and sees nothing. In the November 2026 study 50 m restored most views; some roadside views needed 150 m. The screened figure is withheld when screening hides more than three quarters of the landform the bare ground shows."
            value={settings.screeningEyeClearingMeters ?? 50}
            min={0}
            max={150}
            step={10}
            suffix="m"
            onChange={(screeningEyeClearingMeters) => set({ screeningEyeClearingMeters })}
          />
        )}
      </ToolSubsection>
      <ToolSubsection title="Landform">
        <OptionRow
          label="Denominator"
          info={
            <Tip label="The perspective denominator">
              The perspective figure&apos;s denominator. Non-vegetated out (the default) leaves rock, water and ice (VRI
              BCLCS level 1 N) out of the landform, as a VIA&apos;s &ldquo;net of rock&rdquo; does; burns, shrub and
              herb stay in. Non-treed out uses the 1998 procedure&apos;s green (forested) portion, as the planimetric
              figure always does. In the November 2026 study the non-vegetated rule moved the figure closer to the
              printed VIAs (case-balanced, 1.97 points for the named VSU, 1.02 for the terrain landform).
            </Tip>
          }
        >
          <StyledSelect
            aria-label="Perspective denominator"
            className={cn(CONTROL_CLASS)}
            value={settings.perspectiveDenominator ?? 'non-vegetated-out'}
            onChange={(event) =>
              set({
                perspectiveDenominator: event.target.value as NonNullable<AnalysisSettings['perspectiveDenominator']>,
              })
            }
          >
            <option value="non-vegetated-out">Non-vegetated out</option>
            <option value="non-treed-out">Non-treed out (1998)</option>
          </StyledSelect>
        </OptionRow>
        <div className="flex items-start gap-1">
          <CheckboxField
            className="flex-1"
            label={<span className="text-xs">Private land out of the landform</span>}
            checked={settings.privateLandOutOfDenominator === true}
            onCheckedChange={(privateLandOutOfDenominator) => set({ privateLandOutOfDenominator })}
          />
          <Tip label="Private land and the denominator">
            VIAs print (landform − private land). With this on, private-land masks leave both denominators; their timber
            still screens. Off, private land stays in the landform and only carries no alteration. Private land comes
            from masks you draw or ParcelMap BC parcels you add in step 3.
          </Tip>
        </div>
      </ToolSubsection>
    </div>
  )
}

/** The sidebar header's settings icon, right of the title: the run's inputs in a popover, wherever the reviewer is in the steps. */
export function SimulationSettingsButton(props: Parameters<typeof SimulationSettingsPanel>[0]) {
  return (
    <ToolbarPopover
      label="Simulation settings"
      icon={<Settings2 className="size-4" aria-hidden="true" />}
      align="end"
      width={344}
      variant="ghost"
      buttonClassName="size-8 touch:size-10"
    >
      <div className="p-3">
        <SimulationSettingsPanel {...props} />
      </div>
    </ToolbarPopover>
  )
}
