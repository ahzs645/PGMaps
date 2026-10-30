import { NativeSelect } from '@/components/ui/form-field'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { Field, OptionalNumberField, roadFieldClass } from './Controls'
import { PlanningCoordinateField } from './PlanningCoordinateField'
import {
  createRoadPlanSource,
  MAX_FULL_COST_SOURCES,
  type TotalCostPlanning,
  type RoadPlanSource,
} from './fullCostPlanning'
import type { RoadWorkspace } from './useRoadWorkspace'

export function FullCostSourcesEditor({
  planning,
  onChange,
  workspace: w,
}: {
  planning: TotalCostPlanning
  onChange: (planning: TotalCostPlanning) => void
  workspace: RoadWorkspace
}) {
  const [selectedId, setSelectedId] = useState('')
  const selected = planning.sources.find((source) => source.id === selectedId) ?? planning.sources[0]
  const patch = (changes: Partial<RoadPlanSource>) =>
    selected &&
    onChange({
      ...planning,
      sources: planning.sources.map((source) => (source.id === selected.id ? { ...source, ...changes } : source)),
    })
  const add = (copyAggregate = false) => {
    if (planning.sources.length >= MAX_FULL_COST_SOURCES) return
    const id = crypto.randomUUID(),
      source = createRoadPlanSource(id)
    source.capacityM3 = 0
    if (copyAggregate && w.alignment.engineering?.surfacingSupply) {
      const old = w.alignment.engineering.surfacingSupply
      Object.assign(source, {
        name: old.name,
        uses: ['surfacing'],
        capacityM3: old.capacityM3,
        acquisitionRate: old.acquisitionRate,
        processingRate: old.processingRate,
        loadingRate: old.loadingRate,
        placementRate: old.placementRate,
        notes:
          `Imported entered aggregate rates. Physical entrance, supply rights and material acceptance require review. ${old.sourceNotes}`.slice(
            0,
            2000,
          ),
      })
    }
    onChange({ ...planning, sources: [...planning.sources, source] })
    setSelectedId(id)
  }
  return (
    <div className="space-y-3" data-testid="full-cost-source-editor">
      <p className="text-xs text-muted-foreground">
        Enter reviewed physical entrances for aggregate, fill and waste disposal. Haul distances come from connected,
        permitted roads and the new connector; pit polygon centres are not entrances. Blank prices are unknown; enter
        zero explicitly for a free component.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => add()} disabled={planning.sources.length >= MAX_FULL_COST_SOURCES}>
          Add planning source
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!w.alignment.engineering?.surfacingSupply || planning.sources.length >= MAX_FULL_COST_SOURCES}
          onClick={() => add(true)}
        >
          Copy aggregate rate assumptions
        </Button>
      </div>
      {!selected ? (
        <InlineAlert>
          Add supply and disposal sites before pricing material demand. Sources begin disabled and unpriced.
        </InlineAlert>
      ) : (
        <div key={selected.id} className="space-y-3">
          <Field label="Planning source">
            <NativeSelect
              className={roadFieldClass}
              value={selected.id}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {planning.sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={selected.enabled}
              onChange={(event) => patch({ enabled: event.target.checked })}
            />
            Include this source in the complete cost comparison
          </label>
          <Field label="Planning source name">
            <input
              className={roadFieldClass}
              maxLength={200}
              value={selected.name}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </Field>
          <Field label="Source material use">
            <NativeSelect
              className={roadFieldClass}
              value={
                selected.uses.includes('waste') ? 'waste' : selected.uses.length === 2 ? 'aggregate' : selected.uses[0]
              }
              onChange={(event) => {
                const basisChanged = selected.uses.includes('waste') !== (event.target.value === 'waste')
                patch({
                  uses:
                    event.target.value === 'aggregate'
                      ? ['surfacing', 'fill']
                      : [event.target.value as 'surfacing' | 'fill' | 'waste'],
                  qualityConfirmed: false,
                  ...(basisChanged
                    ? {
                        accessConfirmed: false,
                        capacityM3: 0,
                        acquisitionRate: null,
                        processingRate: null,
                        loadingRate: null,
                        placementRate: null,
                        fixedCost: null,
                      }
                    : {}),
                })
              }}
            >
              <option value="aggregate">Surfacing and fill (shared compacted capacity)</option>
              <option value="surfacing">Surfacing only (compacted m³)</option>
              <option value="fill">Fill only (compacted m³)</option>
              <option value="waste">Waste disposal only (bank m³)</option>
            </NativeSelect>
          </Field>
          <fieldset className="space-y-2 rounded border p-2">
            <legend className="px-1 text-xs font-medium">Material classes and quality</legend>
            <p className="text-[11px] text-muted-foreground">
              A general suitability confirmation does not identify an exact material or quality class. Select the
              materials this source can supply or accept; changing these fields requires review again.
            </p>
            {(w.alignment.engineering?.materials ?? []).map((material) => (
              <label key={material.id} className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={selected.materialIds?.includes(material.id) ?? false}
                  onChange={(event) =>
                    patch({
                      materialIds: event.target.checked
                        ? [...(selected.materialIds ?? []), material.id]
                        : (selected.materialIds ?? []).filter((id) => id !== material.id),
                      qualityConfirmed: false,
                    })
                  }
                />
                {material.name}
              </label>
            ))}
            <OptionalNumberField
              label="Source material quality (0–100)"
              min={0}
              max={100}
              value={selected.quality ?? null}
              placeholder="unknown"
              onChange={(quality) => patch({ quality: quality ?? undefined, qualityConfirmed: false })}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => patch({ materialIds: undefined, quality: undefined, qualityConfirmed: false })}
            >
              Clear material classification
            </Button>
          </fieldset>
          <PlanningCoordinateField
            label="Source"
            value={selected.entrance}
            onChange={(entrance) => patch({ entrance, accessConfirmed: false, qualityConfirmed: false })}
          />
          <Field label="Source entrance road attachment">
            <NativeSelect
              className={roadFieldClass}
              value={selected.entranceRoadId ?? ''}
              onChange={(event) =>
                patch({ entranceRoadId: event.target.value || null, accessConfirmed: false, qualityConfirmed: false })
              }
            >
              <option value="">Determine from unambiguous geometry</option>
              {w.project.context
                .filter((feature) => feature.kind === 'existing-road')
                .map((road) => (
                  <option key={road.id} value={road.id}>
                    {road.name}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              patch({
                entrance: [...w.alignment.points.at(-1)!.coordinate],
                accessConfirmed: false,
                qualityConfirmed: false,
              })
            }
          >
            Set entrance from road end for review
          </Button>
          <div className="space-y-1.5">
            <label className="flex gap-2 text-xs">
              <input
                type="checkbox"
                checked={selected.accessConfirmed}
                onChange={(event) => patch({ accessConfirmed: event.target.checked })}
              />
              Supply/disposal access confirmed for this planning scenario
            </label>
            <label className="flex gap-2 text-xs">
              <input
                type="checkbox"
                checked={selected.qualityConfirmed}
                onChange={(event) => patch({ qualityConfirmed: event.target.checked })}
              />
              Material suitability or disposal acceptance confirmed
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {selected.uses.includes('waste')
              ? 'Waste prices and capacity use bank cubic metres.'
              : 'Aggregate prices and shared capacity use compacted cubic metres.'}{' '}
            These confirmations record your supplied evidence, not a catalogue inference.
          </p>
          <p className="text-[11px] text-muted-foreground">
            Changing the entrance requires a new access and material review. Switching between bank waste and compacted
            aggregate also clears quantities and price assumptions.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <OptionalNumberField
              label="Source capacity (m³)"
              value={selected.capacityM3}
              min={0}
              max={1e12}
              step={100}
              placeholder="explicitly unbounded"
              onChange={(capacityM3) => patch({ capacityM3 })}
            />
            <OptionalNumberField
              label="Source acquisition/disposal ($/m³)"
              value={selected.acquisitionRate}
              min={0}
              max={1e6}
              placeholder="unpriced"
              onChange={(acquisitionRate) => patch({ acquisitionRate })}
            />
            <OptionalNumberField
              label="Source processing ($/m³)"
              value={selected.processingRate}
              min={0}
              max={1e6}
              placeholder="unpriced"
              onChange={(processingRate) => patch({ processingRate })}
            />
            <OptionalNumberField
              label="Source loading ($/m³)"
              value={selected.loadingRate}
              min={0}
              max={1e6}
              placeholder="unpriced"
              onChange={(loadingRate) => patch({ loadingRate })}
            />
            <OptionalNumberField
              label="Source placement ($/m³)"
              value={selected.placementRate}
              min={0}
              max={1e6}
              placeholder="unpriced"
              onChange={(placementRate) => patch({ placementRate })}
            />
            <OptionalNumberField
              label="Source preparation ($)"
              value={selected.fixedCost}
              min={0}
              max={1e12}
              step={100}
              placeholder="unpriced"
              onChange={(fixedCost) => patch({ fixedCost })}
            />
          </div>
          <Field label="Supply/disposal evidence and quotes">
            <textarea
              className={roadFieldClass}
              rows={3}
              maxLength={2000}
              value={selected.notes}
              onChange={(event) => patch({ notes: event.target.value })}
            />
          </Field>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onChange({ ...planning, sources: planning.sources.filter((source) => source.id !== selected.id) })
            }
          >
            Remove planning source
          </Button>
        </div>
      )}
    </div>
  )
}
