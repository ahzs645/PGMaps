import { InfoTip } from '@/components/ui/info-tip'
import { Button } from '@/components/ui/button'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { Field, NumberField, roadFieldClass, RoadSelect } from './Controls'
import type { ContextFeature, GroundMaterial, RoadTemplate, SectionComponent, SectionLayer } from './types'
import { ComponentLibrary } from './ComponentLibrary'

/** Ordered physical section additions and separate material courses; saved with the template. */
export function SectionAssemblyEditor({
  template,
  onChange,
  materials = [],
  features = [],
  surfaces = [],
  onRockFillTemplate,
}: {
  template: RoadTemplate
  onChange: (template: RoadTemplate) => void
  materials?: GroundMaterial[]
  features?: ContextFeature[]
  surfaces?: { id: string; name: string }[]
  /**
   * Starts a keyed rock-fill template as a new named template. It never edits `template`: a rock
   * fill belongs to the station ranges and sides it is assigned to, not to the whole road.
   */
  onRockFillTemplate?: () => void
}) {
  const components = template.components ?? [],
    layers = template.layers ?? []
  // A course stack is at most 5 m per side, so a new course takes what room is left.
  const stackRoomM =
    5 -
    Math.max(
      ...(['left', 'right'] as const).map((side) =>
        layers.filter((l) => l.side === side || l.side === 'both').reduce((sum, l) => sum + l.depthM, 0),
      ),
    )
  const update = (id: string, patch: Partial<SectionComponent>) =>
    onChange({ ...template, components: components.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
  const updateLayer = (id: string, patch: Partial<SectionLayer>) =>
    onChange({ ...template, layers: layers.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
  const material = (value: string | undefined, change: (id: string | undefined) => void, label: string) => (
    <Field label={label}>
      <RoadSelect
        className={roadFieldClass}
        ariaLabel={label}
        value={value ?? ''}
        onValueChange={(value) => change(value || undefined)}
      >
        <option value="">Unspecified material</option>
        {value && !materials.some((m) => m.id === value) && <option value={value}>{value}</option>}
        {materials
          .filter((m) => m.purpose !== 'stripping')
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
      </RoadSelect>
    </Field>
  )
  return (
    <div className="space-y-3 border-t pt-3" data-testid="road-section-assembly">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">Section assembly</p>
        <InfoTip label="About section assembly">
          Components follow the formation/ditch in list order. Keys excavate below ground and replace it with fill. Wall
          geometry does not assess structural capacity.
        </InfoTip>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={components.length >= 40}
          onClick={() =>
            onChange({
              ...template,
              components: [
                ...components,
                {
                  id: crypto.randomUUID(),
                  name: 'Bench',
                  side: 'left',
                  kind: 'bench',
                  condition: 'cut',
                  widthM: 1.5,
                  riseM: 0,
                },
              ],
            })
          }
        >
          Add component
        </Button>
        {onRockFillTemplate && (
          <Button size="sm" variant="outline" onClick={onRockFillTemplate}>
            New keyed rock-fill template
          </Button>
        )}
      </div>
      {components.map((c, i) => (
        <div key={c.id} className={cn(insetBox(), 'space-y-2')}>
          <Field label={`Component ${i + 1} name`}>
            <input
              className={roadFieldClass}
              value={c.name}
              maxLength={200}
              onChange={(e) => update(c.id, { name: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={`Component ${i + 1} type`}>
              <RoadSelect
                ariaLabel={`Component ${i + 1} type`}
                className={roadFieldClass}
                value={c.kind}
                onValueChange={(value) =>
                  update(c.id, {
                    kind: value as SectionComponent['kind'],
                    ...(value === 'key'
                      ? {
                          depthM: c.depthM ?? 1,
                          condition: 'fill',
                          referenceFeatureId: undefined,
                          referenceSurfaceId: undefined,
                        }
                      : {}),
                  })
                }
              >
                <option value="bench">Bench</option>
                <option value="slope">Slope segment</option>
                <option value="wall">Retaining face</option>
                <option value="key">Excavated key</option>
              </RoadSelect>
            </Field>
            <Field label={`Component ${i + 1} side`}>
              <RoadSelect
                ariaLabel={`Component ${i + 1} side`}
                className={roadFieldClass}
                value={c.side}
                onValueChange={(value) => update(c.id, { side: value as SectionComponent['side'] })}
              >
                <option value="left">Left</option>
                <option value="right">Right</option>
              </RoadSelect>
            </Field>
            <Field label={`Component ${i + 1} condition`}>
              <RoadSelect
                ariaLabel={`Component ${i + 1} condition`}
                className={roadFieldClass}
                value={c.condition}
                onValueChange={(value) => update(c.id, { condition: value as SectionComponent['condition'] })}
              >
                <option value="always">Always</option>
                <option value="cut">Cut side</option>
                <option value="fill">Fill side</option>
              </RoadSelect>
            </Field>
            <NumberField
              label={`Component ${i + 1} width (m)`}
              value={c.widthM}
              min={0.01}
              max={50}
              onChange={(widthM) => update(c.id, { widthM })}
            />
            {c.kind === 'key' ? (
              <>
                <NumberField
                  label={`Key ${i + 1} depth (m)`}
                  value={c.depthM ?? 1}
                  min={0}
                  max={20}
                  hint="How far the key is dug below the ground, after any stripping. The width above is the key's width, measured outward from its edge offset."
                  onChange={(depthM) => update(c.id, { depthM })}
                />
                <NumberField
                  label={`Key ${i + 1} edge offset (m)`}
                  value={c.offsetM ?? 0}
                  min={0}
                  max={50}
                  hint="Distance from the formation edge to the key's inner edge. The key must end inside the slope's footprint; where the fill is narrower than the key, the section is left incomplete and says so."
                  onChange={(offsetM) => update(c.id, { offsetM })}
                />
                {/* The rest of a rock fill is this template's own lane width and fill batter. */}
                <NumberField
                  label={`Key ${i + 1} subgrade width, ${c.side} (m)`}
                  value={template[`${c.side}Width`]}
                  min={0.1}
                  max={50}
                  hint="This template's lane width on the key's side."
                  onChange={(width) => onChange({ ...template, [`${c.side}Width`]: width })}
                />
                <NumberField
                  label={`Key ${i + 1} rock slope, ${c.side} (H:V)`}
                  value={template[`${c.side}FillSlope`] ?? template.fillSlope}
                  min={0.1}
                  max={10}
                  hint="This template's fill batter on the key's side. A rock-fill thickness is not an input: the embankment is one fill volume, not a rock zone over ordinary fill."
                  onChange={(slope) => onChange({ ...template, [`${c.side}FillSlope`]: slope })}
                />
              </>
            ) : (
              <NumberField
                label={`Component ${i + 1} rise (m)`}
                value={c.riseM}
                min={-30}
                max={30}
                onChange={(riseM) => update(c.id, { riseM })}
              />
            )}
          </div>
          {material(c.materialId, (materialId) => update(c.id, { materialId }), `Component ${i + 1} fill material`)}
          {c.kind !== 'key' && (
            <details className={insetBox()}>
              <summary className="cursor-pointer text-xs">Reference feature or surface</summary>
              <p className="my-1 text-2xs text-muted-foreground">
                A feature anchors the outward endpoint where it crosses this section. A surface supplies its elevation;
                offsets remain editable. An unresolved reference makes the section incomplete.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Field label={`Component ${i + 1} reference feature`}>
                  <RoadSelect
                    ariaLabel={`Component ${i + 1} reference feature`}
                    className={roadFieldClass}
                    value={c.referenceFeatureId ?? ''}
                    onValueChange={(value) => update(c.id, { referenceFeatureId: value || undefined })}
                  >
                    <option value="">Relative dimensions</option>
                    {c.referenceFeatureId && !features.some((f) => f.id === c.referenceFeatureId) && (
                      <option value={c.referenceFeatureId}>{c.referenceFeatureId}</option>
                    )}
                    {features.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </RoadSelect>
                </Field>
                <Field label={`Component ${i + 1} reference surface`}>
                  <RoadSelect
                    ariaLabel={`Component ${i + 1} reference surface`}
                    className={roadFieldClass}
                    value={c.referenceSurfaceId ?? ''}
                    onValueChange={(value) => update(c.id, { referenceSurfaceId: value || undefined })}
                  >
                    <option value="">Relative rise / feature level</option>
                    <option value="original-ground">Original ground</option>
                    <option value="prepared-ground">Prepared ground</option>
                    {c.referenceSurfaceId &&
                      !['original-ground', 'prepared-ground', ...surfaces.map((s) => s.id)].includes(
                        c.referenceSurfaceId,
                      ) && <option value={c.referenceSurfaceId}>{c.referenceSurfaceId}</option>}
                    {surfaces.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </RoadSelect>
                </Field>
                <NumberField
                  label={`Component ${i + 1} reference offset (m)`}
                  value={c.referenceOffsetM ?? 0}
                  min={-100}
                  max={100}
                  onChange={(referenceOffsetM) => update(c.id, { referenceOffsetM })}
                />
                <NumberField
                  label={`Component ${i + 1} reference level offset (m)`}
                  value={c.referenceElevationM ?? 0}
                  min={-100}
                  max={100}
                  onChange={(referenceElevationM) => update(c.id, { referenceElevationM })}
                />
              </div>
            </details>
          )}
          <Field label={`Component ${i + 1} point code`}>
            <input
              className={roadFieldClass}
              value={c.code ?? ''}
              maxLength={100}
              onChange={(e) => update(c.id, { code: e.target.value || undefined })}
            />
          </Field>
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={!i}
              onClick={() => {
                const next = [...components]
                ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
                onChange({ ...template, components: next })
              }}
            >
              Move up
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange({ ...template, components: components.filter((v) => v.id !== c.id) })}
            >
              Remove component {i + 1}
            </Button>
          </div>
        </div>
      ))}
      <ComponentLibrary
        components={components}
        onInsert={(component) =>
          onChange({ ...template, components: [...components, { ...component, id: crypto.randomUUID() }] })
        }
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">Surface course stack</p>
        <InfoTip label="About surface courses">
          An explicit stack replaces the legacy surface-depth quantity. Courses lie above the designed subgrade;
          material demand is kept per layer.
        </InfoTip>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={layers.length >= 20 || stackRoomM <= 0}
          onClick={() =>
            onChange({
              ...template,
              layers: [
                ...layers,
                {
                  id: crypto.randomUUID(),
                  name: `Course ${layers.length + 1}`,
                  side: 'both',
                  depthM: Math.min(0.15, stackRoomM),
                },
              ],
            })
          }
        >
          Add surface course
        </Button>
        {template.layers !== undefined && (
          <Button size="sm" variant="ghost" onClick={() => onChange({ ...template, layers: undefined })}>
            Use legacy surface depth
          </Button>
        )}
      </div>
      {layers.map((l, i) => (
        <div key={l.id} className={cn(insetBox(), 'space-y-2')}>
          <Field label={`Course ${i + 1} name`}>
            <input
              className={roadFieldClass}
              value={l.name}
              maxLength={200}
              onChange={(e) => updateLayer(l.id, { name: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={`Course ${i + 1} side`}>
              <RoadSelect
                ariaLabel={`Course ${i + 1} side`}
                className={roadFieldClass}
                value={l.side}
                onValueChange={(value) => updateLayer(l.id, { side: value as SectionLayer['side'] })}
              >
                <option value="both">Both sides</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </RoadSelect>
            </Field>
            <NumberField
              label={`Course ${i + 1} depth (m)`}
              value={l.depthM}
              min={0}
              max={2}
              onChange={(depthM) => updateLayer(l.id, { depthM })}
            />
          </div>
          {material(l.materialId, (materialId) => updateLayer(l.id, { materialId }), `Course ${i + 1} material`)}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange({ ...template, layers: layers.filter((v) => v.id !== l.id) })}
          >
            Remove course {i + 1}
          </Button>
        </div>
      ))}
    </div>
  )
}
