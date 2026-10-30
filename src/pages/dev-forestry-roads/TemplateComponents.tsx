import { useState } from 'react'
import { NumberField } from './Controls'
import { sideValue } from './templates'
import { SectionAssemblyEditor } from './SectionAssemblyEditor'
import type { ContextFeature, GroundMaterial, RoadTemplate } from './types'

type Side = 'left' | 'right'
type Kind = 'lane' | 'ditch' | 'slope'
type Field = {
  key: keyof RoadTemplate
  base?: keyof RoadTemplate
  label: string
  min: number
  max: number
  step?: number
}

/**
 * The template as RoadEng shows it: per side, an ordered chain of components (lane, conditional
 * ditch, cut/fill slope), each with its own properties. Every property is a template value: a side
 * value overrides the symmetric base, and clearing it inherits the base again.
 */
const COMPONENTS: Record<Kind, { name: string; rule: string; fields: (side: Side) => Field[] }> = {
  lane: {
    name: 'Resource lane',
    rule: 'Formation from the centreline to the hinge at the crossfall; surfaced to its depth.',
    fields: (side) => [
      { key: `${side}Width`, label: 'Width (m)', min: 0.1, max: 50 },
      { key: `${side}CrossfallPercent`, base: 'crossfallPercent', label: 'Crossfall (%)', min: -20, max: 20 },
      { key: `${side}SurfaceDepth`, base: 'surfaceDepth', label: 'Surfacing depth (m)', min: 0, max: 2 },
    ],
  },
  ditch: {
    name: 'Ditch · standard',
    rule: 'Conditional: built only where the hinge is below ground (cut). A bottom width makes it a U.',
    fields: (side) => [
      { key: `${side}DitchWidth`, base: 'ditchWidth', label: 'Top width (m)', min: 0, max: 10 },
      { key: `${side}DitchDepth`, base: 'ditchDepth', label: 'Depth (m)', min: 0, max: 5 },
      { key: `${side}DitchBottomWidth`, base: 'ditchBottomWidth', label: 'Bottom width (m)', min: 0, max: 10 },
    ],
  },
  slope: {
    name: 'Slope · standard cut/fill',
    rule: 'Runs from the hinge (or ditch) to daylight: the cut batter where ground is above, fill below.',
    fields: (side) => [
      { key: `${side}CutSlope`, base: 'cutSlope', label: 'Cut H:V', min: 0.1, max: 10 },
      { key: `${side}FillSlope`, base: 'fillSlope', label: 'Fill H:V', min: 0.1, max: 10 },
    ],
  },
}
const ATTRIBUTE = {
  crossfallPercent: 'CrossfallPercent',
  surfaceDepth: 'SurfaceDepth',
  ditchWidth: 'DitchWidth',
  ditchDepth: 'DitchDepth',
  ditchBottomWidth: 'DitchBottomWidth',
  cutSlope: 'CutSlope',
  fillSlope: 'FillSlope',
} as const

export function TemplateComponents({
  template,
  onChange,
  materials,
  features,
  surfaces,
}: {
  template: RoadTemplate
  onChange: (template: RoadTemplate) => void
  materials?: GroundMaterial[]
  features?: ContextFeature[]
  surfaces?: { id: string; name: string }[]
}) {
  const [selected, setSelected] = useState<{ side: Side; kind: Kind }>({ side: 'left', kind: 'ditch' })
  const value = (field: Field, side: Side) =>
    field.base
      ? sideValue(template, side, ATTRIBUTE[field.base as keyof typeof ATTRIBUTE])
      : (template[field.key] as number)
  const overridden = (field: Field) => field.base !== undefined && template[field.key] !== undefined
  const component = COMPONENTS[selected.kind]
  return (
    <div className="space-y-2" data-testid="road-template-components">
      <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-2">
        <ul role="tree" aria-label="Template components" className="space-y-1 text-xs">
          {(['left', 'right'] as const).map((side) => (
            <li key={side} role="treeitem" aria-expanded>
              <span className="font-medium capitalize">{side} side</span>
              <ul role="group" className="ml-2 border-l pl-2">
                {(Object.keys(COMPONENTS) as Kind[]).map((kind) => (
                  <li key={kind} role="treeitem" aria-selected={selected.side === side && selected.kind === kind}>
                    <button
                      className={`w-full truncate rounded px-1 text-left ${selected.side === side && selected.kind === kind ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                      aria-label={`${COMPONENTS[kind].name}-${side}`}
                      title={`${COMPONENTS[kind].name}-${side}`}
                      onClick={() => setSelected({ side, kind })}
                    >
                      {/* The group already names the side; the short name fits a narrow sidebar. */}
                      {COMPONENTS[kind].name.split(' · ')[0]}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <TemplateSketch template={template} selected={selected} />
      </div>
      <div className="rounded border p-2">
        <p className="text-xs font-medium">
          {component.name}-{selected.side}
        </p>
        <p className="mb-2 text-[11px] leading-4 text-muted-foreground">{component.rule}</p>
        <div className="grid grid-cols-2 gap-2">
          {component.fields(selected.side).map((field) => (
            <div key={field.key}>
              <NumberField
                label={`${field.label}${field.base && !overridden(field) ? ' · base' : ''}`}
                value={value(field, selected.side)}
                min={field.min}
                max={field.max}
                step={field.step ?? 0.1}
                onChange={(v) => onChange({ ...template, [field.key]: v })}
              />
              {overridden(field) && (
                <button
                  className="text-[10px] underline"
                  onClick={() => {
                    const next = { ...template }
                    delete next[field.key]
                    onChange(next)
                  }}
                >
                  Use base value
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      <SectionAssemblyEditor
        template={template}
        onChange={onChange}
        materials={materials}
        features={features}
        surfaces={surfaces}
      />
    </div>
  )
}

/** A to-scale schematic of the template on level ground 1.5 m above formation, selected component bold. */
function TemplateSketch({ template, selected }: { template: RoadTemplate; selected: { side: Side; kind: Kind } }) {
  const ground = 1.5
  const parts = (['left', 'right'] as const).map((side) => {
    const sign = side === 'left' ? -1 : 1
    const width = template[`${side}Width`]
    const hinge = (-width * sideValue(template, side, 'CrossfallPercent')) / 100
    const ditchWidth = sideValue(template, side, 'DitchWidth'),
      depth = sideValue(template, side, 'DitchDepth'),
      bottom = Math.min(ditchWidth, sideValue(template, side, 'DitchBottomWidth'))
    const run = (ditchWidth - bottom) / 2
    const ditch =
      ditchWidth > 0 && depth > 0
        ? [
            [width, hinge],
            [width + run, hinge - depth],
            [width + run + bottom, hinge - depth],
            [width + ditchWidth, hinge],
          ]
        : [[width, hinge]]
    const outer = width + (ditchWidth > 0 && depth > 0 ? ditchWidth : 0)
    const slope = [
      [outer, hinge],
      [outer + (ground - hinge) * sideValue(template, side, 'CutSlope'), ground],
    ]
    return {
      side,
      sign,
      lane: [
        [0, 0],
        [width, hinge],
      ],
      ditch,
      slope,
    }
  })
  const reach = Math.max(...parts.map((p) => p.slope[1][0])) + 0.5
  const x = (offset: number) => 100 + (offset / reach) * 95,
    y = (z: number) => 50 - z * 14
  const path = (points: number[][], sign: number) =>
    points.map(([o, z], i) => `${i ? 'L' : 'M'}${x(sign * o).toFixed(1)},${y(z).toFixed(1)}`).join(' ')
  return (
    <svg
      viewBox="0 0 200 80"
      className="w-full rounded border bg-muted/20"
      role="img"
      aria-label="Template component sketch, looking up-station"
    >
      <line
        x1={5}
        x2={195}
        y1={y(ground)}
        y2={y(ground)}
        stroke="hsl(var(--muted-foreground))"
        strokeDasharray="3 2"
        strokeWidth={0.6}
      />
      <line x1={x(0)} x2={x(0)} y1={8} y2={74} stroke="#e11d48" strokeDasharray="2 2" strokeWidth={0.6} />
      {parts.map((part) =>
        (['lane', 'ditch', 'slope'] as const).map((kind) => {
          const active = selected.side === part.side && selected.kind === kind
          return (
            <path
              key={`${part.side}-${kind}`}
              d={path(part[kind], part.sign)}
              fill="none"
              stroke={kind === 'lane' ? '#0d9488' : kind === 'ditch' ? '#0369a1' : '#a16207'}
              strokeWidth={active ? 2.6 : 1.2}
              opacity={active ? 1 : 0.65}
            />
          )
        }),
      )}
      <text x={6} y={76} fontSize={7} fill="hsl(var(--muted-foreground))">
        L
      </text>
      <text x={190} y={76} fontSize={7} fill="hsl(var(--muted-foreground))">
        R
      </text>
    </svg>
  )
}
