import { useState } from 'react'
import { InfoTip } from '@/components/ui/info-tip'
import { NumberField } from './Controls'
import { sideValue } from './templates'
import { SectionAssemblyEditor } from './SectionAssemblyEditor'
import { inputMessage, type InvalidInput } from './inputErrors'
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
      { key: `${side}SurfaceDepth`, base: 'surfaceDepth', label: 'Surfacing (m)', min: 0, max: 2 },
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
const SHORT: Record<Kind, string> = { lane: 'Lane', ditch: 'Ditch', slope: 'Slope' }
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
  problem,
  onRockFillTemplate,
}: {
  template: RoadTemplate
  onChange: (template: RoadTemplate) => void
  materials?: GroundMaterial[]
  features?: ContextFeature[]
  surfaces?: { id: string; name: string }[]
  /** Starts a keyed rock-fill template as a new named template, leaving this one as it is. */
  onRockFillTemplate?: () => void
  /** The current invalid edit to this template, if any; its message is shown at the field it names. */
  problem?: InvalidInput
}) {
  const [selected, setSelected] = useState<{ side: Side; kind: Kind }>({ side: 'left', kind: 'ditch' })
  const value = (field: Field, side: Side) =>
    field.base
      ? sideValue(template, side, ATTRIBUTE[field.base as keyof typeof ATTRIBUTE])
      : (template[field.key] as number)
  const overridden = (field: Field) => field.base !== undefined && template[field.key] !== undefined
  const component = COMPONENTS[selected.kind]
  const fixed = (n: number, digits = 1) => n.toFixed(digits).replace(/\.0+$/, '')
  /** The values that identify a component at a glance, so the grid doubles as a summary. */
  const glance = (kind: Kind, side: Side) => {
    if (kind === 'lane')
      return `${fixed(template[`${side}Width`])} m · ${fixed(sideValue(template, side, 'CrossfallPercent'))}%`
    if (kind === 'ditch') {
      const width = sideValue(template, side, 'DitchWidth'),
        depth = sideValue(template, side, 'DitchDepth')
      return width > 0 && depth > 0 ? `${fixed(width)} × ${fixed(depth)} m` : 'None'
    }
    return `C ${fixed(sideValue(template, side, 'CutSlope'), 2)} · F ${fixed(sideValue(template, side, 'FillSlope'), 2)}`
  }
  const label = (kind: Kind, side: Side) => `${side === 'left' ? 'Left' : 'Right'} ${SHORT[kind].toLowerCase()}`
  return (
    <div className="space-y-2" data-testid="road-template-components">
      <TemplateSketch template={template} selected={selected} />
      <div
        role="group"
        aria-label="Template components"
        className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1 text-xs"
      >
        <div className="contents">
          <span />
          {(['left', 'right'] as const).map((side) => (
            <span key={side} className="text-center text-3xs font-medium uppercase text-muted-foreground">
              {side}
            </span>
          ))}
        </div>
        {(Object.keys(COMPONENTS) as Kind[]).map((kind) => (
          <div key={kind} className="contents">
            <span className="pr-1 font-medium">{SHORT[kind]}</span>
            {(['left', 'right'] as const).map((side) => {
              const active = selected.side === side && selected.kind === kind
              return (
                <button
                  key={side}
                  type="button"
                  aria-label={label(kind, side)}
                  aria-pressed={active}
                  title={kind === 'slope' ? 'Cut · fill slope, H:V' : undefined}
                  onClick={() => setSelected({ side, kind })}
                  className={`w-full truncate rounded-md border px-2 py-1 text-center tabular-nums transition-colors touch:py-2 ${active ? 'border-primary bg-primary/10 font-medium text-primary' : 'hover:bg-muted'}`}
                >
                  {glance(kind, side)}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <div className="rounded-md border p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-medium">{label(selected.kind, selected.side)}</p>
          <InfoTip label={`About the ${SHORT[selected.kind].toLowerCase()}`}>{component.rule}</InfoTip>
        </div>
        {/* Labels can wrap differently, so cells align at the bottom: every input, and the status line
            under it, sits on one row. The status says whether the value is the base template's. */}
        <div className="grid grid-cols-3 items-end gap-2">
          {component.fields(selected.side).map((field) => (
            <div key={field.key}>
              <NumberField
                label={field.label}
                value={value(field, selected.side)}
                min={field.min}
                max={field.max}
                step={field.step ?? 0.1}
                error={inputMessage(problem, 'template', undefined, field.key)}
                onChange={(v) => onChange({ ...template, [field.key]: v })}
              />
              <p className="mt-0.5 min-h-4 text-3xs leading-4 text-muted-foreground">
                {overridden(field) ? (
                  <button
                    className="underline"
                    onClick={() => {
                      const next = { ...template }
                      delete next[field.key]
                      onChange(next)
                    }}
                  >
                    Use base value
                  </button>
                ) : field.base ? (
                  'From base'
                ) : null}
              </p>
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
        onRockFillTemplate={onRockFillTemplate}
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
