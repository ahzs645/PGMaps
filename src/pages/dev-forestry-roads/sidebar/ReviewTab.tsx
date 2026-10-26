import type { ReactNode } from 'react'
import { ArrowRight, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, NumberField, roadFieldClass } from '../Controls'
import { formatRoadStation } from '../Charts'
import { RoadSection, SectionReachAlert } from '../SidebarParts'
import type { SidebarProps, SidebarTab } from '../DesignSidebarBody'
import type { RoadSettings } from '../types'

const SCREENING: [keyof RoadSettings, string, number, number, ReactNode][] = [
  [
    'stationInterval',
    'Station spacing (m)',
    2,
    100,
    'Distance between sampled sections. Curve and event stations are added on top.',
  ],
  [
    'crossSectionHalfWidth',
    'Section reach each side (m)',
    5,
    100,
    'How far out from the centreline each section looks for where the cut or fill batter meets the ground. A high fill or deep cut needs more; a station whose batter runs past it is drawn red on the plan and left out of quantities.',
  ],
  ['maxGradePercent', 'Grade limit (%)', 0.1, 100, 'Stations steeper than this are drawn red and flagged.'],
  ['minRadius', 'Minimum radius (m)', 0, 10000, 'Horizontal curves tighter than this are flagged.'],
]
const RATES = [
  ['cutRate', 'Cut ($/m³)'],
  ['fillRate', 'Fill ($/m³)'],
  ['surfacingRate', 'Surfacing ($/m³)'],
  ['clearingRate', 'Clearing ($/m²)'],
  ['shrinkFactor', 'Reusable cut factor'],
] as const

export function ReviewTab(p: SidebarProps & { onTab: (tab: SidebarTab) => void }) {
  const { project, analysis, update } = p.workspace
  const setting = (key: keyof RoadSettings, value: number) =>
    update((x) => ({ ...x, settings: { ...x.settings, [key]: value } }))
  return (
    <>
      <RoadSection
        title="Screening & sampling"
        help="These thresholds are project inputs, not a claim of compliance with a road standard."
      >
        <div className="grid grid-cols-2 items-end gap-2">
          {SCREENING.map(([key, label, min, max, hint]) => (
            <NumberField
              key={key}
              label={label}
              hint={hint}
              value={project.settings[key]}
              min={min}
              max={max}
              step={1}
              onChange={(value) => setting(key, value)}
            />
          ))}
        </div>
        <SectionReachAlert workspace={p.workspace} />
      </RoadSection>
      <RoadSection
        title="Crossings & review flags"
        help="Stream intersections flag crossing sites. Engineering → Drainage adds culvert dimensions, inverts, cover checks and costs at these stations. Hydraulic capacity needs more site inputs."
      >
        <p className="mb-2 text-xs">
          <span className="font-medium tabular-nums">{analysis.coveragePercent.toFixed(1)}%</span> of the road has
          complete earthwork sections.
        </p>
        {analysis.crossings.map((c) => (
          <button
            key={c.id}
            className="mb-1 block w-full rounded border px-2 py-1 text-left text-xs hover:bg-muted"
            onClick={() => p.workspace.setStation(c.chainage)}
          >
            {c.name} · {formatRoadStation(c.chainage)}
            <span className="block text-muted-foreground">{c.kind} crossing · field review</span>
          </button>
        ))}
        {analysis.warnings.map((w, i) => (
          <p key={i} className="mb-1 border-l-2 border-amber-500 pl-2 text-xs">
            {w}
          </p>
        ))}
      </RoadSection>
      <RoadSection
        title="Earthwork cost assumptions"
        help="Base unit rates in CAD. Engineering inputs add material-specific excavation, structures, haul, borrow and waste, mobilization and contingency. Unassigned excavation uses this cut rate."
      >
        <div className="grid grid-cols-2 gap-2">
          {RATES.map(([key, label]) => (
            <NumberField
              key={key}
              label={label}
              value={project.settings[key]}
              min={key === 'shrinkFactor' ? 0.1 : 0}
              max={key === 'shrinkFactor' ? 2 : 10000}
              onChange={(value) => setting(key, value)}
            />
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 w-full justify-between px-2 text-xs"
          onClick={() => p.onTab('engineering')}
        >
          Materials, drainage & haul inputs
          <ArrowRight className="size-3" />
        </Button>
      </RoadSection>
      <CableLines {...p} />
    </>
  )
}

function CableLines(p: SidebarProps) {
  const { project, update } = p.workspace
  const edit = (id: string, change: (line: (typeof project.cables)[number]) => (typeof project.cables)[number]) =>
    update((x) => ({ ...x, cables: x.cables.map((a) => (a.id === id ? change(a) : a)) }))
  return (
    <RoadSection
      title="D-line / cable geometry"
      help="Positive offsets inset the supports; negative offsets extend the span. Heights follow the selected yarder and tailhold ends. An assumed parabolic sag screens clearance; it does not calculate tension or payload."
    >
      <Button variant="outline" size="sm" className="w-full" onClick={() => p.onMode('cable')}>
        Draw landing-to-tailhold line
      </Button>
      {project.cables.map((c) => (
        <div key={c.id} className="mt-2 space-y-2 rounded border p-2">
          <div className="flex items-center justify-between gap-1">
            <input
              className={roadFieldClass}
              aria-label="D-line name"
              value={c.name}
              maxLength={200}
              onChange={(e) => edit(c.id, (a) => ({ ...a, name: e.target.value }))}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              aria-label={`Remove ${c.name}`}
              onClick={() => update((x) => ({ ...x, cables: x.cables.filter((a) => a.id !== c.id) }))}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
          <Field label="Yarder position">
            <select
              className={roadFieldClass}
              value={c.yarderAt ?? 'start'}
              onChange={(e) => edit(c.id, (a) => ({ ...a, yarderAt: e.target.value as 'start' | 'end' }))}
            >
              <option value="start">Start endpoint</option>
              <option value="end">End endpoint</option>
            </select>
          </Field>
          <div className="grid grid-cols-3 gap-1">
            {(['startHeight', 'endHeight', 'deflectionPercent'] as const).map((key) => (
              <NumberField
                key={key}
                label={key === 'startHeight' ? 'Yarder m' : key === 'endHeight' ? 'Tailhold m' : 'Sag %'}
                value={c[key]}
                max={key === 'deflectionPercent' ? 25 : 100}
                onChange={(value) => edit(c.id, (a) => ({ ...a, [key]: value }))}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {(['startOffsetM', 'endOffsetM'] as const).map((key) => (
              <NumberField
                key={key}
                label={key === 'startOffsetM' ? 'Start inset (m)' : 'End inset (m)'}
                value={c[key] ?? 0}
                min={-200}
                max={200}
                onChange={(value) => edit(c.id, (a) => ({ ...a, [key]: value }))}
              />
            ))}
          </div>
          <details className="rounded border p-2">
            <summary className="cursor-pointer text-xs">Edit original endpoints</summary>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {(['start', 'end'] as const).flatMap((endpoint) =>
                ([0, 1] as const).map((axis) => (
                  <NumberField
                    key={`${endpoint}-${axis}`}
                    label={`${endpoint} ${axis === 0 ? 'longitude' : 'latitude'}`}
                    value={c[endpoint][axis]}
                    min={axis === 0 ? -180 : -84.999999}
                    max={axis === 0 ? 180 : 84.999999}
                    step={0.00001}
                    onChange={(value) =>
                      edit(c.id, (a) => ({ ...a, [endpoint]: a[endpoint].map((n, i) => (i === axis ? value : n)) }))
                    }
                  />
                )),
              )}
            </div>
          </details>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              edit(c.id, (a) => ({
                ...a,
                start: a.end,
                end: a.start,
                startOffsetM: a.endOffsetM ?? 0,
                endOffsetM: a.startOffsetM ?? 0,
                yarderAt: a.yarderAt === 'end' ? 'start' : 'end',
              }))
            }
          >
            Reverse line direction
          </Button>
        </div>
      ))}
    </RoadSection>
  )
}
