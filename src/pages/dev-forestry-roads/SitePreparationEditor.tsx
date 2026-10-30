import { Button } from '@/components/ui/button'
import { Field, NumberField, roadFieldClass } from './Controls'
import type { AlignmentEngineering, SitePreparationRange } from './types'

export function SitePreparationEditor({
  design,
  length,
  station,
  onChange,
}: {
  design: AlignmentEngineering
  length: number
  station: number
  onChange: (design: AlignmentEngineering) => void
}) {
  const ranges = design.sitePreparation ?? []
  const update = (id: string, patch: Partial<SitePreparationRange>) =>
    onChange({ ...design, sitePreparation: ranges.map((r) => (r.id === id ? { ...r, ...patch } : r)) })
  return (
    <div className="space-y-2 p-3" data-testid="road-site-preparation">
      <p className="text-xs font-semibold">Stripping before construction</p>
      <p className="text-[11px] text-muted-foreground">
        Remove ground beneath cut and fill before building the section. Inside offsets leave an unstripped centre;
        outside offsets extend past the final catch line. Removed material is never reused.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={ranges.length >= 100}
        onClick={() => {
          const material = design.materials.find((m) => m.purpose === 'stripping'),
            materialId = material?.id ?? crypto.randomUUID()
          const start = Math.min(Math.max(0, station), Math.max(0, length - 1))
          onChange({
            ...design,
            materials: material
              ? design.materials
              : [
                  ...design.materials,
                  {
                    id: materialId,
                    name: 'Stripped overburden',
                    color: '#9a663e',
                    cutRate: 0,
                    reusableFraction: 0,
                    compactionFactor: 1,
                    purpose: 'stripping',
                  },
                ],
            sitePreparation: [
              ...ranges,
              {
                id: crypto.randomUUID(),
                start,
                end: Math.max(start + 1, length),
                materialId,
                depthM: 0.2,
                leftInsideM: 0,
                rightInsideM: 0,
                leftOutsideM: 0.3,
                rightOutsideM: 0.3,
              },
            ],
          })
        }}
      >
        Add stripping range
      </Button>
      {ranges.map((r, i) => (
        <div key={r.id} className="space-y-2 rounded border p-2">
          <Field label={`Stripping ${i + 1} material`}>
            <select
              className={roadFieldClass}
              value={r.materialId}
              onChange={(e) => update(r.id, { materialId: e.target.value })}
            >
              {design.materials
                .filter((m) => m.purpose === 'stripping')
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['start', 'Start station', 100000],
                ['end', 'End station', 100000],
                ['depthM', 'Removal depth', 20],
                ['leftInsideM', 'Left inside offset', 100],
                ['rightInsideM', 'Right inside offset', 100],
                ['leftOutsideM', 'Left outside offset', 50],
                ['rightOutsideM', 'Right outside offset', 50],
              ] as const
            ).map(([key, label, max]) => (
              <NumberField
                key={key}
                label={`Stripping ${i + 1} ${label} (m)`}
                value={r[key]}
                min={0}
                max={max}
                onChange={(value) => update(r.id, { [key]: value })}
              />
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange({ ...design, sitePreparation: ranges.filter((v) => v.id !== r.id) })}
          >
            Remove stripping range {i + 1}
          </Button>
        </div>
      ))}
    </div>
  )
}
