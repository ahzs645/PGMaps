import { useState } from 'react'
import { ArrowRight, Copy, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, NumberField, roadFieldClass } from '../Controls'
import { formatRoadStation } from '../Charts'
import { CURVE_DESIGN_HELP, CurveDesignControls } from '../CurveTools'
import { RoadSettingsDialog } from '../RoadSettingsDialog'
import { TemplateComponents } from '../TemplateComponents'
import { RoadSection } from '../SidebarParts'
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
  return (
    <>
      <RoadSection
        title="Road cross-section"
        help="Formation geometry is a crown, a cut-side ditch and batters that run out to meet the ground. Flatter batters (a larger H:V) reach further, so a high fill or deep cut needs more section reach. The surfacing layer is a separate quantity. Batters and costs are editable planning assumptions."
      >
        <div className="grid grid-cols-2 items-end gap-2">
          {TEMPLATE_FIELDS.map(([key, label, min, max]) => (
            <NumberField
              key={key}
              label={label}
              value={alignment.template[key] ?? 0}
              min={min}
              max={max}
              onChange={(value) => updateAlignment((a) => ({ ...a, template: { ...a.template, [key]: value } }))}
            />
          ))}
        </div>
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
      <RoadSection title="Template components">
        <TemplateComponents
          template={alignment.template}
          materials={alignment.engineering?.materials}
          features={p.workspace.project.context}
          surfaces={p.workspace.project.terrain.referenceSurfaces}
          onChange={(template) => updateAlignment((a) => ({ ...a, template }))}
        />
      </RoadSection>
      <RoadSection title="Superelevation & widening" help={CURVE_DESIGN_HELP}>
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
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          aria-label="Manage landings & turnouts"
          onClick={() => setOpen(true)}
        >
          Manage
        </Button>
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
        <p className="text-xs text-muted-foreground">None on this road.</p>
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
                <select
                  className={roadFieldClass}
                  value={v.kind}
                  onChange={(e) => tweak(v.id, { kind: e.target.value as WidthOverride['kind'] })}
                >
                  <option value="landing">Landing · unsurfaced</option>
                  <option value="turnout">Turnout · surfaced</option>
                </select>
              </Field>
              <Field label="Widening side">
                <select
                  className={roadFieldClass}
                  value={v.side}
                  onChange={(e) => tweak(v.id, { side: e.target.value as WidthOverride['side'] })}
                >
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                  <option value="both">Both</option>
                </select>
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
