import { NativeSelect } from '@/components/ui/form-field'
import { Button } from '@/components/ui/button'
import { Field, NumberField, roadFieldClass } from './Controls'
import type { ContextFeature, GroundMaterial, RoadTemplate, SectionComponent, SectionLayer } from './types'
import { ComponentLibrary } from './ComponentLibrary'

/** Ordered physical section additions and separate material courses; saved with the template. */
export function SectionAssemblyEditor({
  template,
  onChange,
  materials = [],
  features = [],
  surfaces = [],
}: {
  template: RoadTemplate
  onChange: (template: RoadTemplate) => void
  materials?: GroundMaterial[]
  features?: ContextFeature[]
  surfaces?: { id: string; name: string }[]
}) {
  const components = template.components ?? [],
    layers = template.layers ?? []
  const update = (id: string, patch: Partial<SectionComponent>) =>
    onChange({ ...template, components: components.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
  const updateLayer = (id: string, patch: Partial<SectionLayer>) =>
    onChange({ ...template, layers: layers.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
  const material = (value: string | undefined, change: (id: string | undefined) => void, label: string) => (
    <Field label={label}>
      <NativeSelect
        className={roadFieldClass}
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => change(e.target.value || undefined)}
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
      </NativeSelect>
    </Field>
  )
  return (
    <div className="space-y-3 border-t pt-3" data-testid="road-section-assembly">
      <p className="text-xs font-semibold">Section assembly</p>
      <p className="text-[11px] text-muted-foreground">
        Components follow the formation/ditch in list order. Keys excavate below ground and replace it with fill. Wall
        geometry does not assess structural capacity.
      </p>
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
        <Button
          size="sm"
          variant="outline"
          disabled={components.length > 38}
          onClick={() =>
            onChange({
              ...template,
              ditchWidth: 0,
              leftDitchWidth: 0,
              rightDitchWidth: 0,
              fillSlope: 0.75,
              components: [
                ...components,
                ...(['left', 'right'] as const).map((side) => ({
                  id: crypto.randomUUID(),
                  name: `${side} keyed rock fill`,
                  side,
                  kind: 'key' as const,
                  condition: 'fill' as const,
                  widthM: 2,
                  riseM: 0,
                  depthM: 1,
                  offsetM: 0,
                })),
              ],
            })
          }
        >
          Keyed rock-fill starter
        </Button>
      </div>
      {components.map((c, i) => (
        <div key={c.id} className="space-y-2 rounded border p-2">
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
              <NativeSelect
                className={roadFieldClass}
                value={c.kind}
                onChange={(e) =>
                  update(c.id, {
                    kind: e.target.value as SectionComponent['kind'],
                    ...(e.target.value === 'key'
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
              </NativeSelect>
            </Field>
            <Field label={`Component ${i + 1} side`}>
              <NativeSelect
                className={roadFieldClass}
                value={c.side}
                onChange={(e) => update(c.id, { side: e.target.value as SectionComponent['side'] })}
              >
                <option value="left">Left</option>
                <option value="right">Right</option>
              </NativeSelect>
            </Field>
            <Field label={`Component ${i + 1} condition`}>
              <NativeSelect
                className={roadFieldClass}
                value={c.condition}
                onChange={(e) => update(c.id, { condition: e.target.value as SectionComponent['condition'] })}
              >
                <option value="always">Always</option>
                <option value="cut">Cut side</option>
                <option value="fill">Fill side</option>
              </NativeSelect>
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
                  onChange={(depthM) => update(c.id, { depthM })}
                />
                <NumberField
                  label={`Key ${i + 1} edge offset (m)`}
                  value={c.offsetM ?? 0}
                  min={0}
                  max={50}
                  onChange={(offsetM) => update(c.id, { offsetM })}
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
            <details className="rounded border p-2">
              <summary className="cursor-pointer text-xs">Reference feature or surface</summary>
              <p className="my-1 text-[11px] text-muted-foreground">
                A feature anchors the outward endpoint where it crosses this section. A surface supplies its elevation;
                offsets remain editable. An unresolved reference makes the section incomplete.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Field label={`Component ${i + 1} reference feature`}>
                  <NativeSelect
                    className={roadFieldClass}
                    value={c.referenceFeatureId ?? ''}
                    onChange={(e) => update(c.id, { referenceFeatureId: e.target.value || undefined })}
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
                  </NativeSelect>
                </Field>
                <Field label={`Component ${i + 1} reference surface`}>
                  <NativeSelect
                    className={roadFieldClass}
                    value={c.referenceSurfaceId ?? ''}
                    onChange={(e) => update(c.id, { referenceSurfaceId: e.target.value || undefined })}
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
                  </NativeSelect>
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
      <p className="text-xs font-semibold">Surface course stack</p>
      <p className="text-[11px] text-muted-foreground">
        An explicit stack replaces the legacy surface-depth quantity. Courses lie above the designed subgrade; material
        demand is kept per layer.
      </p>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={layers.length >= 20}
          onClick={() =>
            onChange({
              ...template,
              layers: [
                ...layers,
                { id: crypto.randomUUID(), name: `Course ${layers.length + 1}`, side: 'both', depthM: 0.15 },
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
        <div key={l.id} className="space-y-2 rounded border p-2">
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
              <NativeSelect
                className={roadFieldClass}
                value={l.side}
                onChange={(e) => updateLayer(l.id, { side: e.target.value as SectionLayer['side'] })}
              >
                <option value="both">Both sides</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </NativeSelect>
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
