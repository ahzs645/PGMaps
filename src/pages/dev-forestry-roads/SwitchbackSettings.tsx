import { NumberField, OptionalNumberField } from './Controls'
import { RoadSection } from './SidebarParts'
import type { RouteSearchOptions } from './routing'
import {
  CHORD_REFERENCE_M,
  DEFAULT_SWITCHBACK_ROUTE_OPTIONS,
  PLATFORM_RADIUS_FACTOR,
  sharpestSwitchbackDegrees,
  SWITCHBACK_ROUTE_LIMITS as LIMITS,
  switchbackRadius,
  type SwitchbackRouteOptions,
} from './switchbackOptions'

const whole = (n: number) => Math.round(n).toLocaleString('en-CA')

/** Find the best route → Search settings → Switchbacks: the switchback search's rules, saved with the project. */
export function SwitchbackSettings({
  route,
  minRadiusM,
  maxGradePercent,
  onChange,
}: {
  route: RouteSearchOptions
  minRadiusM: number
  maxGradePercent: number
  onChange: (route: RouteSearchOptions) => void
}) {
  const rules = route.switchbacks ?? DEFAULT_SWITCHBACK_ROUTE_OPTIONS
  const set = (patch: Partial<SwitchbackRouteOptions>) => onChange({ ...route, switchbacks: { ...rules, ...patch } })
  const radius = switchbackRadius(rules, minRadiusM)
  const summary = rules.allow
    ? `R ${whole(radius)} m · ≥ ${whole(rules.spacingFactor * radius)} m apart · platform ≤ ${Math.round(rules.platformSteepShare * 100)}% over ${rules.platformSlopePercent}%`
    : 'Off'
  return (
    // Full sidebar width inside Search settings, so its label lines up with the fields above.
    <div className="-mx-3 mt-2 border-t">
      <RoadSection
        title="Switchbacks"
        summary={summary}
        toggleTestId="road-route-switchbacks"
        data-testid="road-route-switchback-settings"
        help={
          <>
            With switchbacks allowed, a corridor where the search finds no line is searched again on straight graded
            pieces that may turn back through switchbacks. A switchback needs a platform: at most the steep share of the
            ground within {PLATFORM_RADIUS_FACTOR} R of the turn may be steeper than the platform limit. It must be at
            least the spacing from the last one, and no sharper than the legs can be stacked at this grade and radius (
            {sharpestSwitchbackDegrees(maxGradePercent, radius).toFixed(1)}° now). Each is drawn as a loop of curves
            round the outside of its turn. These are screening rules from SylvaRoaD&apos;s empirical figures, not a
            platform design.
          </>
        }
      >
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={rules.allow}
            onChange={(event) => set({ allow: event.target.checked })}
            data-testid="road-route-allow-switchbacks"
          />
          Allow switchbacks
        </label>
        {rules.allow && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <OptionalNumberField
                label="Radius (m)"
                value={rules.radiusM}
                min={LIMITS.radiusM[0]}
                max={LIMITS.radiusM[1]}
                step={1}
                placeholder={`${whole(radius)}`}
                hint="Centreline radius of every curve in a switchback. Empty takes the road's minimum radius, and at least 12 m. Below the road's minimum radius the curves are flagged."
                onChange={(radiusM) => set({ radiusM })}
              />
              <NumberField
                label="Middle straight (m)"
                value={rules.middleStraightM}
                min={LIMITS.middleStraightM[0]}
                max={LIMITS.middleStraightM[1]}
                step={1}
                hint="Straight between the two main curves of each drawn switchback."
                onChange={(middleStraightM) => set({ middleStraightM })}
              />
              <NumberField
                label="Spacing (× R)"
                value={rules.spacingFactor}
                min={LIMITS.spacingFactor[0]}
                max={LIMITS.spacingFactor[1]}
                step={0.5}
                hint={`Least distance between two switchbacks' turning points: ${whole(rules.spacingFactor * radius)} m now.`}
                onChange={(spacingFactor) => set({ spacingFactor })}
              />
              <NumberField
                label="Turns above (°)"
                value={rules.hairpinAngleDeg}
                min={LIMITS.hairpinAngleDeg[0]}
                max={LIMITS.hairpinAngleDeg[1]}
                step={5}
                hint="A change of heading above this is a switchback and must pass its tests; a smaller one is an ordinary curve."
                onChange={(hairpinAngleDeg) => set({ hairpinAngleDeg })}
              />
              <NumberField
                label="Platform over %"
                value={rules.platformSlopePercent}
                min={LIMITS.platformSlopePercent[0]}
                max={LIMITS.platformSlopePercent[1]}
                step={5}
                hint={`Ground steeper than this counts as steep in the platform test, a circle of ${(PLATFORM_RADIUS_FACTOR * radius).toFixed(1)} m round the turn.`}
                onChange={(platformSlopePercent) => set({ platformSlopePercent })}
              />
              <NumberField
                label="Steep share ≤ %"
                value={Math.round(rules.platformSteepShare * 1000) / 10}
                min={0}
                max={100}
                step={5}
                hint="Largest share of the platform circle that may be steeper than the platform limit."
                onChange={(share) => set({ platformSteepShare: share / 100 })}
              />
              <OptionalNumberField
                label="Turn cut/fill ≤ m"
                value={rules.turnCutFillM}
                min={LIMITS.turnCutFillM[0]}
                max={LIMITS.turnCutFillM[1]}
                step={0.5}
                hint="Largest centreline cut or fill on a drawn switchback, held at a constant grade between its legs. Empty does not limit it; each row still reports it."
                onChange={(turnCutFillM) => set({ turnCutFillM })}
              />
              <NumberField
                label="Cost each (m)"
                value={rules.penaltyM}
                min={LIMITS.penaltyM[0]}
                max={LIMITS.penaltyM[1]}
                step={25}
                hint="Metres of road one switchback is worth to the search, on top of its turn and any steep platform ground."
                onChange={(penaltyM) => set({ penaltyM })}
              />
            </div>
            <p className="pt-1 text-2xs font-medium text-muted-foreground">Pieces of a switchback route</p>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Minimum grade %"
                value={rules.minGradePercent}
                min={LIMITS.minGradePercent[0]}
                max={Math.max(0, Math.min(LIMITS.minGradePercent[1], maxGradePercent - 0.5))}
                step={0.5}
                hint="Least grade of every straight piece, for drainage. 0 sets none."
                onChange={(minGradePercent) => set({ minGradePercent })}
              />
              <label className="flex items-end gap-2 pb-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={rules.minGradeHard}
                  disabled={!rules.minGradePercent}
                  onChange={(event) => set({ minGradeHard: event.target.checked })}
                />
                Refuse flatter pieces
              </label>
              <NumberField
                label="Straight-grade cut/fill (m)"
                value={rules.chordCutFillM}
                min={LIMITS.chordCutFillM[0]}
                max={LIMITS.chordCutFillM[1]}
                step={0.5}
                hint={`How far the ground may depart from a piece's straight grade, for a ${CHORD_REFERENCE_M} m piece; a shorter piece gets its share.`}
                onChange={(chordCutFillM) => set({ chordCutFillM })}
              />
              <OptionalNumberField
                label="Side-hill over %"
                value={route.maxTerrainSlopePercent}
                min={1}
                max={300}
                step={5}
                hint="Ground steeper than this is side-hill. The same value is the terrain-cost search's hard terrain-slope limit."
                onChange={(maxTerrainSlopePercent) => onChange({ ...route, maxTerrainSlopePercent })}
              />
              <NumberField
                label="Side-hill for ≤ m"
                value={rules.sideHillBudgetM}
                min={LIMITS.sideHillBudgetM[0]}
                max={LIMITS.sideHillBudgetM[1]}
                step={10}
                disabled={route.maxTerrainSlopePercent === null}
                hint="Metres of road a switchback route may run on side-hill, each one charged as a metre more. 0 refuses any."
                onChange={(sideHillBudgetM) => set({ sideHillBudgetM })}
              />
              <OptionalNumberField
                label="Grade change (m)"
                value={rules.gradeChangePenaltyM}
                min={LIMITS.gradeChangePenaltyM[0]}
                max={LIMITS.gradeChangePenaltyM[1]}
                step={10}
                placeholder="by goal"
                hint="Metres of road a full reversal from the grade limit up to the limit down is worth; smaller changes cost by the square. Empty: 0 for Shortest, 80 balanced, 160 Gentlest."
                onChange={(gradeChangePenaltyM) => set({ gradeChangePenaltyM })}
              />
              <OptionalNumberField
                label="Pass points within (m)"
                value={rules.passPointsWithinM}
                min={LIMITS.passPointsWithinM[0]}
                max={LIMITS.passPointsWithinM[1]}
                step={5}
                placeholder="guide only"
                hint="Makes your road's interior points compulsory, each passed within this distance. Empty keeps them a guide."
                onChange={(passPointsWithinM) => set({ passPointsWithinM })}
              />
            </div>
          </>
        )}
      </RoadSection>
    </div>
  )
}
