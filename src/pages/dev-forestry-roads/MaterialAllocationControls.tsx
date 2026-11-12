import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Field, NumberField, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import { RoadSection } from './SidebarParts'
import type { AlignmentEngineering, FillRequirement, HaulDirectionRange, SidecastRange } from './engineeringTypes'
import { MAX_FILL_REQUIREMENTS, MAX_HAUL_DIRECTION_RANGES, MAX_SIDECAST_RANGES } from './allocationPolicy'
import { EntryProblem } from './InputProblem'
import { freeStationRange, inputMessage, type InvalidInput } from './inputErrors'

export function MaterialAllocationControls({
  design: e,
  onChange,
  length,
  requirementsOnly = false,
  layerIds = [],
  problem,
}: {
  design: AlignmentEngineering
  onChange: (value: AlignmentEngineering) => void
  length: number
  requirementsOnly?: boolean
  layerIds?: string[]
  /** The current invalid edit, if any; its message is shown at the range it names. */
  problem?: InvalidInput
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
  // Requirements on one layer cannot overlap, nor can sidecast ranges: a new one takes free road,
  // on the first layer that still has some.
  const freeRequirement = knownLayers
    .map((layer) => ({
      layer,
      range: freeStationRange(
        (e.fillRequirements ?? []).filter((r) => r.layer === layer),
        end,
      ),
    }))
    .find((candidate) => candidate.range)
  const freeSidecast = freeStationRange(e.haul.sidecastRanges ?? [], end)
  return (
    <div className="space-y-3" data-testid="road-material-allocation-policy">
      <RoadSection
        title="Required fill materials"
        help="Assign an exact material or a minimum quality class to subgrade or a named surface/component layer. Unknown material quality cannot satisfy a quality requirement. Adding rules enables economic allocation."
      >
        <Button
          size="sm"
          variant="outline"
          disabled={
            (e.fillRequirements?.length ?? 0) >= MAX_FILL_REQUIREMENTS || !fillMaterials.length || !freeRequirement
          }
          onClick={() =>
            freeRequirement?.range &&
            enable({
              ...e,
              fillRequirements: [
                ...(e.fillRequirements ?? []),
                {
                  id: crypto.randomUUID(),
                  ...freeRequirement.range,
                  layer: freeRequirement.layer,
                  materialId: fillMaterials[0].id,
                  replaceable: false,
                },
              ],
            })
          }
        >
          Add fill requirement
        </Button>
        {!fillMaterials.length && (
          <p className="mt-2 text-2xs text-muted-foreground">Add a ground material in Engineering → Ground first.</p>
        )}
        {fillMaterials.length > 0 && !freeRequirement && (
          <p className="mt-2 text-2xs text-muted-foreground">
            Every layer already has a requirement over the whole road. Shorten one to add another.
          </p>
        )}
        {(e.fillRequirements ?? []).map((r, index) => (
          <div key={r.id} className={cn(insetBox(), 'mt-2 space-y-2')}>
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
                error={inputMessage(problem, 'fillRequirements', r.id, 'start')}
                onChange={(start) => patchRequirement(r.id, { start })}
              />
              <NumberField
                label={`Requirement ${index + 1} end (m)`}
                value={r.end}
                error={inputMessage(problem, 'fillRequirements', r.id, 'end')}
                onChange={(value) => patchRequirement(r.id, { end: value })}
              />
              <Field label={`Requirement ${index + 1} layer`}>
                <RoadSelect
                  ariaLabel={`Requirement ${index + 1} layer`}
                  className={roadFieldClass}
                  value={r.layer}
                  onValueChange={(value) => patchRequirement(r.id, { layer: value })}
                >
                  {[...new Set([...knownLayers, r.layer])].map((id) => (
                    <option key={id} value={id}>
                      {id === 'subgrade' ? 'Subgrade fill' : id === 'surfacing' ? 'Default surfacing' : id}
                    </option>
                  ))}
                </RoadSelect>
              </Field>
              <Field label={`Requirement ${index + 1} material`}>
                <RoadSelect
                  ariaLabel={`Requirement ${index + 1} material`}
                  className={roadFieldClass}
                  value={r.materialId ?? ''}
                  onValueChange={(value) => patchRequirement(r.id, { materialId: value || undefined })}
                >
                  {r.replaceable && <option value="">Minimum quality only</option>}
                  {e.materials
                    .filter((m) => m.purpose !== 'stripping')
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </RoadSelect>
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
            <EntryProblem problem={problem} list="fillRequirements" id={r.id} inlineFields={['start', 'end']} />
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
              <div key={r.id} className={cn(insetBox(), 'mt-2 space-y-2')}>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField
                    label={`Direction ${index + 1} start (m)`}
                    value={r.start}
                    error={inputMessage(problem, 'directionRanges', r.id, 'start')}
                    onChange={(start) => patchDirection(r.id, { start })}
                  />
                  <NumberField
                    label={`Direction ${index + 1} end (m)`}
                    value={r.end}
                    error={inputMessage(problem, 'directionRanges', r.id, 'end')}
                    onChange={(value) => patchDirection(r.id, { end: value })}
                  />
                </div>
                <EntryProblem problem={problem} list="directionRanges" id={r.id} inlineFields={['start', 'end']} />
                <Field label={`Direction ${index + 1} movement`}>
                  <RoadSelect
                    ariaLabel={`Direction ${index + 1} movement`}
                    className={roadFieldClass}
                    value={r.direction}
                    onValueChange={(value) =>
                      patchDirection(r.id, { direction: value as HaulDirectionRange['direction'] })
                    }
                  >
                    <option value="forward">Forward only</option>
                    <option value="backward">Backward only</option>
                    <option value="blocked">Blocked</option>
                  </RoadSelect>
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
              disabled={(e.haul.sidecastRanges?.length ?? 0) >= MAX_SIDECAST_RANGES || !freeSidecast}
              onClick={() =>
                freeSidecast &&
                enable({
                  ...e,
                  haul: {
                    ...e.haul,
                    sidecastRanges: [
                      ...(e.haul.sidecastRanges ?? []),
                      { id: crypto.randomUUID(), ...freeSidecast, capacityBankM3PerM: 0, unitRate: 0 },
                    ],
                  },
                })
              }
            >
              Add sidecast range
            </Button>
            {!freeSidecast && (
              <p className="mt-2 text-2xs text-muted-foreground">
                The whole road already has a sidecast range. Shorten one to add another.
              </p>
            )}
            {(e.haul.sidecastRanges ?? []).map((r, index) => (
              <div key={r.id} className={cn(insetBox(), 'mt-2 space-y-2')}>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField
                    label={`Sidecast ${index + 1} start (m)`}
                    value={r.start}
                    error={inputMessage(problem, 'sidecastRanges', r.id, 'start')}
                    onChange={(start) => patchSidecast(r.id, { start })}
                  />
                  <NumberField
                    label={`Sidecast ${index + 1} end (m)`}
                    value={r.end}
                    error={inputMessage(problem, 'sidecastRanges', r.id, 'end')}
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
                  <RoadSelect
                    ariaLabel={`Sidecast ${index + 1} accepted material`}
                    className={roadFieldClass}
                    value={r.materialIds?.length === 1 ? r.materialIds[0] : ''}
                    onValueChange={(value) => patchSidecast(r.id, { materialIds: value ? [value] : undefined })}
                  >
                    <option value="">All entered materials</option>
                    {e.materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </RoadSelect>
                </Field>
                <EntryProblem problem={problem} list="sidecastRanges" id={r.id} inlineFields={['start', 'end']} />
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
