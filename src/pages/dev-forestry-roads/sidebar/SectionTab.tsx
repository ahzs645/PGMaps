import { useState } from 'react'
import { ArrowRight, Copy, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, NumberField, roadFieldClass, RoadSelect } from '../Controls'
import { formatRoadStation } from '../Charts'
import { CURVE_DESIGN_HELP, CurveDesignControls } from '../CurveTools'
import { RoadSettingsDialog } from '../RoadSettingsDialog'
import { TemplateComponents } from '../TemplateComponents'
import { RoadSection } from '../SidebarParts'
import { EntryProblem } from '../InputProblem'
import { inputMessage } from '../inputErrors'
import type { SidebarProps, SidebarTab } from '../DesignSidebarBody'
import type { RoadTemplate, WidthOverride } from '../types'

const id = () => crypto.randomUUID()
type NumericTemplateKey = {
  [K in keyof RoadTemplate]-?: RoadTemplate[K] extends number | undefined ? K : never
}[keyof RoadTemplate]
const TEMPLATE_FIELDS: [NumericTemplateKey, string, number, number][] = [
  ['leftWidth', 'Left half-width (m)', 0.1, 50],
  ['rightWidth', 'Right half-width (m)', 0.1, 50],
  ['crossfallPercent', 'Crown crossfall (%)', 0, 20],
  ['cutSlope', 'Cut batter (H:V)', 0.1, 10],
  ['fillSlope', 'Fill batter (H:V)', 0.1, 10],
  ['ditchWidth', 'Ditch width (m)', 0, 10],
  ['ditchDepth', 'Ditch depth (m)', 0, 5],
  ['surfaceDepth', 'Surfacing depth (m)', 0, 2],
]

export function SectionTab(p: SidebarProps & { onTab: (tab: SidebarTab) => void }) {
  const { alignment, updateAlignment } = p.workspace
  // An invalid section value keeps the last valid road on screen; the message sits at its field.
  const problem = p.workspace.analysis.invalidInput
  return (
    <>
      <RoadSection
        title="Road cross-section"
        help="Formation geometry is a crown, a cut-side ditch and batters that run out to meet the ground. Flatter batters (a larger H:V) reach further, so a high fill or deep cut needs more section reach. The surfacing layer is a separate quantity. Batters and costs are editable planning assumptions."
      >
        <div className="grid grid-cols-2 items-end gap-x-2 gap-y-1.5">
          {TEMPLATE_FIELDS.map(([key, label, min, max]) => (
            <NumberField
              key={key}
              label={label}
              value={alignment.template[key] ?? 0}
              min={min}
              max={max}
              error={inputMessage(problem, 'template', undefined, key)}
              onChange={(value) => updateAlignment((a) => ({ ...a, template: { ...a.template, [key]: value } }))}
            />
          ))}
        </div>
        {/* Side values are edited under Template components, which shows one component at a time. */}
        <EntryProblem problem={problem} list="template" inlineFields={TEMPLATE_FIELDS.map(([key]) => key)} />
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 w-full justify-between px-2 text-xs"
          onClick={() => p.onTab('engineering')}
        >
          Template library & station assignments
          <ArrowRight className="size-3" />
        </Button>
      </RoadSection>
      <RoadSection title="Template components" summary={`${alignment.template.components?.length ?? 0} added`}>
        <TemplateComponents
          template={alignment.template}
          materials={alignment.engineering?.materials}
          features={p.workspace.project.context}
          surfaces={p.workspace.project.terrain.referenceSurfaces}
          problem={problem}
          onChange={(template) => updateAlignment((a) => ({ ...a, template }))}
        />
      </RoadSection>
      <RoadSection
        title="Superelevation & widening"
        summary={alignment.curveDesign ? `${alignment.curveDesign.designSpeedKmh} km/h` : 'Off'}
        help={CURVE_DESIGN_HELP}
      >
        <CurveDesignControls workspace={p.workspace} />
      </RoadSection>
      <Widenings {...p} />
    </>
  )
}

function Widenings(p: SidebarProps) {
  const { alignment, analysis, updateAlignment } = p.workspace
  const [open, setOpen] = useState(false)
  const tweak = (key: string, changes: Partial<WidthOverride>) =>
    updateAlignment((a) => ({ ...a, overrides: a.overrides.map((x) => (x.id === key ? { ...x, ...changes } : x)) }))
  const add = (kind: WidthOverride['kind']) =>
    updateAlignment((a) => {
      const start = Math.min(p.workspace.station, Math.max(0, analysis.length - 60))
      return {
        ...a,
        overrides: [
          ...a.overrides,
          {
            id: id(),
            name: kind === 'landing' ? 'New landing' : 'New turnout',
            kind,
            side: 'left',
            start,
            end: Math.min(analysis.length, start + 60),
            taper: 10,
            extraWidth: kind === 'landing' ? 9 : 4,
          },
        ],
      }
    })
  const locate = (v: WidthOverride) => {
    p.workspace.setFeatureSelection({ alignmentId: alignment.id, kind: 'widening', id: v.id })
    p.workspace.setStation((v.start + v.end) / 2)
  }
  return (
    <RoadSection
      title="Landings & turnouts"
      help="Extra width over a station range, tapered at each end. Landings are unsurfaced; turnouts are surfaced."
      actions={
        // Manage edits what exists; with nothing yet, the section offers the add buttons instead.
        alignment.overrides.length ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            aria-label="Manage landings & turnouts"
            onClick={() => setOpen(true)}
          >
            Manage
          </Button>
        ) : undefined
      }
    >
      {alignment.overrides.length ? (
        <div className="space-y-0.5">
          {alignment.overrides.map((v) => (
            <Button
              key={v.id}
              variant="ghost"
              size="sm"
              className="h-7 w-full justify-start text-xs"
              aria-pressed={
                p.workspace.featureSelection?.alignmentId === alignment.id && p.workspace.featureSelection?.id === v.id
              }
              onClick={() => locate(v)}
            >
              {v.name} · {formatRoadStation(v.start)}–{formatRoadStation(v.end)}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">None yet.</span>
          {(['landing', 'turnout'] as const).map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={!!p.workspace.busy}
              onClick={() => {
                add(kind)
                setOpen(true)
              }}
            >
              + {kind === 'landing' ? 'Landing' : 'Turnout'}
            </Button>
          ))}
        </div>
      )}
      <RoadSettingsDialog title="Landings & turnouts" open={open} onOpenChange={setOpen} busy={!!p.workspace.busy}>
        <div className="mb-2 flex gap-1">
          <Button size="sm" variant="outline" onClick={() => add('landing')}>
            + Landing
          </Button>
          <Button size="sm" variant="outline" onClick={() => add('turnout')}>
            + Turnout
          </Button>
        </div>
        {alignment.overrides.map((v) => (
          <div key={v.id} className="mb-3 space-y-2 rounded border p-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                locate(v)
                setOpen(false)
              }}
            >
              Locate {v.name}
            </Button>
            <div className="flex gap-1">
              <input
                aria-label="Widening name"
                className={roadFieldClass}
                value={v.name}
                maxLength={200}
                onChange={(e) => tweak(v.id, { name: e.target.value })}
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label={`Duplicate ${v.name}`}
                onClick={() =>
                  updateAlignment((a) => ({
                    ...a,
                    overrides: [...a.overrides, { ...v, id: id(), name: `${v.name} copy` }],
                  }))
                }
              >
                <Copy className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label={`Remove ${v.name}`}
                onClick={() => updateAlignment((a) => ({ ...a, overrides: a.overrides.filter((x) => x.id !== v.id) }))}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Widening type">
                <RoadSelect
                  ariaLabel="Widening type"
                  className={roadFieldClass}
                  value={v.kind}
                  onValueChange={(value) => tweak(v.id, { kind: value as WidthOverride['kind'] })}
                >
                  <option value="landing">Landing · unsurfaced</option>
                  <option value="turnout">Turnout · surfaced</option>
                </RoadSelect>
              </Field>
              <Field label="Widening side">
                <RoadSelect
                  ariaLabel="Widening side"
                  className={roadFieldClass}
                  value={v.side}
                  onValueChange={(value) => tweak(v.id, { side: value as WidthOverride['side'] })}
                >
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                  <option value="both">Both</option>
                </RoadSelect>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['start', 'end', 'taper', 'extraWidth'] as const).map((key) => (
                <NumberField
                  key={key}
                  label={`${key === 'extraWidth' ? 'Extra width' : key[0].toUpperCase() + key.slice(1)} (m)`}
                  value={v[key]}
                  max={key === 'extraWidth' ? 50 : key === 'taper' ? 1000 : 100000}
                  onChange={(value) => tweak(v.id, { [key]: value })}
                />
              ))}
              <NumberField
                label="Entry taper (m)"
                value={v.entryTaperM ?? v.taper}
                min={0}
                max={Math.max(0, v.end - v.start - (v.exitTaperM ?? v.taper))}
                onChange={(entryTaperM) => tweak(v.id, { entryTaperM })}
              />
              <NumberField
                label="Exit taper (m)"
                value={v.exitTaperM ?? v.taper}
                min={0}
                max={Math.max(0, v.end - v.start - (v.entryTaperM ?? v.taper))}
                onChange={(exitTaperM) => tweak(v.id, { exitTaperM })}
              />
            </div>
            {v.end <= v.start && (
              <p role="alert" className="text-xs text-red-600">
                End station must be after start.
              </p>
            )}
          </div>
        ))}
      </RoadSettingsDialog>
    </RoadSection>
  )
}
