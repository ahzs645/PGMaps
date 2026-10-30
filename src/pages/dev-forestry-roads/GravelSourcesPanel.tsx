import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, NumberField, roadFieldClass } from './Controls'
import { RoadSection } from './SidebarParts'
import {
  createSurfacingSupply,
  deliveredSurfacingRate,
  GRAVEL_DATA_GUIDE,
  GRAVEL_PERMIT_GUIDE,
  surfacingSupplyCost,
} from './gravel'
import type { SurfacingSupply } from './engineeringTypes'
import type { Coordinate } from './types'
import {
  GRAVEL_CATALOGUE,
  importGravelCandidates,
  loadGravelCandidates,
  type GravelCandidate,
} from './gravelCandidates'

export function GravelSourcesPanel({
  source,
  volumeM3,
  baseRate,
  onChange,
  road,
}: {
  source?: SurfacingSupply
  volumeM3: number
  baseRate: number
  onChange: (source: SurfacingSupply) => void
  road: Coordinate[]
}) {
  const roadKey = JSON.stringify(road)
  const [lookup, setLookup] = useState<{ key: string; busy: boolean; candidates: GravelCandidate[]; message: string }>({
    key: '',
    busy: false,
    candidates: [],
    message: '',
  })
  const value = source ?? createSurfacingSupply()
  const patch = (update: Partial<SurfacingSupply>) => onChange({ ...value, ...update })
  const result = surfacingSupplyCost(volumeM3, baseRate, value)
  return (
    <RoadSection
      title="Surfacing aggregate source"
      help="An entered delivered-price scenario for compacted surfacing aggregate. Source capacity is separate from borrow fill. Cost summaries and the total-cost vertical profile optimizer include it; horizontal route search uses its own entered cost per metre. Haul distance is an entered one-way distance, not a straight-line estimate or network route."
    >
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={value.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
        Use this aggregate source
      </label>
      <p className="mt-1 text-xs text-muted-foreground">
        Switch off to use the base surfacing rate (${baseRate.toFixed(2)}/m³). A $0 acquisition price still includes
        processing, loading, haul and placement.
      </p>
      <div className="mt-2 space-y-2">
        <Button
          size="sm"
          variant="outline"
          disabled={lookup.busy}
          onClick={async () => {
            setLookup({ key: roadKey, busy: true, candidates: [], message: '' })
            try {
              const candidates = await loadGravelCandidates(road)
              setLookup({
                key: roadKey,
                busy: false,
                candidates,
                message: candidates.length
                  ? `${candidates.length} BC special-use pit / quarry candidates in the road's bounding box plus 10 km.`
                  : 'No special-use pit / quarry candidates were returned. This source is not a complete gravel inventory.',
              })
            } catch (error) {
              setLookup({
                key: roadKey,
                busy: false,
                candidates: [],
                message: error instanceof Error ? error.message : 'Unable to load BC pit candidates.',
              })
            }
          }}
        >
          {lookup.busy ? 'Searching BC pit records…' : 'Find nearby BC pit candidates'}
        </Button>
        <Field label="Import BC special-use pit GeoJSON export">
          <input
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            className="max-w-full text-xs"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              try {
                if (file.size > 4 * 1024 * 1024) throw Error('BC pit export exceeds the 4 MB limit.')
                const candidates = importGravelCandidates(await file.text())
                setLookup({
                  key: roadKey,
                  busy: false,
                  candidates,
                  message: `Imported ${candidates.length} candidate records from ${file.name}; the file may not cover all nearby sources.`,
                })
              } catch (error) {
                setLookup({
                  key: roadKey,
                  busy: false,
                  candidates: [],
                  message: error instanceof Error ? error.message : 'Unable to import BC pit records.',
                })
              }
            }}
          />
        </Field>
        {lookup.key === roadKey && (
          <>
            <p className="text-xs text-muted-foreground" role="status">
              {lookup.message}
            </p>
            {lookup.candidates.map((candidate) => (
              <div key={candidate.id} className="rounded border p-2 text-xs">
                <p>
                  {candidate.name} · {candidate.use} · {candidate.status}
                </p>
                <p className="text-muted-foreground">
                  Record centre {candidate.coordinate[1].toFixed(5)}, {candidate.coordinate[0].toFixed(5)}; entrance and
                  haul route unknown.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onChange({
                      ...createSurfacingSupply(),
                      name: candidate.name.slice(0, 200),
                      capacityM3: 0,
                      sourceNotes: `BC Forest Tenure Special Use Permit candidate ${candidate.fileId}; ${candidate.use}; lifecycle/file status ${candidate.status}. Retrieved ${new Date().toISOString().slice(0, 10)}. ${GRAVEL_CATALOGUE}. Supply price, access rights, quality, capacity and haul distance unverified.`,
                    })
                  }
                >
                  Use as source reference
                </Button>
              </div>
            ))}
          </>
        )}
        <p className="text-[11px] text-muted-foreground">
          Selecting a source reference clears the previous rates and haul assumptions, switches it off, and sets
          available quantity to zero. Enter confirmed capacity and delivery inputs before enabling it.
        </p>
        <Field label="Aggregate source name">
          <input
            className={roadFieldClass}
            value={value.name}
            maxLength={200}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['acquisitionRate', 'Acquisition ($/compacted m³)', 100000],
              ['processingRate', 'Processing ($/compacted m³)', 100000],
              ['loadingRate', 'Loading ($/compacted m³)', 100000],
              ['haulDistanceKm', 'One-way aggregate haul (km)', 1000],
              ['haulRate', 'Aggregate haul ($/m³·km)', 100000],
              ['placementRate', 'Placement ($/compacted m³)', 100000],
            ] as const
          ).map(([key, label, max]) => (
            <NumberField
              key={key}
              label={label}
              value={value[key]}
              max={max}
              onChange={(number) => patch({ [key]: number })}
            />
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => patch({ acquisitionRate: 0 })}>
          Set acquisition price to $0
        </Button>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={value.capacityM3 === null}
            onChange={(e) => patch({ capacityM3: e.target.checked ? null : 1000 })}
          />
          Unbounded aggregate scenario capacity
        </label>
        {value.capacityM3 !== null && (
          <NumberField
            label="Available aggregate (compacted m³)"
            value={value.capacityM3}
            max={1e12}
            onChange={(capacityM3) => patch({ capacityM3 })}
          />
        )}
        <Field label="Aggregate source evidence / access and quality notes">
          <textarea
            className={roadFieldClass}
            rows={2}
            maxLength={2000}
            value={value.sourceNotes}
            onChange={(e) => patch({ sourceNotes: e.target.value })}
          />
        </Field>
        <p className="text-xs" aria-live="polite">
          Delivered rate ${deliveredSurfacingRate(value).toFixed(2)}/compacted m³ · {result.suppliedM3.toFixed(1)} m³
          from source · {result.fallbackM3.toFixed(1)} m³ at base rate · surfacing ${result.cost.toFixed(0)}.
        </p>
        <p className="text-xs text-muted-foreground">
          Rates start as unpriced assumptions. Confirm supply rights, usable quantity, material quality and truck
          access.{' '}
          <a className="underline" href={GRAVEL_DATA_GUIDE} target="_blank" rel="noreferrer">
            BC pit and quarry datasets
          </a>{' '}
          identify candidates; they do not establish a free supply.{' '}
          <a className="underline" href={GRAVEL_PERMIT_GUIDE} target="_blank" rel="noreferrer">
            BC aggregate permitting
          </a>
          .
        </p>
      </div>
    </RoadSection>
  )
}
