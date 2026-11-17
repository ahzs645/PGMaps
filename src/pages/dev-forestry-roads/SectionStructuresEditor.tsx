import { InfoTip } from '@/components/ui/info-tip'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { Button } from '@/components/ui/button'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { Field, NumberField, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import {
  barriersAt,
  benchesAt,
  DEFAULT_BENCH_COUNT,
  MAX_SECTION_BARRIERS,
  MAX_SECTION_WALLS,
  STRUCTURE_LIMITS as L,
  subCutAt,
  wallsAt,
  type BenchedSlope,
  type SectionBarrier,
  type SectionWall,
  type SideBenches,
  type StructureQuantity,
  type SubCut,
} from './sectionStructures'
import type { GroundMaterial, RoadTemplate } from './types'

type Side = 'left' | 'right'
const SIDES: Side[] = ['left', 'right']
const Side = (side: Side) => (side === 'left' ? 'Left' : 'Right')
const BARRIER_KINDS: { value: SectionBarrier['kind']; label: string }[] = [
  { value: 'guard-rail', label: 'Guard rail' },
  { value: 'concrete', label: 'Concrete barrier' },
  { value: 'railing', label: 'Railing' },
]

/** One line for a folded section: the structures a template holds. */
export function structuresSummary(t: RoadTemplate): string {
  const benched = SIDES.flatMap((side) =>
    (['cut', 'fill'] as const).filter((kind) => benchesAt(t, side, kind)).map((kind) => `${side} ${kind}`),
  )
  const parts = [
    benched.length ? `${benched.length} benched` : null,
    t.walls?.length ? `${t.walls.length} wall${t.walls.length === 1 ? '' : 's'}` : null,
    t.barriers?.length ? `${t.barriers.length} barrier${t.barriers.length === 1 ? '' : 's'}` : null,
    SIDES.some((side) => subCutAt(t, side)) ? 'sub-cut' : null,
  ].filter(Boolean)
  return parts.join(' · ') || 'None'
}

const KIND_NAMES: Record<StructureQuantity['kind'], string> = {
  'cut-wall': 'Cut wall',
  'fill-wall': 'Fill wall',
  barrier: 'Barrier',
  'sub-cut': 'Sub-cut',
  'wall-backfill': 'Wall backfill',
}

/** The calculated structures along the road: length each stands on and its volume. */
export function StructureQuantities({ quantities }: { quantities: readonly StructureQuantity[] | undefined }) {
  if (!quantities?.length) return null
  return (
    <EngineeringTable rowHeaders compact data-testid="road-structure-quantities" aria-label="Structure quantities">
      <thead>
        <tr>
          <ColumnHeader label="Structure" className="text-left" />
          <ColumnHeader label="Length" unit="m" />
          <ColumnHeader label="Volume" unit="m³" />
        </tr>
      </thead>
      <tbody>
        {quantities.map((q) => (
          <tr key={`${q.side}-${q.id}`}>
            <th scope="row">
              {q.name} · {KIND_NAMES[q.kind].toLowerCase()} · {q.side}
            </th>
            <td>{q.lengthM.toFixed(1)}</td>
            <td>{q.kind === 'barrier' ? '—' : q.volumeM3.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </EngineeringTable>
  )
}

/**
 * A side's own block in place of a shared one: the other side keeps the shared value as its own,
 * so editing one side never changes the other.
 */
function withSideBlock<K extends 'Benches' | 'SubCut'>(
  t: RoadTemplate,
  key: K,
  side: Side,
  value: K extends 'Benches' ? SideBenches | undefined : SubCut | undefined,
): RoadTemplate {
  const shared = key === 'Benches' ? 'benches' : 'subCut'
  const next = { ...t } as Record<string, unknown>
  const other = side === 'left' ? 'right' : 'left'
  if (next[shared] !== undefined) {
    next[`${other}${key}`] ??= next[shared]
    delete next[shared]
  }
  if (value === undefined) delete next[`${side}${key}`]
  else next[`${side}${key}`] = value
  return next as unknown as RoadTemplate
}

/**
 * Benched batters, walls, barriers and sub-cuts of one template (`sectionStructures.ts`). Every
 * change is one template edit; nothing here writes until a field changes.
 */
export function SectionStructuresEditor({
  template,
  onChange,
  materials = [],
}: {
  template: RoadTemplate
  onChange: (template: RoadTemplate) => void
  materials?: GroundMaterial[]
}) {
  const setBench = (side: Side, kind: 'cut' | 'fill', value: BenchedSlope | undefined) => {
    const current: SideBenches = { ...(template[`${side}Benches`] ?? template.benches ?? {}) }
    if (value) current[kind] = value
    else delete current[kind]
    onChange(withSideBlock(template, 'Benches', side, Object.keys(current).length ? current : undefined))
  }
  const walls = template.walls ?? [],
    barriers = template.barriers ?? []
  const updateWall = (id: string, patch: Partial<SectionWall>) =>
    onChange({
      ...template,
      walls: walls.map((w) => {
        if (w.id !== id) return w
        const next = { ...w, ...patch }
        for (const key of Object.keys(next) as (keyof SectionWall)[]) if (next[key] === undefined) delete next[key]
        return next
      }),
    })
  const updateBarrier = (id: string, patch: Partial<SectionBarrier>) =>
    onChange({ ...template, barriers: barriers.map((b) => (b.id === id ? { ...b, ...patch } : b)) })
  const removeWall = (id: string) => {
    const next: RoadTemplate = { ...template, walls: walls.filter((w) => w.id !== id) }
    if (!next.walls?.length) delete next.walls
    onChange(next)
  }
  const removeBarrier = (id: string) => {
    const next: RoadTemplate = { ...template, barriers: barriers.filter((b) => b.id !== id) }
    if (!next.barriers?.length) delete next.barriers
    onChange(next)
  }
  const materialSelect = (value: string | undefined, change: (id: string | undefined) => void, label: string) => (
    <Field label={label}>
      <RoadSelect
        className={roadFieldClass}
        ariaLabel={label}
        value={value ?? ''}
        onValueChange={(v) => change(v || undefined)}
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
    <div className="space-y-3" data-testid="road-section-structures">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold">Benched batters</p>
          <InfoTip label="About benched batters">
            The batter rises (cut) or falls (fill) the face height at its face slope, then a bench of its width runs out
            at its fall, up to the bench count; after the last bench the side&apos;s batter closes to ground. Ground met
            on a face or a bench is the daylight. A blank face slope is the side&apos;s batter; a blank count is{' '}
            {DEFAULT_BENCH_COUNT}.
          </InfoTip>
        </div>
        {SIDES.flatMap((side) =>
          (['cut', 'fill'] as const).map((kind) => {
            const bench = benchesAt(template, side, kind)
            const name = `${Side(side)} ${kind} benches`
            if (!bench)
              return (
                <Button
                  key={`${side}-${kind}`}
                  size="sm"
                  variant="outline"
                  className="mr-1"
                  onClick={() => setBench(side, kind, { heightM: 3, widthM: 1.5 })}
                >
                  Bench the {side} {kind} batter
                </Button>
              )
            const set = (patch: Partial<BenchedSlope>) => {
              const next = { ...bench, ...patch }
              for (const key of Object.keys(next) as (keyof BenchedSlope)[])
                if (next[key] === undefined) delete next[key]
              setBench(side, kind, next)
            }
            return (
              <div
                key={`${side}-${kind}`}
                className={cn(insetBox(), 'space-y-2')}
                data-testid={`road-benches-${side}-${kind}`}
              >
                <p className="text-xs font-medium">{name}</p>
                <div className="grid grid-cols-2 items-end gap-2">
                  <NumberField
                    label="Face height (m)"
                    value={bench.heightM}
                    min={L.benchHeightM[0]}
                    max={L.benchHeightM[1]}
                    onChange={(heightM) => set({ heightM })}
                  />
                  <NumberField
                    label="Bench width (m)"
                    value={bench.widthM}
                    min={L.benchWidthM[0]}
                    max={L.benchWidthM[1]}
                    onChange={(widthM) => set({ widthM })}
                  />
                  <OptionalNumberField
                    label="Face slope (H:V)"
                    value={bench.faceSlope ?? null}
                    min={L.benchFaceSlope[0]}
                    max={L.benchFaceSlope[1]}
                    placeholder="side batter"
                    onChange={(v) => set({ faceSlope: v ?? undefined })}
                  />
                  <OptionalNumberField
                    label="Bench fall (%)"
                    value={bench.benchFallPercent ?? null}
                    min={L.benchFallPercent[0]}
                    max={L.benchFallPercent[1]}
                    placeholder="level"
                    onChange={(v) => set({ benchFallPercent: v ?? undefined })}
                  />
                  <OptionalNumberField
                    label="Benches"
                    value={bench.count ?? null}
                    min={L.benchCount[0]}
                    max={L.benchCount[1]}
                    step={1}
                    placeholder={String(DEFAULT_BENCH_COUNT)}
                    onChange={(v) => set({ count: v === null ? undefined : Math.round(v) })}
                  />
                </div>
                <Button size="sm" variant="ghost" onClick={() => setBench(side, kind, undefined)}>
                  Remove {name.toLowerCase()}
                </Button>
              </div>
            )
          }),
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold">Walls</p>
          <InfoTip label="About walls">
            A cut wall stands where a cut side leaves the ditch or formation: the excavation runs under its base and up
            its back, a lower cut stops it at the ground, and the batter continues from its top. A fill wall holds a
            fill side: its face drops from the shoulder to the ground (a deeper fill continues below it at the fill
            batter), its body comes out of the fill and its embedded base is dug. The body is a structure volume; no
            structural check is made. A fill wall&apos;s top can sit below the formation edge under the road&apos;s
            fill. A cut wall&apos;s backfill is dug from its heel, level for the offset and then up the base slope, and
            refilled to the cut or to a top slope from the wall&apos;s top; the dig is cut, the refill fill.
          </InfoTip>
        </div>
        <div className="flex flex-wrap gap-1">
          {(['cut', 'fill'] as const).map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant="outline"
              disabled={walls.length >= MAX_SECTION_WALLS}
              onClick={() =>
                onChange({
                  ...template,
                  walls: [
                    ...walls,
                    {
                      id: crypto.randomUUID(),
                      name: `${kind === 'cut' ? 'Cut' : 'Fill'} wall ${walls.length + 1}`,
                      side: 'right',
                      kind,
                      heightM: kind === 'cut' ? 3 : 6,
                      thicknessM: 0.5,
                    },
                  ],
                })
              }
            >
              Add {kind} wall
            </Button>
          ))}
        </div>
        {walls.map((w, i) => (
          <div key={w.id} className={cn(insetBox(), 'space-y-2')} data-testid="road-section-wall">
            <Field label={`Wall ${i + 1} name`}>
              <input
                className={roadFieldClass}
                value={w.name}
                maxLength={200}
                onChange={(e) => updateWall(w.id, { name: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 items-end gap-2">
              <Field label={`Wall ${i + 1} side`}>
                <RoadSelect
                  className={roadFieldClass}
                  ariaLabel={`Wall ${i + 1} side`}
                  value={w.side}
                  options={SIDES.map((s) => ({ value: s, label: Side(s) }))}
                  onValueChange={(v) => updateWall(w.id, { side: v as Side })}
                />
              </Field>
              <Field label={`Wall ${i + 1} holds`}>
                <RoadSelect
                  className={roadFieldClass}
                  ariaLabel={`Wall ${i + 1} holds`}
                  value={w.kind}
                  options={[
                    { value: 'cut', label: 'A cut' },
                    { value: 'fill', label: 'A fill' },
                  ]}
                  onValueChange={(v) =>
                    // A cut wall has no embedded base.
                    updateWall(w.id, v === 'fill' ? { kind: 'fill' } : { kind: 'cut', embedM: undefined })
                  }
                />
              </Field>
              <NumberField
                label={w.kind === 'cut' ? 'Height at most (m)' : 'Face height at most (m)'}
                value={w.heightM}
                min={L.wallHeightM[0]}
                max={L.wallHeightM[1]}
                onChange={(heightM) => updateWall(w.id, { heightM })}
              />
              <NumberField
                label="Thickness (m)"
                value={w.thicknessM}
                min={L.wallThicknessM[0]}
                max={L.wallThicknessM[1]}
                onChange={(thicknessM) => updateWall(w.id, { thicknessM })}
              />
              <OptionalNumberField
                label="Face batter (H:V)"
                value={w.faceSlope ?? null}
                min={L.wallFaceSlope[0]}
                max={L.wallFaceSlope[1]}
                placeholder="vertical"
                onChange={(v) => updateWall(w.id, { faceSlope: v ?? undefined })}
              />
              <OptionalNumberField
                label="Setback (m)"
                value={w.setbackM ?? null}
                min={L.wallSetbackM[0]}
                max={L.wallSetbackM[1]}
                placeholder="0"
                onChange={(v) => updateWall(w.id, { setbackM: v ?? undefined })}
              />
              {w.kind === 'fill' && (
                <OptionalNumberField
                  label="Base below ground (m)"
                  value={w.embedM ?? null}
                  min={L.wallEmbedM[0]}
                  max={L.wallEmbedM[1]}
                  placeholder="0"
                  onChange={(v) => updateWall(w.id, { embedM: v ?? undefined })}
                />
              )}
              {w.kind === 'fill' && (
                <OptionalNumberField
                  label="Top below formation (m)"
                  value={w.coverHeightM ?? null}
                  min={L.wallCoverHeightM[0]}
                  max={L.wallCoverHeightM[1]}
                  placeholder="0"
                  onChange={(v) => updateWall(w.id, { coverHeightM: v ?? undefined })}
                />
              )}
              {w.kind === 'cut' && (
                <Field label={`Wall ${i + 1} backfill`}>
                  <RoadSelect
                    className={roadFieldClass}
                    ariaLabel={`Wall ${i + 1} backfill`}
                    value={!w.backfill ? 'none' : w.backfill.toGround ? 'ground' : 'slope'}
                    options={[
                      { value: 'none', label: 'None' },
                      { value: 'ground', label: 'Refilled to the cut' },
                      { value: 'slope', label: 'Refilled to a top slope' },
                    ]}
                    onValueChange={(v) =>
                      updateWall(w.id, {
                        backfill:
                          v === 'none'
                            ? undefined
                            : {
                                offsetM: w.backfill?.offsetM ?? Math.min(L.wallBackfillOffsetM[1], w.heightM * 0.7),
                                baseSlope: w.backfill?.baseSlope ?? 1,
                                toGround: v === 'ground',
                                ...(v === 'slope' ? { topSlopePercent: w.backfill?.topSlopePercent ?? 0 } : {}),
                              },
                      })
                    }
                  />
                </Field>
              )}
              {w.kind === 'cut' && w.backfill && (
                <>
                  <NumberField
                    label="Backfill offset from heel (m)"
                    value={w.backfill.offsetM}
                    min={L.wallBackfillOffsetM[0]}
                    max={L.wallBackfillOffsetM[1]}
                    onChange={(offsetM) => updateWall(w.id, { backfill: { ...w.backfill!, offsetM } })}
                  />
                  <NumberField
                    label="Backfill base slope (H:V)"
                    value={w.backfill.baseSlope}
                    min={L.wallBackfillBaseSlope[0]}
                    max={L.wallBackfillBaseSlope[1]}
                    onChange={(baseSlope) => updateWall(w.id, { backfill: { ...w.backfill!, baseSlope } })}
                  />
                  {!w.backfill.toGround && (
                    <NumberField
                      label="Backfill top slope (%)"
                      value={w.backfill.topSlopePercent ?? 0}
                      min={L.wallBackfillTopSlopePercent[0]}
                      max={L.wallBackfillTopSlopePercent[1]}
                      onChange={(topSlopePercent) =>
                        updateWall(w.id, { backfill: { ...w.backfill!, topSlopePercent } })
                      }
                    />
                  )}
                </>
              )}
            </div>
            {materialSelect(w.materialId, (materialId) => updateWall(w.id, { materialId }), `Wall ${i + 1} material`)}
            <Button size="sm" variant="ghost" onClick={() => removeWall(w.id)}>
              Remove wall {i + 1}
            </Button>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold">Barriers</p>
          <InfoTip label="About barriers">
            A barrier stands on the running surface, its inside face the offset from the centreline. It is drawn on the
            section and measured by length; it moves no earth.
          </InfoTip>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={barriers.length >= MAX_SECTION_BARRIERS}
          onClick={() =>
            onChange({
              ...template,
              barriers: [
                ...barriers,
                {
                  id: crypto.randomUUID(),
                  name: `Barrier ${barriers.length + 1}`,
                  side: 'right',
                  kind: 'guard-rail',
                  offsetM: Math.max(0, template.rightWidth - 0.5),
                  widthM: 0.3,
                  heightM: 0.8,
                },
              ],
            })
          }
        >
          Add barrier
        </Button>
        {barriers.map((b, i) => (
          <div key={b.id} className={cn(insetBox(), 'space-y-2')} data-testid="road-section-barrier">
            <Field label={`Barrier ${i + 1} name`}>
              <input
                className={roadFieldClass}
                value={b.name}
                maxLength={200}
                onChange={(e) => updateBarrier(b.id, { name: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 items-end gap-2">
              <Field label={`Barrier ${i + 1} side`}>
                <RoadSelect
                  className={roadFieldClass}
                  ariaLabel={`Barrier ${i + 1} side`}
                  value={b.side}
                  options={SIDES.map((s) => ({ value: s, label: Side(s) }))}
                  onValueChange={(v) => updateBarrier(b.id, { side: v as Side })}
                />
              </Field>
              <Field label={`Barrier ${i + 1} kind`}>
                <RoadSelect
                  className={roadFieldClass}
                  ariaLabel={`Barrier ${i + 1} kind`}
                  value={b.kind}
                  options={BARRIER_KINDS}
                  onValueChange={(v) => updateBarrier(b.id, { kind: v as SectionBarrier['kind'] })}
                />
              </Field>
              <NumberField
                label="Offset from centreline (m)"
                value={b.offsetM}
                min={L.barrierOffsetM[0]}
                max={L.barrierOffsetM[1]}
                onChange={(offsetM) => updateBarrier(b.id, { offsetM })}
              />
              <NumberField
                label="Width (m)"
                value={b.widthM}
                min={L.barrierWidthM[0]}
                max={L.barrierWidthM[1]}
                onChange={(widthM) => updateBarrier(b.id, { widthM })}
              />
              <NumberField
                label="Height (m)"
                value={b.heightM}
                min={L.barrierHeightM[0]}
                max={L.barrierHeightM[1]}
                onChange={(heightM) => updateBarrier(b.id, { heightM })}
              />
            </div>
            <Button size="sm" variant="ghost" onClick={() => removeBarrier(b.id)}>
              Remove barrier {i + 1}
            </Button>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold">Sub-cut</p>
          <InfoTip label="About sub-cuts">
            Ground dug out below the subgrade (or below the lower of subgrade and ground) from the centreline to its
            width, up its outside slope, and refilled. Its excavation adds to the cut and its backfill to the fill; with
            a material named, the backfill is that material&apos;s demand. With an inside slope, a bottom slope or a
            bottom that does not follow the crossfall, the bottom is a straight line from its depth below the
            centreline, reached down the inside slope.
          </InfoTip>
        </div>
        {SIDES.map((side) => {
          const sub = subCutAt(template, side)
          if (!sub)
            return (
              <Button
                key={side}
                size="sm"
                variant="outline"
                className="mr-1"
                onClick={() =>
                  onChange(
                    withSideBlock(template, 'SubCut', side, {
                      id: `sub-cut-${side}`,
                      name: `${Side(side)} sub-cut`,
                      reference: 'subgrade',
                      depthM: 0.5,
                      widthM: template[`${side}Width`],
                    }),
                  )
                }
              >
                Sub-cut the {side} side
              </Button>
            )
          const set = (patch: Partial<SubCut>) => {
            const next = { ...sub, ...patch }
            for (const key of Object.keys(next) as (keyof SubCut)[]) if (next[key] === undefined) delete next[key]
            onChange(withSideBlock(template, 'SubCut', side, next))
          }
          return (
            <div key={side} className={cn(insetBox(), 'space-y-2')} data-testid={`road-subcut-${side}`}>
              <p className="text-xs font-medium">{Side(side)} sub-cut</p>
              <div className="grid grid-cols-2 items-end gap-2">
                <Field label={`${Side(side)} sub-cut below`}>
                  <RoadSelect
                    className={roadFieldClass}
                    ariaLabel={`${Side(side)} sub-cut below`}
                    value={sub.reference}
                    options={[
                      { value: 'subgrade', label: 'Subgrade' },
                      { value: 'merged', label: 'Lower of subgrade and ground' },
                    ]}
                    onValueChange={(v) => set({ reference: v as SubCut['reference'] })}
                  />
                </Field>
                <NumberField
                  label="Depth (m)"
                  value={sub.depthM}
                  min={L.subCutDepthM[0]}
                  max={L.subCutDepthM[1]}
                  onChange={(depthM) => set({ depthM })}
                />
                <NumberField
                  label="Width from centreline (m)"
                  value={sub.widthM}
                  min={L.subCutWidthM[0]}
                  max={L.subCutWidthM[1]}
                  onChange={(widthM) => set({ widthM })}
                />
                <OptionalNumberField
                  label="Outside slope (H:V)"
                  value={sub.outsideSlope ?? null}
                  min={L.subCutOutsideSlope[0]}
                  max={L.subCutOutsideSlope[1]}
                  placeholder="vertical"
                  onChange={(v) => set({ outsideSlope: v ?? undefined })}
                />
                <OptionalNumberField
                  label="Inside slope (H:V)"
                  value={sub.insideSlope ?? null}
                  min={L.subCutInsideSlope[0]}
                  max={L.subCutInsideSlope[1]}
                  placeholder="vertical"
                  onChange={(v) => set({ insideSlope: v ?? undefined })}
                />
                <OptionalNumberField
                  label="Bottom slope (%)"
                  value={sub.bottomSlopePercent ?? null}
                  min={L.subCutBottomSlopePercent[0]}
                  max={L.subCutBottomSlopePercent[1]}
                  placeholder="0"
                  onChange={(v) => set({ bottomSlopePercent: v ?? undefined })}
                />
                <Field label={`${Side(side)} sub-cut bottom`}>
                  <RoadSelect
                    className={roadFieldClass}
                    ariaLabel={`${Side(side)} sub-cut bottom`}
                    value={sub.followsCrossfall === false ? 'level' : 'crossfall'}
                    options={[
                      { value: 'crossfall', label: 'With crossfall' },
                      { value: 'level', label: 'Own slope' },
                    ]}
                    onValueChange={(v) => set({ followsCrossfall: v === 'level' ? false : undefined })}
                  />
                </Field>
              </div>
              {materialSelect(sub.materialId, (materialId) => set({ materialId }), `${Side(side)} sub-cut backfill`)}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onChange(withSideBlock(template, 'SubCut', side, undefined))}
              >
                Remove the {side} sub-cut
              </Button>
            </div>
          )
        })}
      </div>
      {/* Walls and barriers listed by side, so a long list still reads at a glance. */}
      {(walls.length > 0 || barriers.length > 0) && (
        <p className="text-2xs text-muted-foreground" data-testid="road-structures-by-side">
          {SIDES.map(
            (side) =>
              `${Side(side)}: ${[...wallsAt(template, side).map((w) => w.name), ...barriersAt(template, side).map((b) => b.name)].join(', ') || 'none'}`,
          ).join(' · ')}
        </p>
      )}
    </div>
  )
}
