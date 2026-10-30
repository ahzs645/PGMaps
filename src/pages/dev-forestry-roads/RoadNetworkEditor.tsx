import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CollapsibleSection } from '@/components/ui/map-panels'
import { Field, NumberField, OptionalNumberField, roadFieldClass } from './Controls'
import { createBridgeLoadRatingEvidence, createRoadNetworkEvidence } from './roadNetwork'
import type { BridgeLoadRatingEvidence, RoadNetworkEvidence } from './roadNetworkTypes'
import type { Coordinate } from './types'

function RestrictionList({
  label,
  value,
  onChange,
}: {
  label: string
  value: string[] | null
  onChange: (value: string[] | null) => void
}) {
  const canonical = value === null ? '' : value.length ? value.join(', ') : 'none'
  const key = value === null ? 'null' : JSON.stringify(value)
  const [draft, setDraft] = useState({ key, text: canonical })
  return (
    <Field
      label={label}
      hint="Comma-separated values must match the planning policy. Enter * for every season/class, none for no permitted values, or leave blank for unknown."
    >
      <input
        className={roadFieldClass}
        value={draft.key === key ? draft.text : canonical}
        placeholder="unknown · * means all"
        maxLength={1000}
        onChange={(event) => {
          const text = event.target.value
          const next = !text.trim()
            ? null
            : text.trim().toLowerCase() === 'none'
              ? []
              : [
                  ...new Set(
                    text
                      .split(',')
                      .map((entry) => entry.trim())
                      .filter(Boolean),
                  ),
                ]
          setDraft({ key: next === null ? 'null' : JSON.stringify(next), text })
          onChange(next)
        }}
      />
    </Field>
  )
}

/** Per-road reviewed assumptions. The project policy decides whether unknown inputs may be used. */
export function RoadNetworkEditor({
  value,
  onChange,
  coordinates,
  initialCoordinate,
}: {
  value?: RoadNetworkEvidence
  onChange: (value: RoadNetworkEvidence) => void
  coordinates?: readonly Coordinate[]
  initialCoordinate?: Coordinate
}) {
  const network = value ?? createRoadNetworkEvidence()
  const patch = (update: Partial<RoadNetworkEvidence>) => onChange({ ...network, ...update })
  const rating = network.bridgeRating
  const patchRating = (update: Partial<BridgeLoadRatingEvidence>, retainReview = false) =>
    patch({
      bridgeRating: {
        ...(rating ?? createBridgeLoadRatingEvidence(network.bridgeLoadTonnes)),
        ...(retainReview ? {} : { reviewer: '' }),
        ...update,
      },
    })
  const reference = initialCoordinate ?? coordinates?.[0]
  const unpriced = [
    network.rehabilitationCostPerM,
    network.accessCost,
    network.structureCost,
    network.fixedCost,
  ].filter((n) => n === null).length
  return (
    <CollapsibleSection
      label="Connected-network access & costs"
      summary={`${network.access} access · ${unpriced} unpriced allowance${unpriced === 1 ? '' : 's'}`}
      summaryWhenCollapsedOnly
      toggleProps={{ 'data-testid': 'road-network-evidence-toggle' }}
      contentClassName="space-y-2 pt-2"
    >
      <div data-testid="road-network-evidence" className="space-y-2">
        <p className="text-[11px] text-muted-foreground">
          These are entered planning inputs. A BC tenure record does not verify access, junctions, bridge capacity or
          current road condition.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Road access">
            <select
              className={roadFieldClass}
              value={network.access}
              onChange={(event) => patch({ access: event.target.value as RoadNetworkEvidence['access'] })}
            >
              <option value="unknown">Unknown</option>
              <option value="allowed">Allowed (reviewed input)</option>
              <option value="permission-required">Permission required</option>
              <option value="closed">Closed / unavailable</option>
            </select>
          </Field>
          <Field label="Travel direction">
            <select
              className={roadFieldClass}
              value={network.direction}
              onChange={(event) => patch({ direction: event.target.value as RoadNetworkEvidence['direction'] })}
            >
              <option value="both">Both directions</option>
              <option value="forward">Forward along line only</option>
              <option value="reverse">Reverse along line only</option>
            </select>
          </Field>
          <RestrictionList
            label="Permitted seasons"
            value={network.seasons}
            onChange={(seasons) => patch({ seasons })}
          />
          <RestrictionList
            label="Permitted vehicle classes"
            value={network.vehicleClasses}
            onChange={(vehicleClasses) => patch({ vehicleClasses })}
          />
          <OptionalNumberField
            label="Road vehicle limit (tonnes)"
            value={network.maxVehicleWeightTonnes}
            min={0}
            max={1000}
            step={1}
            placeholder="unknown"
            onChange={(maxVehicleWeightTonnes) => patch({ maxVehicleWeightTonnes })}
          />
          <Field label="Bridge / structure status">
            <select
              className={roadFieldClass}
              value={network.bridgeStatus}
              onChange={(event) => patch({ bridgeStatus: event.target.value as RoadNetworkEvidence['bridgeStatus'] })}
            >
              <option value="unknown">Unknown</option>
              <option value="none">Reviewed: none on road</option>
              <option value="reviewed">Present: limits reviewed</option>
              <option value="closed">Closed structure</option>
            </select>
          </Field>
        </div>
        {network.bridgeStatus === 'reviewed' && (
          <div className="space-y-2 rounded border p-2" data-testid="bridge-load-rating-evidence">
            <OptionalNumberField
              label="Lowest confirmed bridge load limit (tonnes)"
              value={network.bridgeLoadTonnes}
              min={0}
              max={1000}
              step={1}
              placeholder="unknown"
              hint="Use the applicable reviewed restriction for this vehicle. A positive imagery/condition record is not a load rating. This model applies the road's lowest entered limit conservatively to the whole feature."
              onChange={(bridgeLoadTonnes) => {
                if (bridgeLoadTonnes !== network.bridgeLoadTonnes)
                  patch({ bridgeLoadTonnes, ...(rating ? { bridgeRating: { ...rating, reviewer: '' } } : {}) })
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              A dated load-rating reference, reviewed applicability and explicit validity are separate from road
              condition or imagery. Editing the entered limit clears the rating review; both known limits remain
              enforced.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={network.bridgeLoadTonnes === null}
              onClick={() => patch({ bridgeRating: createBridgeLoadRatingEvidence(network.bridgeLoadTonnes) })}
            >
              {rating ? 'Start replacement rating for entered limit' : 'Add dated rating for entered limit'}
            </Button>
            {rating && (
              <div className="space-y-2">
                <p className="text-xs">
                  This record supports{' '}
                  {rating.ratedLoadTonnes === null ? 'an unknown load' : `${rating.ratedLoadTonnes} t`}. Changing
                  applicability, dates or reference requires review again.
                </p>
                <Field label="Bridge rating source / report reference">
                  <input
                    className={roadFieldClass}
                    value={rating.sourceReference}
                    maxLength={2000}
                    onChange={(event) => patchRating({ sourceReference: event.target.value })}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Bridge load-rating date">
                    <input
                      type="date"
                      className={roadFieldClass}
                      value={rating.ratedAt ?? ''}
                      onChange={(event) => patchRating({ ratedAt: event.target.value || null })}
                    />
                  </Field>
                  <Field label="Bridge rating valid through">
                    <input
                      type="date"
                      className={roadFieldClass}
                      value={rating.validUntil ?? ''}
                      onChange={(event) => patchRating({ validUntil: event.target.value || null })}
                    />
                  </Field>
                </div>
                <RestrictionList
                  label="Rating applies to vehicle classes"
                  value={rating.vehicleClasses}
                  onChange={(vehicleClasses) => patchRating({ vehicleClasses })}
                />
                <Field label="Bridge rating reviewed by">
                  <input
                    className={roadFieldClass}
                    value={rating.reviewer}
                    maxLength={200}
                    placeholder="unknown / unreviewed"
                    onChange={(event) => patchRating({ reviewer: event.target.value }, true)}
                  />
                </Field>
                <p className="text-[11px] text-muted-foreground">
                  The reviewer is your recorded assertion, not authenticated credentials. Unknown expiry or
                  applicability cannot establish a current load rating. An explicitly permissive unknown-restriction
                  policy is recorded as an assumption; known closures, overloads and inapplicable vehicle classes remain
                  blocked.
                </p>
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <OptionalNumberField
            label="Grade-separation level"
            value={network.level}
            min={-100}
            max={100}
            step={1}
            placeholder="unknown"
            hint="Road endpoints connect within the project snap tolerance only at the same known level, or under an explicit unknown-level assumption. Interior crossings always require shared declared junction IDs."
            onChange={(level) => patch({ level: level === null ? null : Math.round(level) })}
          />
          <NumberField
            label="Network haul cost factor"
            value={network.haulCostFactor}
            min={0.1}
            max={100}
            step={0.1}
            hint="Multiplies travelled distance for the entered network haul rate. A factor of 1 uses measured road distance. This is a cost assumption, not an inferred road condition or truck speed."
            onChange={(haulCostFactor) => patch({ haulCostFactor })}
          />
          <OptionalNumberField
            label="Known forward uphill grade (%)"
            value={network.forwardUphillGradePercent}
            min={0}
            max={100}
            step={0.5}
            placeholder="unknown"
            onChange={(forwardUphillGradePercent) => patch({ forwardUphillGradePercent })}
          />
          <OptionalNumberField
            label="Known forward downhill grade (%)"
            value={network.forwardDownhillGradePercent}
            min={0}
            max={100}
            step={0.5}
            placeholder="unknown"
            onChange={(forwardDownhillGradePercent) => patch({ forwardDownhillGradePercent })}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Forward follows the stored line coordinates. Use reviewed maximum grades, rather than an end-to-end average.
          Reverse travel swaps uphill and downhill checks.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <OptionalNumberField
            label="Rehabilitation ($/reused m)"
            value={network.rehabilitationCostPerM}
            min={0}
            max={1e6}
            step={1}
            placeholder="unpriced"
            onChange={(rehabilitationCostPerM) => patch({ rehabilitationCostPerM })}
          />
          <OptionalNumberField
            label="Access allowance ($)"
            value={network.accessCost}
            min={0}
            max={1e12}
            step={100}
            placeholder="unpriced"
            onChange={(accessCost) => patch({ accessCost })}
          />
          <OptionalNumberField
            label="Structure allowance ($)"
            value={network.structureCost}
            min={0}
            max={1e12}
            step={100}
            placeholder="unpriced"
            onChange={(structureCost) => patch({ structureCost })}
          />
          <OptionalNumberField
            label="Fixed road setup ($)"
            value={network.fixedCost}
            min={0}
            max={1e12}
            step={100}
            placeholder="unpriced"
            onChange={(fixedCost) => patch({ fixedCost })}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Blank rates remain unpriced. Enter 0 explicitly when no allowance is needed. Access, structure and setup
          allowances apply once when any part of this road feature is used; rehabilitation applies to the actual
          traversed portions. Split a road into separate features when a structure allowance only applies to one
          portion.
        </p>
        <div className="space-y-2 rounded border p-2">
          <p className="text-xs font-medium">Declared at-grade junctions</p>
          <p className="text-[11px] text-muted-foreground">
            Use the same ID and location on each connecting road. Crossing lines remain disconnected without this
            evidence. Different known levels cannot be joined.
          </p>
          {network.junctions.map((junction, index) => (
            <div key={index} className="space-y-2 border-t pt-2">
              <Field label={`Junction ${index + 1} ID`}>
                <input
                  className={roadFieldClass}
                  value={junction.id}
                  maxLength={100}
                  onChange={(event) =>
                    patch({
                      junctions: network.junctions.map((j, i) =>
                        i === index ? { ...j, id: event.target.value.replace(/[^a-zA-Z0-9_.:-]/g, '') } : j,
                      ),
                    })
                  }
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label={`Junction ${index + 1} longitude`}
                  value={junction.coordinate[0]}
                  min={-180}
                  max={180}
                  step={0.00001}
                  onChange={(longitude) =>
                    patch({
                      junctions: network.junctions.map((j, i) =>
                        i === index ? { ...j, coordinate: [longitude, j.coordinate[1]] } : j,
                      ),
                    })
                  }
                />
                <NumberField
                  label={`Junction ${index + 1} latitude`}
                  value={junction.coordinate[1]}
                  min={-84.99999}
                  max={84.99999}
                  step={0.00001}
                  onChange={(latitude) =>
                    patch({
                      junctions: network.junctions.map((j, i) =>
                        i === index ? { ...j, coordinate: [j.coordinate[0], latitude] } : j,
                      ),
                    })
                  }
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => patch({ junctions: network.junctions.filter((_, i) => i !== index) })}
              >
                Remove junction {index + 1}
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={!reference || network.junctions.length >= 100}
            onClick={() => {
              if (!reference) return
              let number = 1
              while (network.junctions.some((junction) => junction.id === `junction-${number}`)) number++
              patch({ junctions: [...network.junctions, { id: `junction-${number}`, coordinate: [...reference] }] })
            }}
          >
            Add junction at road start
          </Button>
        </div>
      </div>
    </CollapsibleSection>
  )
}
