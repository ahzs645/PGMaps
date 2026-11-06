import { StepMarker, type StepStatus } from '@/components/ui/step-section'
import { ForestryBackLink } from '@/components/dev/ForestryBackLink'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useState } from 'react'
import { TreePine } from 'lucide-react'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { Button } from '@/components/ui/button'
import { FormField, NativeSelect, NumberField } from '@/components/ui/form-field'
import { InlineAlert, MapSidebarShell, SidebarSection } from '@/components/ui/map-panels'
import { TabBar } from '@/components/ui/tab-bar'
import { InputsPanel } from './dev-thlb/InputsPanel'
import { ResultsPanel } from './dev-thlb/ResultsPanel'
import { ThlbMap } from './dev-thlb/ThlbMap'
import { inputSignature, useAnalysis } from './dev-thlb/useAnalysis'
import { useInputs } from './dev-thlb/useInputs'
import type { Settings } from './dev-thlb/types'

type Tab = 'inputs' | 'settings' | 'results'

export default function DevThlbImpact() {
  const inputs = useInputs()
  const analysis = useAnalysis()
  const [tab, setTab] = useState<Tab>('inputs')
  const [selected, setSelected] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>({ matureAge: 80, reductionPercent: null, demo: false })
  useDocumentTitle('THLB impact · PGMaps')
  const stale = !!analysis.result && analysis.signature !== inputSignature(inputs.entries, settings)
  const ready =
    inputs.pending === 0 &&
    inputs.entries.every((entry) => entry.status === 'ready') &&
    inputs.entries.some((entry) => entry.role === 'areas') &&
    inputs.entries.some((entry) => entry.role === 'official' || entry.role === 'proxy')
  const current = !!analysis.result && !stale
  const statuses: Record<Tab, StepStatus> = {
    inputs: ready ? 'done' : 'current',
    settings: current ? 'done' : ready ? 'current' : 'todo',
    results: current ? 'done' : analysis.busy ? 'current' : 'todo',
  }
  const run = (next = settings) => {
    setSelected(null)
    setTab('results')
    void analysis.run(inputs.entries, next)
  }
  const panel = (id: Tab) => ({
    role: 'tabpanel' as const,
    id: `thlb-panel-${id}`,
    'aria-labelledby': `thlb-tab-${id}`,
    hidden: tab !== id,
  })
  const sidebar = (
    <MapSidebarShell
      title="THLB impact"
      subtitle="Harvestable hectares within proposed areas"
      icon={TreePine}
      actions={<ForestryBackLink />}
      density="compact"
      className={MAP_SIDEBAR_CLASS}
    >
      <div className="border-b bg-background px-3 py-3">
        <p className="mb-3 text-xs leading-5 text-muted-foreground">
          Intersect assessment polygons with official and proxy THLB. Review source coverage, weighted hectares and
          optional forest-age and deferral breakdowns.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={analysis.busy || inputs.pending > 0}
            data-thlb-demo
            onClick={() => {
              const next = { ...settings, demo: true }
              setSettings(next)
              run(next)
            }}
          >
            Run synthetic example
          </Button>
          {settings.demo && (
            <Button
              size="sm"
              variant="outline"
              disabled={analysis.busy}
              onClick={() => {
                setSettings((current) => ({ ...current, demo: false }))
                setTab('inputs')
              }}
            >
              Use my files
            </Button>
          )}
        </div>
        {settings.demo && (
          <InlineAlert tone="warning" className="mt-3">
            Synthetic example mode. Imported files are ignored until you choose “Use my files”.
          </InlineAlert>
        )}
      </div>
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-2 pt-1 backdrop-blur">
        <TabBar
          label="THLB analysis steps"
          variant="underline"
          stretch
          stacked
          idPrefix="thlb"
          className="border-b-0"
          value={tab}
          onChange={setTab}
          options={(
            [
              ['inputs', 'Inputs', 1],
              ['settings', 'Assumptions', 2],
              ['results', 'Results', 3],
            ] as const
          ).map(([value, label, step]) => ({
            value,
            label,
            marker: <StepMarker step={step} status={statuses[value]} className="h-5 w-5 text-[11px]" />,
          }))}
          getTabProps={(option) => ({ 'data-thlb-tab': option.value })}
        />
      </div>
      <div {...panel('inputs')}>
        <InputsPanel inputs={inputs} disabled={analysis.busy} />
      </div>
      <div {...panel('settings')}>
        <SidebarSection title="Analysis assumptions">
          <fieldset disabled={analysis.busy} className="space-y-4">
            <NumberField
              label="Mature age threshold (assumption)"
              value={settings.matureAge}
              onValueChange={(value) => setSettings((current) => ({ ...current, matureAge: value }))}
              min={0}
              step={1}
              updateOn="change"
              clampOn="commit"
              unit="years"
              description="Defaults to 80 years. Confirm the appropriate threshold for your TSA and purpose. Uses the imported age as recorded."
            />
            <FormField label="Impact measure">
              <NativeSelect
                value={settings.reductionPercent === null ? 'affected' : 'scenario'}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    reductionPercent: event.target.value === 'affected' ? null : 100,
                  }))
                }
              >
                <option value="affected">Affected THLB hectares only</option>
                <option value="scenario">Apply an assumed reduction rate</option>
              </NativeSelect>
            </FormField>
            {settings.reductionPercent !== null && (
              <NumberField
                label="Assumed THLB reduction"
                value={settings.reductionPercent}
                onValueChange={(value) => setSettings((current) => ({ ...current, reductionPercent: value }))}
                min={0}
                max={100}
                step={1}
                updateOn="change"
                clampOn="commit"
                unit="%"
                description="100% represents a non-harvest scenario. A lower rate is a uniform conditional-harvest assumption, not a measured timber-supply effect."
              />
            )}
          </fieldset>
        </SidebarSection>
        <SidebarSection title="How hectares are counted">
          <p className="text-xs leading-5 text-muted-foreground">
            Each intersected piece contributes its BC Albers area × THLB factor. Official data takes precedence,
            including zero and missing factors. Proxy data fills uncovered ground. No source means unknown. The combined
            total uses the union of assessment areas.
          </p>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Proxy THLB supports strategic planning. It does not replace an operational assessment or the THLB used in a
            specific AAC determination. Old-growth deferral overlap does not itself establish a harvest prohibition.
          </p>
        </SidebarSection>
      </div>
      <div {...panel('results')}>
        <SidebarSection title="Run analysis">
          <div className="flex gap-2">
            <Button
              disabled={analysis.busy || inputs.pending > 0 || (!settings.demo && !ready)}
              onClick={() => run()}
              data-thlb-run
            >
              {analysis.busy ? 'Running…' : analysis.result ? 'Run again' : 'Run analysis'}
            </Button>
            {analysis.busy && (
              <Button variant="outline" onClick={analysis.cancel}>
                Cancel
              </Button>
            )}
          </div>
          {!ready && !settings.demo && (
            <p className="mt-2 text-xs text-muted-foreground">
              Add assessment areas and at least one official or proxy THLB dataset.
            </p>
          )}
          {analysis.message && (
            <p role="status" className="mt-3 text-xs text-muted-foreground">
              {analysis.message}
            </p>
          )}
          {analysis.error && (
            <InlineAlert tone="error" className="mt-3">
              {analysis.error}
            </InlineAlert>
          )}
          {stale && (
            <InlineAlert tone="warning" className="mt-3">
              Inputs or assumptions changed. Run again before exporting.
            </InlineAlert>
          )}
        </SidebarSection>
        {analysis.result && (
          <ResultsPanel
            result={analysis.result}
            stale={stale || analysis.busy || inputs.pending > 0}
            selected={selected}
            onSelect={setSelected}
          />
        )}
      </div>
    </MapSidebarShell>
  )
  return (
    <MapSectionLayout
      sidebar={sidebar}
      desktopSidebarWidth={420}
      mobilePeekTitle="THLB impact"
      mobilePeekSubtitle={analysis.busy ? analysis.message : 'Assessment areas and harvestable hectares'}
    >
      <ThlbMap result={analysis.result} selected={selected} onSelect={setSelected} />
    </MapSectionLayout>
  )
}
