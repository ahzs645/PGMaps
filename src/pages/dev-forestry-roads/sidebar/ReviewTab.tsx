import { useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, NumberField, roadFieldClass, RoadSelect } from '../Controls'
import { formatRoadStation } from '../Charts'
import { RoadSection, SectionReachAlert } from '../SidebarParts'
import type { SidebarProps, SidebarTab } from '../DesignSidebarBody'
import type { RoadSettings } from '../types'
import { assessCostReadiness, crossingsWithoutStructure } from '../costReadiness'
import { surfacingSupplyCost } from '../gravel'

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
  [
    'maxGradePercent',
    'Grade limit (%)',
    0.1,
    100,
    'Station grades above this threshold are flagged. Terrain-cost route search accepts limits above 0% up to 60%; the corridor optimizer needs 1–30%. This input does not certify a road standard.',
  ],
  [
    'minRadius',
    'Minimum radius (m)',
    0,
    10000,
    'Horizontal curves tighter than this are flagged. The corridor optimizer needs 5–1,000 m; a route from the terrain-cost search gets curves of at least this radius where they fit.',
  ],
]
const RATES = [
  ['cutRate', 'Cut ($/m³)'],
  ['fillRate', 'Fill ($/m³)'],
  ['surfacingRate', 'Surfacing ($/m³)'],
  ['clearingRate', 'Clearing ($/m²)'],
  ['shrinkFactor', 'Reusable cut factor'],
] as const

const RATE_NAMES = { cutRate: 'cut', fillRate: 'fill', surfacingRate: 'surfacing', clearingRate: 'clearing' }

type Check = {
  id: string
  label: string
  /** One short line of what was found. Absent when `ok` says it all. */
  detail?: string
  ok: boolean | null
  action?: { label: string; onClick: () => void }
}

/** The first thing a reviewer needs: is this road ready, and if not, where to go next. */
function ReadinessChecks({ checks }: { checks: Check[] }) {
  return (
    <ul className="divide-y rounded-md border" data-testid="road-readiness-checks">
      {checks.map((check) => (
        <li key={check.id} className="flex items-center gap-2 px-2 py-1.5 text-xs" data-check={check.id}>
          {check.ok === true ? (
            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" aria-label="Passed" />
          ) : check.ok === false ? (
            <AlertTriangle className="size-3.5 shrink-0 text-amber-600" aria-label="Needs attention" />
          ) : (
            <Circle className="size-3.5 shrink-0 text-muted-foreground" aria-label="Not checked yet" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{check.label}</span>
            {check.detail && <span className="block text-2xs leading-4 text-muted-foreground">{check.detail}</span>}
          </span>
          {check.action && (
            <Button size="sm" variant="ghost" className="h-6 shrink-0 px-1.5 text-2xs" onClick={check.action.onClick}>
              {check.action.label}
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

export function ReviewTab(p: SidebarProps & { onTab: (tab: SidebarTab) => void }) {
  const { project, alignment, analysis, update } = p.workspace
  const aggregateSource = alignment.engineering?.surfacingSupply
  const aggregate = surfacingSupplyCost(analysis.surfaceVolumeM3, project.settings.surfacingRate, aggregateSource)
  const setting = (key: keyof RoadSettings, value: number) =>
    update((x) => ({ ...x, settings: { ...x.settings, [key]: value } }))
  const settings = project.settings
  const stream = analysis.crossings.filter((c) => c.kind === 'stream')
  const sharp = new Set(
    analysis.stations.filter((s) => s.flags.some((f) => /Sharp horizontal PI/i.test(f))).map((s) => s.chainage),
  ).size
  const drainageRecord = project.drainage?.records.find((record) => record.alignmentId === alignment.id)
  const redirectedFlow = drainageRecord?.summary.redirected ?? 0
  const placeholders = assessCostReadiness(analysis, alignment, settings).placeholderRates
  const [ratesOpen, setRatesOpen] = useState(false)
  const rates = useRef<HTMLDivElement>(null)
  const openRates = () => {
    setRatesOpen(true)
    requestAnimationFrame(() => rates.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }
  const uncrossed = crossingsWithoutStructure(analysis, alignment.engineering)
  const unpriced = (alignment.engineering?.culverts ?? []).filter((c) => c.unitCost === 0 && c.fixedCost === 0)
  const checks: Check[] = [
    {
      id: 'sections',
      label: 'Sections complete',
      detail: `${analysis.coveragePercent.toFixed(1)}%`,
      ok: analysis.coveragePercent >= 99.95,
    },
    {
      id: 'profile',
      label: 'Designed profile',
      detail: alignment.vertical.length ? undefined : 'The formation follows the ground.',
      ok: alignment.vertical.length > 1,
      action: alignment.vertical.length > 1 ? undefined : { label: 'Design', onClick: () => p.onTab('design') },
    },
    {
      id: 'grade',
      label: `Grade within ${settings.maxGradePercent}%`,
      detail: `Steepest ${analysis.maxGradePercent.toFixed(1)}%`,
      ok: analysis.maxGradePercent <= settings.maxGradePercent + 1e-6,
    },
    {
      id: 'curves',
      label: 'Curves fitted',
      detail: sharp ? `${sharp} sharp corner${sharp === 1 ? '' : 's'}` : undefined,
      ok: !sharp,
      action: sharp ? { label: 'Design', onClick: () => p.onTab('design') } : undefined,
    },
    {
      id: 'drainage',
      label: !drainageRecord
        ? 'Drainage not checked'
        : p.drainageStale
          ? 'Drainage check is out of date'
          : redirectedFlow
            ? 'Road turns modelled streams'
            : 'Drainage checked',
      detail: !drainageRecord
        ? 'Run it from the Drainage view.'
        : p.drainageStale
          ? 'The road, its culverts or the terrain changed.'
          : drainageRecord.summary.redirected || drainageRecord.summary.lowPoints
            ? `${redirectedFlow} of ${drainageRecord.summary.crossings} modelled streams redirected · ${drainageRecord.summary.lowPoints} low points`
            : undefined,
      ok: drainageRecord ? !p.drainageStale && !redirectedFlow : null,
      action:
        drainageRecord && !p.drainageStale && !redirectedFlow
          ? undefined
          : { label: 'Open', onClick: () => p.onShowDrainage?.() },
    },
    uncrossed.length
      ? {
          id: 'crossings',
          label: `${uncrossed.length} mapped stream crossing${uncrossed.length === 1 ? ' needs' : 's need'} a culvert`,
          detail: `${uncrossed[0].name} at ${formatRoadStation(uncrossed[0].chainage)}${uncrossed.length > 1 ? ` and ${uncrossed.length - 1} more` : ''}`,
          ok: false,
          action: { label: 'Add culvert', onClick: () => p.onShowCulverts?.(uncrossed[0].chainage) },
        }
      : {
          id: 'crossings',
          label: stream.length
            ? `Mapped stream crossing${stream.length === 1 ? ' has a culvert' : 's have culverts'}`
            : 'No mapped stream crossings',
          ok: true,
        },
    ...(unpriced.length
      ? [
          {
            id: 'culvert-prices',
            label: `${unpriced.length} culvert${unpriced.length === 1 ? ' has' : 's have'} no price`,
            detail: 'They add nothing to the estimate yet.',
            ok: false,
            action: { label: 'Set price', onClick: () => p.onShowCulverts?.(unpriced[0].chainage) },
          },
        ]
      : []),
    {
      id: 'rates',
      label: placeholders.length ? 'Unit rates need checking' : 'Unit rates entered',
      detail: placeholders.length
        ? `Still at the default: ${placeholders.map((key) => RATE_NAMES[key]).join(', ')}`
        : undefined,
      ok: !placeholders.length,
      action: placeholders.length ? { label: 'Enter rates', onClick: openRates } : undefined,
    },
  ]
  return (
    <>
      <RoadSection
        title="Ready to review"
        help="Checks on the active road, each with its next step. None of them certifies a road standard. Mapped streams come from your data; modelled streams come from the drainage check's terrain model, so the counts can differ. A rate counts as checked once it differs from the default."
      >
        <ReadinessChecks checks={checks} />
        <SectionReachAlert workspace={p.workspace} />
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-full whitespace-normal"
          onClick={p.onCompareCompleteCosts}
        >
          Review connected access & complete route costs
        </Button>
      </RoadSection>
      {/* Empty, it would only repeat the checklist's "No mapped stream crossings". */}
      {analysis.crossings.length + analysis.warnings.length > 0 && (
        <RoadSection
          title="Crossings & review flags"
          summary={`${analysis.crossings.length + analysis.warnings.length}`}
          defaultOpen={analysis.warnings.length > 0}
          help="Stream intersections flag crossing sites. Engineering → Drainage adds culvert dimensions, inverts, cover checks and costs at these stations. Hydraulic capacity needs more site inputs."
        >
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
      )}
      <RoadSection
        title="Limits & sampling"
        summary={`${settings.maxGradePercent}% · R${settings.minRadius}`}
        help="These thresholds are project inputs, not a claim of compliance with a road standard."
      >
        <div className="grid grid-cols-2 items-end gap-2">
          {SCREENING.map(([key, label, min, max, hint]) => (
            <NumberField
              key={key}
              label={label}
              hint={hint}
              value={settings[key]}
              min={min}
              max={max}
              step={1}
              onChange={(value) => setting(key, value)}
            />
          ))}
        </div>
      </RoadSection>
      <div ref={rates} className="scroll-mt-2" />
      <RoadSection
        title="Unit rates"
        summary={`$${settings.cutRate} cut · $${settings.fillRate} fill`}
        open={ratesOpen}
        onOpenChange={setRatesOpen}
        help={
          <>
            Base unit rates in CAD. Engineering inputs add material-specific excavation, structures, haul, borrow and
            waste, mobilization and contingency. Unassigned excavation uses this cut rate.
          </>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          {RATES.map(([key, label]) => (
            <NumberField
              key={key}
              label={label}
              hint={
                key === 'surfacingRate'
                  ? 'Base surfacing rate. An enabled aggregate source supplies its entered capacity at its delivered rate; only the remainder uses this base rate.'
                  : undefined
              }
              value={project.settings[key]}
              min={key === 'shrinkFactor' ? 0.1 : 0}
              max={key === 'shrinkFactor' ? 2 : 10000}
              onChange={(value) => setting(key, value)}
            />
          ))}
        </div>
        <p className="text-2xs text-muted-foreground" data-testid="road-review-aggregate-summary">
          {aggregateSource?.enabled ? (
            <>
              <span className="font-medium">{aggregateSource.name}</span> · {aggregate.suppliedM3.toFixed(1)} m³ at $
              {aggregate.rate.toFixed(2)}/m³ · {aggregate.fallbackM3.toFixed(1)} m³ at the base rate
            </>
          ) : (
            <>No aggregate source: the base surfacing rate applies.</>
          )}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-between px-2 text-xs"
          onClick={() => p.onTab('engineering')}
        >
          Materials, drainage, aggregate & haul inputs
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
      summary={`${project.cables.length}`}
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
            <RoadSelect
              ariaLabel="Yarder position"
              className={roadFieldClass}
              value={c.yarderAt ?? 'start'}
              onValueChange={(value) => edit(c.id, (a) => ({ ...a, yarderAt: value as 'start' | 'end' }))}
            >
              <option value="start">Start endpoint</option>
              <option value="end">End endpoint</option>
            </RoadSelect>
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
