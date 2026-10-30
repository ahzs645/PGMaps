import { Button } from '@/components/ui/button'
import { Field, NumberField, OptionalNumberField, roadFieldClass } from './Controls'
import { RoadSection } from './SidebarParts'
import type { AlignmentEngineering, FillRequirement, HaulDirectionRange, SidecastRange } from './engineeringTypes'
import { MAX_FILL_REQUIREMENTS, MAX_HAUL_DIRECTION_RANGES, MAX_SIDECAST_RANGES } from './allocationPolicy'

export function MaterialAllocationControls({
  design: e,
  onChange,
  length,
  requirementsOnly = false,
  layerIds = [],
}: {
  design: AlignmentEngineering
  onChange: (value: AlignmentEngineering) => void
  length: number
  requirementsOnly?: boolean
  layerIds?: string[]
}) {
  const enable = (value: AlignmentEngineering) =>
    onChange({ ...value, haul: { ...value.haul, enabled: true, allocation: 'economic' } })
  const patchRequirement = (id: string, patch: Partial<FillRequirement>) =>
    enable({ ...e, fillRequirements: (e.fillRequirements ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)) })
  const patchDirection = (id: string, patch: Partial<HaulDirectionRange>) =>
    enable({
      ...e,
      haul: {
        ...e.haul,
        directionRanges: (e.haul.directionRanges ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
      },
    })
  const patchSidecast = (id: string, patch: Partial<SidecastRange>) =>
    enable({
      ...e,
      haul: {
        ...e.haul,
        sidecastRanges: (e.haul.sidecastRanges ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
      },
    })
  const end = Math.max(1, length)
  const fillMaterials = e.materials.filter((material) => material.purpose !== 'stripping')
  const knownLayers = [
    ...new Set([
      'subgrade',
      'surfacing',
      ...layerIds,
      ...e.templates.flatMap((t) => [
        ...(t.template.layers ?? []).map((l) => l.id),
        ...(t.template.components ?? []).filter((c) => c.kind === 'key').map((c) => c.id),
      ]),
    ]),
  ]
  return (
    <div className="space-y-3" data-testid="road-material-allocation-policy">
      <RoadSection
        title="Required fill materials"
        help="Assign an exact material or a minimum quality class to subgrade or a named surface/component layer. Unknown material quality cannot satisfy a quality requirement. Adding rules enables economic allocation."
      >
        <Button
          size="sm"
          variant="outline"
          disabled={(e.fillRequirements?.length ?? 0) >= MAX_FILL_REQUIREMENTS || !fillMaterials.length}
          onClick={() =>
            enable({
              ...e,
              fillRequirements: [
                ...(e.fillRequirements ?? []),
                {
                  id: crypto.randomUUID(),
                  start: 0,
                  end,
                  layer: 'subgrade',
                  materialId: fillMaterials[0].id,
                  replaceable: false,
                },
              ],
            })
          }
        >
          Add fill requirement
        </Button>
        {(e.fillRequirements ?? []).map((r, index) => (
          <div key={r.id} className="mt-2 space-y-2 rounded border p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">Requirement {index + 1}</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove fill requirement ${index + 1}`}
                onClick={() => onChange({ ...e, fillRequirements: e.fillRequirements?.filter((q) => q.id !== r.id) })}
              >
                Remove
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label={`Requirement ${index + 1} start (m)`}
                value={r.start}
                onChange={(start) => patchRequirement(r.id, { start })}
              />
              <NumberField
                label={`Requirement ${index + 1} end (m)`}
                value={r.end}
                onChange={(value) => patchRequirement(r.id, { end: value })}
              />
              <Field label={`Requirement ${index + 1} layer`}>
                <select
                  className={roadFieldClass}
                  value={r.layer}
                  onChange={(event) => patchRequirement(r.id, { layer: event.target.value })}
                >
                  {[...new Set([...knownLayers, r.layer])].map((id) => (
                    <option key={id} value={id}>
                      {id === 'subgrade' ? 'Subgrade fill' : id === 'surfacing' ? 'Default surfacing' : id}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`Requirement ${index + 1} material`}>
                <select
                  className={roadFieldClass}
                  value={r.materialId ?? ''}
                  onChange={(event) => patchRequirement(r.id, { materialId: event.target.value || undefined })}
                >
                  {r.replaceable && <option value="">Minimum quality only</option>}
                  {e.materials
                    .filter((m) => m.purpose !== 'stripping')
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </Field>
              <OptionalNumberField
                label={`Requirement ${index + 1} minimum quality`}
                min={0}
                max={100}
                value={r.minQuality ?? null}
                placeholder="use selected material's quality"
                onChange={(minQuality) => patchRequirement(r.id, { minQuality: minQuality ?? undefined })}
              />
            </div>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={r.replaceable}
                onChange={(event) =>
                  patchRequirement(r.id, {
                    replaceable: event.target.checked,
                    ...(!event.target.checked && !r.materialId ? { materialId: fillMaterials[0]?.id } : {}),
                  })
                }
              />
              Permit substitution by quality
            </label>
          </div>
        ))}
      </RoadSection>
      {!requirementsOnly && (
        <>
          <RoadSection
            title="Construction movement direction"
            help="Forward is increasing road station, backward decreasing. Every crossed range applies. A blocked range permits same-station handling but prevents haul across it."
          >
            <Button
              size="sm"
              variant="outline"
              disabled={(e.haul.directionRanges?.length ?? 0) >= MAX_HAUL_DIRECTION_RANGES}
              onClick={() =>
                enable({
                  ...e,
                  haul: {
                    ...e.haul,
                    directionRanges: [
                      ...(e.haul.directionRanges ?? []),
                      { id: crypto.randomUUID(), start: 0, end, direction: 'forward' },
                    ],
                  },
                })
              }
            >
              Add direction range
            </Button>
            {(e.haul.directionRanges ?? []).map((r, index) => (
              <div key={r.id} className="mt-2 space-y-2 rounded border p-2">
                <div className="grid grid-cols-2 gap-2">
                  <NumberField
                    label={`Direction ${index + 1} start (m)`}
                    value={r.start}
                    onChange={(start) => patchDirection(r.id, { start })}
                  />
                  <NumberField
                    label={`Direction ${index + 1} end (m)`}
                    value={r.end}
                    onChange={(value) => patchDirection(r.id, { end: value })}
                  />
                </div>
                <Field label={`Direction ${index + 1} movement`}>
                  <select
                    className={roadFieldClass}
                    value={r.direction}
                    onChange={(event) =>
                      patchDirection(r.id, { direction: event.target.value as HaulDirectionRange['direction'] })
                    }
                  >
                    <option value="forward">Forward only</option>
                    <option value="backward">Backward only</option>
                    <option value="blocked">Blocked</option>
                  </select>
                </Field>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onChange({
                      ...e,
                      haul: { ...e.haul, directionRanges: e.haul.directionRanges?.filter((q) => q.id !== r.id) },
                    })
                  }
                >
                  Remove direction range {index + 1}
                </Button>
              </div>
            ))}
          </RoadSection>
          <RoadSection
            title="Permitted sidecast"
            help="Only excavated material originating inside a permitted interval can be sidecast. Capacity applies locally per road metre and is shared by all materials; no haul/loading charge is added to sidecast disposal."
          >
            <Button
              size="sm"
              variant="outline"
              disabled={(e.haul.sidecastRanges?.length ?? 0) >= MAX_SIDECAST_RANGES}
              onClick={() =>
                enable({
                  ...e,
                  haul: {
                    ...e.haul,
                    sidecastRanges: [
                      ...(e.haul.sidecastRanges ?? []),
                      { id: crypto.randomUUID(), start: 0, end, capacityBankM3PerM: 0, unitRate: 0 },
                    ],
                  },
                })
              }
            >
              Add sidecast range
            </Button>
            {(e.haul.sidecastRanges ?? []).map((r, index) => (
              <div key={r.id} className="mt-2 space-y-2 rounded border p-2">
                <div className="grid grid-cols-2 gap-2">
                  <NumberField
                    label={`Sidecast ${index + 1} start (m)`}
                    value={r.start}
                    onChange={(start) => patchSidecast(r.id, { start })}
                  />
                  <NumberField
                    label={`Sidecast ${index + 1} end (m)`}
                    value={r.end}
                    onChange={(value) => patchSidecast(r.id, { end: value })}
                  />
                  <NumberField
                    label={`Sidecast ${index + 1} capacity (bank m³/m)`}
                    value={r.capacityBankM3PerM}
                    max={10000}
                    onChange={(capacityBankM3PerM) => patchSidecast(r.id, { capacityBankM3PerM })}
                  />
                  <NumberField
                    label={`Sidecast ${index + 1} disposal ($/bank m³)`}
                    value={r.unitRate}
                    onChange={(unitRate) => patchSidecast(r.id, { unitRate })}
                  />
                </div>
                <Field label={`Sidecast ${index + 1} accepted material`}>
                  <select
                    className={roadFieldClass}
                    value={r.materialIds?.length === 1 ? r.materialIds[0] : ''}
                    onChange={(event) =>
                      patchSidecast(r.id, { materialIds: event.target.value ? [event.target.value] : undefined })
                    }
                  >
                    <option value="">All entered materials</option>
                    {e.materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onChange({
                      ...e,
                      haul: { ...e.haul, sidecastRanges: e.haul.sidecastRanges?.filter((q) => q.id !== r.id) },
                    })
                  }
                >
                  Remove sidecast range {index + 1}
                </Button>
              </div>
            ))}
          </RoadSection>
        </>
      )}
    </div>
  )
}
