import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import { RoadSection } from './SidebarParts'
import {
  CROSSING_STRUCTURES,
  LEGACY_CULVERT_ASSOCIATION_M,
  estimateCrossings,
  newCrossingCostItem,
  priceCrossingItems,
  synchronizeCrossingRecords,
} from './crossingPlan'
import type { CrossingCostItem, CrossingStructure, StreamCrossingRecord } from './crossingPlanTypes'
import type { RoadWorkspace } from './useRoadWorkspace'

const money = (value: number) => `$${value.toLocaleString('en-CA', { maximumFractionDigits: 2 })}`

function EstimateItems({
  items,
  onChange,
  shared = false,
}: {
  items: CrossingCostItem[]
  onChange: (items: CrossingCostItem[]) => void
  shared?: boolean
}) {
  const [selectedItem, setSelectedItem] = useState('')
  const activeId = items.find((item) => item.id === selectedItem)?.id ?? items[0]?.id
  const update = (id: string, change: Partial<CrossingCostItem>) =>
    onChange(items.map((item) => (item.id === id ? { ...item, ...change } : item)))
  return (
    <div className="space-y-3">
      {items.length > 0 && (
        <Field label={shared ? 'Shared estimate item' : 'Estimate item'}>
          <RoadSelect
            className={roadFieldClass}
            ariaLabel={shared ? 'Shared estimate item' : 'Estimate item'}
            value={activeId}
            onValueChange={(value) => setSelectedItem(value)}
          >
            {items.map((item, index) => (
              <option key={item.id} value={item.id}>
                {index + 1}. {item.label}
              </option>
            ))}
          </RoadSelect>
        </Field>
      )}
      {items.flatMap((item, index) =>
        item.id !== activeId
          ? []
          : [
              <fieldset key={item.id} className="space-y-2 rounded border p-2">
                <legend className="px-1 text-xs font-medium">
                  {shared ? 'Shared item' : 'Estimate item'} {index + 1}
                </legend>
                <Field label="Item description">
                  <input
                    className={roadFieldClass}
                    aria-label={`Item ${index + 1} description`}
                    value={item.label}
                    maxLength={200}
                    onChange={(event) => update(item.id, { label: event.target.value })}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <OptionalNumberField
                    label="Quantity"
                    value={item.quantity}
                    min={0}
                    max={1e9}
                    placeholder="Unknown"
                    onChange={(quantity) => update(item.id, { quantity })}
                  />
                  <Field label="Unit">
                    <input
                      className={roadFieldClass}
                      aria-label={`Item ${index + 1} unit`}
                      value={item.unit}
                      maxLength={30}
                      onChange={(event) => update(item.id, { unit: event.target.value })}
                    />
                  </Field>
                </div>
                <OptionalNumberField
                  label="Unit rate ($)"
                  value={item.unitRate}
                  min={0}
                  max={1e9}
                  placeholder="Unpriced"
                  onChange={(unitRate) => update(item.id, { unitRate })}
                />
                <Field label="Price source / quote reference">
                  <input
                    className={roadFieldClass}
                    aria-label={`Item ${index + 1} price source`}
                    value={item.source}
                    maxLength={2000}
                    onChange={(event) => update(item.id, { source: event.target.value })}
                  />
                </Field>
                <Field label="Source link (optional)">
                  <input
                    type="url"
                    className={roadFieldClass}
                    aria-label={`Item ${index + 1} source link`}
                    value={item.sourceUrl}
                    maxLength={2000}
                    onChange={(event) => update(item.id, { sourceUrl: event.target.value })}
                  />
                </Field>
                <Field label="Price date">
                  <input
                    type="date"
                    className={roadFieldClass}
                    aria-label={`Item ${index + 1} price date`}
                    value={item.priceDate}
                    onChange={(event) => update(item.id, { priceDate: event.target.value })}
                  />
                </Field>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span>
                    {item.quantity === null || item.unitRate === null
                      ? 'Unpriced'
                      : money(item.quantity * item.unitRate)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onChange(items.filter((entry) => entry.id !== item.id))}
                  >
                    Remove item {index + 1}
                  </Button>
                </div>
              </fieldset>,
            ],
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={items.length >= 100}
        onClick={() => {
          const item = newCrossingCostItem(
            crypto.randomUUID(),
            shared ? 'Shared survey, design or mobilization' : 'Additional crossing work',
          )
          onChange([...items, item])
          setSelectedItem(item.id)
        }}
      >
        Add {shared ? 'shared ' : ''}estimate item
      </Button>
    </div>
  )
}

export function StreamCrossingsPanel({ workspace }: { workspace: RoadWorkspace }) {
  const { alignment, analysis, project } = workspace
  const estimate =
    analysis.crossingEstimate ?? estimateCrossings(alignment, analysis, project.context, project.sharedCrossingCosts)
  const [selected, setSelected] = useState('')
  const [retiredId, setRetiredId] = useState('')
  const retired = estimate.retired.find((record) => record.id === retiredId) ?? estimate.retired[0]
  const row = estimate.rows.find((entry) => entry.record.id === selected) ?? estimate.rows[0]
  const saveRecord = (record: StreamCrossingRecord) =>
    workspace.updateAlignment((a) => ({
      ...a,
      crossingRecords: (a.crossingRecords ?? []).some((r) => r.id === record.id)
        ? a.crossingRecords!.map((r) => (r.id === record.id ? record : r))
        : [...(a.crossingRecords ?? []), record],
    }))
  const shared = project.sharedCrossingCosts ?? []
  const sharedPrice = priceCrossingItems(shared)
  return (
    <RoadSection
      title="Stream crossing estimates"
      summary={`${estimate.rows.length} crossings · ${estimate.complete ? money(estimate.knownSubtotal) : 'Incomplete / unpriced'}`}
      help="Each physical road–stream intersection keeps its own planning record. Select a structure option and enter item quantities, rates, quote/source and price date. No structure is approved automatically, and no DFO sizing or installed-price table is used as a default. Geometry or stream assessment changes need review; moved crossings receive new records. Shared costs are charged once in each road alternative's estimate before its contingency. Route-search price groups remain screening allowances."
      data-testid="stream-crossings-panel"
    >
      <p className="text-xs text-muted-foreground">
        Known subtotal {money(estimate.knownSubtotal)} before contingency.{' '}
        {estimate.complete
          ? 'Entered prices; engineering review still required.'
          : 'Complete the outstanding records and prices.'}
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={!estimate.rows.some((entry) => entry.status === 'unrecorded')}
        onClick={() =>
          workspace.updateAlignment((a) => ({
            ...a,
            crossingRecords: synchronizeCrossingRecords(a, analysis.crossings, project.context),
          }))
        }
      >
        Record detected crossings
      </Button>
      {!row && <p className="text-xs text-muted-foreground">No mapped stream crossings on this road.</p>}
      {row && (
        <div className="space-y-3">
          <Field label="Crossing">
            <RoadSelect
              className={roadFieldClass}
              ariaLabel="Stream crossing"
              value={row.record.id}
              onValueChange={(value) => setSelected(value)}
            >
              {estimate.rows.map((entry) => (
                <option key={entry.record.id} value={entry.record.id}>
                  {entry.name} — {entry.chainage.toFixed(1)} m — {entry.status}
                </option>
              ))}
            </RoadSelect>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => workspace.setStation(row.chainage)}>
              Show crossing station
            </Button>
            {row.status === 'needs-review' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  saveRecord({ ...row.record, basisFingerprint: row.basisFingerprint, chainage: row.chainage })
                }
              >
                Confirm geometry and evidence review
              </Button>
            )}
          </div>
          <Field label="Planning structure option">
            <RoadSelect
              className={roadFieldClass}
              ariaLabel="Planning structure option"
              value={row.record.structure}
              onValueChange={(value) => saveRecord({ ...row.record, structure: value as CrossingStructure })}
            >
              {CROSSING_STRUCTURES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </RoadSelect>
          </Field>
          <p className="text-xs text-muted-foreground">
            A structure choice is not a hydraulic, fish-passage or regulatory approval.
          </p>
          <Field label="Crossing evidence / review notes">
            <textarea
              className={roadFieldClass}
              aria-label="Crossing evidence / review notes"
              value={row.record.evidence}
              maxLength={10000}
              rows={3}
              onChange={(event) => saveRecord({ ...row.record, evidence: event.target.value })}
            />
          </Field>
          {(row.record.replacesCulvertId ||
            alignment.engineering?.culverts.some((c) => c.sourceFeatureId === row.record.featureId)) && (
            <Field label="Replace existing installed allowance">
              <RoadSelect
                className={roadFieldClass}
                ariaLabel="Replace existing installed allowance"
                value={row.record.replacesCulvertId ?? ''}
                onValueChange={(value) => saveRecord({ ...row.record, replacesCulvertId: value || undefined })}
              >
                <option value="">Choose a matching engineering culvert</option>
                {alignment.engineering?.culverts
                  .filter(
                    (c) =>
                      c.sourceFeatureId === row.record.featureId &&
                      Math.abs(c.chainage - row.chainage) <= LEGACY_CULVERT_ASSOCIATION_M,
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.chainage.toFixed(1)} m
                    </option>
                  ))}
                {row.record.replacesCulvertId &&
                  !alignment.engineering?.culverts.some(
                    (c) =>
                      c.id === row.record.replacesCulvertId &&
                      c.sourceFeatureId === row.record.featureId &&
                      Math.abs(c.chainage - row.chainage) <= LEGACY_CULVERT_ASSOCIATION_M,
                  ) && <option value={row.record.replacesCulvertId}>Previous culvert no longer matches</option>}
              </RoadSelect>
            </Field>
          )}
          <EstimateItems items={row.record.items} onChange={(items) => saveRecord({ ...row.record, items })} />
          {row.missing.length > 0 && (
            <ul className="list-disc space-y-1 pl-4 text-xs text-amber-800 dark:text-amber-300">
              {row.missing.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <RoadSection
        title="Shared crossing costs"
        summary={`${shared.length} items · ${sharedPrice.complete ? money(sharedPrice.knownSubtotal) : 'Unpriced'}`}
        help="Use for project survey, design, environmental work or mobilization that serves these crossings. Each item is added once per alternative estimate, never multiplied by the crossing count. Do not enter an amount already included in engineering mobilization or another cost item."
      >
        <EstimateItems
          shared
          items={shared}
          onChange={(items) => workspace.update((p) => ({ ...p, sharedCrossingCosts: items }))}
        />
        {sharedPrice.missing.map((message) => (
          <p key={message} className="text-xs text-amber-800 dark:text-amber-300">
            {message}
          </p>
        ))}
      </RoadSection>
      {retired && (
        <details className="text-xs">
          <summary>{estimate.retired.length} earlier records retained outside this estimate</summary>
          <div className="space-y-2 pt-2">
            <Field label="Earlier crossing record">
              <RoadSelect
                className={roadFieldClass}
                ariaLabel="Earlier crossing record"
                value={retired.id}
                onValueChange={(value) => setRetiredId(value)}
              >
                {estimate.retired.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.featureId} — former {record.chainage.toFixed(1)} m
                  </option>
                ))}
              </RoadSelect>
            </Field>
            <p>
              <strong>
                {retired.featureId} — former {retired.chainage.toFixed(1)} m
              </strong>
              <br />
              {retired.structure}; {retired.evidence || 'No review notes'}. {retired.items.length} price items retained
              in the saved project.
            </p>
          </div>
        </details>
      )}
    </RoadSection>
  )
}
