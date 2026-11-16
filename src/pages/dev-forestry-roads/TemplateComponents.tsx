import { useState } from 'react'
import { InfoTip } from '@/components/ui/info-tip'
import { Button } from '@/components/ui/button'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { Field, NumberField, OptionalNumberField, RoadSelect } from './Controls'
import {
  courseSideRunM,
  ditchInslopeAt,
  ditchRuns,
  MAX_DITCH_DEPTH_M,
  MAX_DITCH_WIDTH_M,
  STRUCTURE_LIMITS,
} from './sectionStructures'
import { batterSource, withBatterSource } from './groundBatters'
import { copyTemplateSide, ditchSideSlope, ditchTopWidthForSlope, ditchWidthRange, sideValue } from './templates'
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
      { key: `${side}DitchWidth`, base: 'ditchWidth', label: 'Top width (m)', min: 0, max: MAX_DITCH_WIDTH_M },
      { key: `${side}DitchDepth`, base: 'ditchDepth', label: 'Depth (m)', min: 0, max: MAX_DITCH_DEPTH_M },
      {
        key: `${side}DitchBottomWidth`,
        base: 'ditchBottomWidth',
        label: 'Bottom width (m)',
        min: 0,
        max: MAX_DITCH_WIDTH_M,
      },
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
  const ditchDepth = sideValue(template, selected.side, 'DitchDepth'),
    ditchBottom = sideValue(template, selected.side, 'DitchBottomWidth')
  const ditchTop = sideValue(template, selected.side, 'DitchWidth'),
    ditchInslope = ditchInslopeAt(template, selected.side),
    runs = ditchRuns(ditchTop, ditchDepth, ditchBottom, ditchInslope)
  const ditch = {
    depth: ditchDepth,
    bottom: ditchBottom,
    width: ditchTop,
    slope: ditchSideSlope(ditchTop, ditchDepth, ditchBottom),
    inslope: ditchInslope,
    backslope: ditchDepth > 0 ? runs.backRun / ditchDepth : 0,
  }
  const fixed = (n: number, digits = 1) => n.toFixed(digits).replace(/\.0+$/, '')
  const metres = (n: number) => String(Number(n.toFixed(2)))
  /** The values that identify a component at a glance, so the grid doubles as a summary. */
  const glance = (kind: Kind, side: Side) => {
    if (kind === 'lane')
      return `${fixed(template[`${side}Width`])} m · ${fixed(sideValue(template, side, 'CrossfallPercent'))}%`
    if (kind === 'ditch') {
      const width = sideValue(template, side, 'DitchWidth'),
        depth = sideValue(template, side, 'DitchDepth')
      return width > 0 && depth > 0 ? `${fixed(width)} × ${fixed(depth)} m` : 'None'
    }
    // A batter taken from the ground materials (RoadEng's AUTO) shows as such, not as its fallback.
    const ground = (which: 'cut' | 'fill') => batterSource(template, side, which) === 'material'
    if (ground('cut') && ground('fill')) return 'Ground'
    const slope = (which: 'cut' | 'fill') =>
      ground(which) ? 'ground' : fixed(sideValue(template, side, which === 'cut' ? 'CutSlope' : 'FillSlope'), 2)
    return `C ${slope('cut')} · F ${slope('fill')}`
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
      <div className={insetBox()}>
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
                // A ditch's bottom is no wider than its top, so each of the two limits the other.
                min={ditchWidthRange(template, String(field.key))?.min ?? field.min}
                max={ditchWidthRange(template, String(field.key))?.max ?? field.max}
                hint={
                  /DitchBottomWidth$/.test(String(field.key))
                    ? 'At most the top width. 0 is a V ditch.'
                    : /DitchWidth$/.test(String(field.key))
                      ? 'At least the bottom width.'
                      : undefined
                }
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
        {selected.kind === 'lane' && courseSideRunM(template.layers, selected.side) > 0 && (
          <p className="mt-1 text-2xs text-muted-foreground" data-testid="road-lane-running-surface">
            Running surface {metres(template[`${selected.side}Width`] - courseSideRunM(template.layers, selected.side))}{' '}
            m; the courses&apos; side slopes spread {metres(courseSideRunM(template.layers, selected.side))} m out to
            the subgrade edge at {metres(template[`${selected.side}Width`])} m, where the ditch and the batters start.
          </p>
        )}
        {selected.kind === 'slope' && (
          <div className="mt-2 grid grid-cols-2 items-end gap-2" data-testid="road-batter-sources">
            {(['cut', 'fill'] as const).map((which) => {
              const name = `${which === 'cut' ? 'Cut' : 'Fill'} batter from`
              return (
                <Field
                  key={which}
                  label={name}
                  hint={
                    which === 'cut'
                      ? 'Ground material: each horizon is cut at its material’s cut batter, the batter bending where it crosses a horizon (RoadEng’s AUTO slope); a horizon whose material has no batter takes the H:V above. This slope: the H:V above in every material. Material where set: a material’s batter where it has one, else the H:V above.'
                      : 'Ground material: the station’s fill requirement material’s fill batter, else the top horizon’s (RoadEng’s AUTO slope, stratum layer 1). This slope: the H:V above. Material where set: the fill requirement material’s batter where it has one, else the H:V above.'
                  }
                >
                  <RoadSelect
                    ariaLabel={`${selected.side === 'left' ? 'Left' : 'Right'} ${name.toLowerCase()}`}
                    value={batterSource(template, selected.side, which) ?? 'either'}
                    options={[
                      { value: 'material', label: 'Ground' },
                      { value: 'template', label: 'This slope' },
                      { value: 'either', label: 'Material where set' },
                    ]}
                    onValueChange={(v) =>
                      onChange(
                        withBatterSource(
                          template,
                          selected.side,
                          which,
                          v === 'material' || v === 'template' ? v : undefined,
                        ),
                      )
                    }
                  />
                </Field>
              )
            })}
          </div>
        )}
        {selected.kind === 'ditch' && ditch.slope !== null && (
          // The same ditch, entered as the manual does: a depth and slopes instead of a top width.
          <div className="mt-2 grid grid-cols-3 items-end gap-2" data-testid="road-ditch-slopes">
            {ditch.inslope === undefined && (
              <NumberField
                label="Side slopes (H:V)"
                value={Number(ditch.slope.toFixed(4))}
                min={0}
                max={Number(((MAX_DITCH_WIDTH_M - ditch.bottom) / 2 / ditch.depth).toFixed(4))}
                step={0.25}
                hint="Sets the top width from the depth and bottom width: top = bottom + 2 × slope × depth. A 0.3 m deep V ditch at 4:1 is 2.4 m wide. Give an inslope for a ditch whose two slopes differ."
                onChange={(slope) =>
                  onChange({
                    ...template,
                    [`${selected.side}DitchWidth`]: Number(
                      ditchTopWidthForSlope(slope, ditch.depth, ditch.bottom).toFixed(4),
                    ),
                  })
                }
              />
            )}
            <OptionalNumberField
              label="Inslope (H:V)"
              value={ditch.inslope ?? null}
              min={STRUCTURE_LIMITS.ditchInslope[0]}
              max={Math.min(
                STRUCTURE_LIMITS.ditchInslope[1],
                Number(((ditch.width - ditch.bottom) / ditch.depth).toFixed(4)),
              )}
              step={0.25}
              placeholder="as backslope"
              hint="From the road edge down to the ditch bottom. The backslope takes the rest of the top width. Blank: both slopes alike."
              error={inputMessage(problem, 'template', undefined, `${selected.side}DitchInslope`)}
              onChange={(v) => {
                const next = { ...template }
                if (v === null) {
                  delete next[`${selected.side}DitchInslope`]
                  // A shared inslope would still apply: clear it on this side by keeping the other side's.
                  if (next.ditchInslope !== undefined) {
                    const other = selected.side === 'left' ? 'right' : 'left'
                    next[`${other}DitchInslope`] ??= next.ditchInslope
                    delete next.ditchInslope
                  }
                } else next[`${selected.side}DitchInslope`] = v
                onChange(next)
              }}
            />
            {ditch.inslope !== undefined && (
              <NumberField
                label="Backslope (H:V)"
                value={Number(ditch.backslope.toFixed(4))}
                min={0}
                max={Number(((MAX_DITCH_WIDTH_M - ditch.bottom) / ditch.depth - ditch.inslope).toFixed(4))}
                step={0.25}
                hint="Sets the top width: top = bottom + (inslope + backslope) × depth."
                onChange={(back) =>
                  onChange({
                    ...template,
                    [`${selected.side}DitchWidth`]: Number(
                      (ditch.bottom + (ditch.inslope! + back) * ditch.depth).toFixed(4),
                    ),
                  })
                }
              />
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {(['left', 'right'] as const).map((from) => (
          <Button
            key={from}
            size="sm"
            variant="outline"
            onClick={() => onChange(copyTemplateSide(template, from, () => crypto.randomUUID()))}
          >
            Copy {from} side to {from === 'left' ? 'right' : 'left'}
          </Button>
        ))}
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
    const run = ditchRuns(ditchWidth, depth, bottom, ditchInslopeAt(template, side)).inRun
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
      className={cn(insetBox({ padding: 'none', tone: 'muted' }), 'w-full')}
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
