import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Maximize, Minimize, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { ForestryBackLink } from '@/components/dev/ForestryBackLink'
import { CommandButton, type CommandPresentation } from '@/components/interfaces/CommandButton'
import { CustomizeRibbonPane } from '@/components/interfaces/CustomizeRibbonPane'
import { InterfaceChooser } from '@/components/interfaces/InterfaceChooser'
import { RibbonPaneColumns, RibbonPaneHost } from '@/components/interfaces/RibbonTaskPane'
import { ThemeModeButton } from '@/components/interfaces/ThemeModeButton'
import { WorkspaceHeader } from '@/components/interfaces/WorkspaceHeader'
import { WorkspaceTools } from '@/components/interfaces/WorkspaceTools'
import { useRibbonPreferences } from '@/components/interfaces/ribbonPreferences'
import { useWorkflowPlacement } from '@/components/interfaces/useWorkflowPlacement'
import { useWorkspaceLayout } from '@/components/interfaces/useWorkspaceLayout'
import { workspaceFrameProps } from '@/components/interfaces/workspaceFrame'
import { layoutIcons, type CommandState } from '@/components/interfaces/workspaceKit'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { useElementFullscreen } from '@/components/ui/fullscreen-panel'
import { PanelCorner } from '@/components/ui/panel-corner'
import { StyledSelect } from '@/components/ui/form-field'
import { InlineAlert, MapSidebarShell } from '@/components/ui/map-panels'
import { useMapSketch } from '@/components/ui/map-sketch'
import { PlaybackControls } from '@/components/ui/playback-controls'
import { StepMarker } from '@/components/ui/step-section'
import { TabBar } from '@/components/ui/tab-bar'
import { TilePane, TiledWorkspace, tilePaneKey, useTilePanels } from '@/components/ui/tiled-workspace'
import { TileLayoutPicker, readSavedTileLayouts, resolveTileLayout } from '@/components/ui/tile-layout-picker'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { sketchPolygon } from '@/lib/geo/mapSketch'
import { cn } from '@/lib/utils'
import { defaults, installPacks } from '../legal-workbench/registry'
import { useLibrary } from './review/CaseReview'
import { SaveExportDialog } from './SaveExportDialog'
import type { BlockPlanningExport } from './exports'
import { addBlock, addDisturbance, addShape, setArea, setTitle } from './edits'
import { importBaseline, importBlocks, importUnit } from './imports'
import { PLANNING_STEPS, type PlanningCommand, type PlanningEditor } from './interface/commands'
import {
  DEFAULT_PLANNING_HEADER_TOOLS,
  GUIDED_INTERFACE_NAME,
  planningInterfaces,
  type PlanningInterface,
  type PlanningWidget,
} from './interface/layouts'
import { openPlanFile } from './migrate'
import { PeriodTable } from './PeriodTable'
import { emptyPlan, periodYears, samplePlan, type Plan } from './plan'
import { crossingMapFeatures } from './crossings/mapFeatures'
import { PlanMap } from './PlanMap'
import { storePlan } from './store'
import { AreaStep } from './steps/AreaStep'
import { BlocksStep } from './steps/BlocksStep'
import { CompareStep } from './steps/CompareStep'
import { ReviewStep } from './steps/ReviewStep'
import { SchedulesStep } from './steps/SchedulesStep'
import type { Drawing, ImportKind, StepProps } from './steps/types'
import { TrendChart } from './TrendChart'
import { shownResult, usePlanAnalysis } from './usePlanAnalysis'
import { useOldForestMap } from './useOldForestMap'
import { stopOldForest } from './oldForest/oldForestClient'
import { PLANNING_COLUMNS, PLANNING_WORKSPACE, type PlanningPane } from './workspace'

const failure = (e: unknown) => (e instanceof Error ? e.message : 'The file could not be read.')

export interface BlockPlannerProps {
  layouts: PlanningInterface[]
  initialInterface: PlanningInterface
  layoutsFallback: boolean
  initialPlan: Plan
  /** What changed to open the stored plan, or why it could not be opened. */
  initialNotes: string[]
  storageBroken: boolean
}

export default function BlockPlanner({
  layouts,
  initialInterface,
  layoutsFallback,
  initialPlan,
  initialNotes,
  storageBroken,
}: BlockPlannerProps) {
  // --- The plan and what is shown ------------------------------------------------------------
  const [plan, setPlan] = useState(initialPlan)
  const edit = useCallback((change: (plan: Plan) => Plan) => setPlan((current) => change(current)), [])
  const [notes, setNotes] = useState(initialNotes)
  const [saveError, setSaveError] = useState(
    storageBroken
      ? 'The stored plan could not be opened, so nothing is saved in this browser until you open or start a plan.'
      : '',
  )
  const [saving, setSaving] = useState(!storageBroken)
  const [selectedBlock, setSelectedBlock] = useState<string | null>(initialPlan.blocks[0]?.id ?? null)
  const [shownState, setShownState] = useState({
    schedule: initialPlan.reviewSchedule,
    year: initialPlan.area.startYear,
  })
  const years = periodYears(plan.area.startYear)
  const shown = {
    schedule: plan.schedules.some((s) => s.id === shownState.schedule) ? shownState.schedule : plan.reviewSchedule,
    year: years.includes(shownState.year) ? shownState.year : years[0],
  }
  const setShown = useCallback(
    (next: { schedule?: string; year?: number }) => setShownState((current) => ({ ...current, ...next })),
    [],
  )
  const [fitKey, setFitKey] = useState(0)
  const [playing, setPlaying] = useState(false)
  const analysis = usePlanAnalysis(plan, shown)
  // The old forest layer is the session's: never written to the plan or its record.
  const [oldForestMapOn, setOldForestMapOn] = useState(false)
  const oldForestMap = useOldForestMap(plan, shown, oldForestMapOn)
  // The page's one old forest worker (panel and map) goes with the page.
  useEffect(() => () => stopOldForest(), [])
  const result = shownResult(analysis)
  const patches =
    result?.shown.schedule === shown.schedule && result.shown.year === shown.year ? result.shown.patches : undefined

  useEffect(() => {
    if (!saving) return
    const timer = window.setTimeout(() => {
      storePlan(plan)
        .then(() => setSaveError(''))
        .catch(() => setSaveError('This browser did not keep the plan. Save the plan file to keep a copy.'))
    }, 400)
    return () => window.clearTimeout(timer)
  }, [plan, saving])

  const replacePlan = (next: Plan, nextNotes: string[] = []) => {
    setPlan(next)
    setNotes(nextNotes)
    setSaving(true)
    setSelectedBlock(next.blocks[0]?.id ?? null)
    setShownState({ schedule: next.reviewSchedule, year: next.area.startYear })
    setFitKey((k) => k + 1)
  }
  const confirmReplace = () =>
    !(plan.blocks.length || plan.baseline.length) ||
    window.confirm('Replace the plan in this browser? Save the plan file first to keep a copy.')

  // --- Drawing ---------------------------------------------------------------------------------
  const sketch = useMapSketch()
  const [drawing, setDrawing] = useState<Drawing | null>(null)
  const startDrawing = (kind: Drawing) => {
    if (drawing === kind) {
      sketch.clear()
      setDrawing(null)
      return
    }
    if (kind === 'shape' && !selectedBlock) return
    setDrawing(kind)
    sketch.start('polygon')
  }
  useEffect(() => {
    if (sketch.state.mode !== 'complete' || !drawing) return
    const geometry = sketchPolygon(sketch.state.points)
    sketch.clear()
    setDrawing(null)
    if (!geometry) return
    if (drawing === 'block') {
      const made = addBlock(plan, '', geometry)
      setPlan(made.plan)
      setSelectedBlock(made.id)
    } else if (drawing === 'shape' && selectedBlock) {
      setPlan(addShape(plan, selectedBlock, '', geometry).plan)
    } else if (drawing === 'disturbance') {
      setPlan(
        addDisturbance(plan, {
          name: `Disturbance ${plan.baseline.length + 1}`,
          kind: 'harvest',
          year: plan.area.startYear - 5,
          yearBasis: 'editor-default',
          geometry,
        }).plan,
      )
    }
    // Commit once, when the sketch completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketch.state.mode])

  // --- Files -----------------------------------------------------------------------------------
  const planFileInput = useRef<HTMLInputElement>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const [importKind, setImportKind] = useState<ImportKind>('blocks')
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  async function openPlan(file: File) {
    try {
      const opened = openPlanFile(JSON.parse(await file.text()))
      if (opened.plan.packs.length) await installPacks(opened.plan.packs)
      if (!confirmReplace()) return
      replacePlan(opened.plan, opened.notes)
      setNotice({ text: `Opened ${file.name}.` })
    } catch (e) {
      setNotice({ text: failure(e), error: true })
    }
  }
  async function importFiles(kind: ImportKind, files: File[]) {
    const file = files[0]
    if (!file) return
    try {
      const data: unknown = JSON.parse(await file.text())
      if (kind === 'blocks') {
        const made = importBlocks(plan, data, file.name)
        setPlan(made.plan)
        setSelectedBlock(made.added[0] ?? selectedBlock)
        setNotice({ text: `Added ${made.added.length} block(s) from ${file.name}.` })
      } else if (kind === 'baseline') {
        const made = importBaseline(plan, data, file.name, plan.area.startYear - 5)
        setPlan(made.plan)
        setNotice({
          text:
            `Added ${made.added} past disturbance(s) from ${file.name}.` +
            (made.assumed ? ` ${made.assumed} had no year; ${plan.area.startYear - 5} is assumed and marked.` : ''),
        })
      } else if (kind === 'unit') {
        const unit = importUnit(data, file.name)
        setPlan((p) => setArea(p, { unit }))
        setNotice({ text: `Loaded the unit boundary from ${file.name}. Read past disturbances from DataBC in step 1.` })
      } else {
        const { readZones } = await import('./riparian')
        const zones = readZones(data, file.name)
        setPlan((p) => ({ ...p, zones }))
        setNotice({ text: `Loaded riparian zones from ${file.name}.` })
      }
      setFitKey((k) => k + 1)
    } catch (e) {
      setNotice({ text: failure(e), error: true })
    }
  }
  const [exportOpen, setExportOpen] = useState(false)
  const [exportStart, setExportStart] = useState<BlockPlanningExport | undefined>()
  const library = useLibrary(defaults)
  // The schedule on the map's crossings, each by its own standing; recomputed with the plan.
  const crossingMap = useMemo(() => crossingMapFeatures(plan, shown.schedule, library), [plan, shown.schedule, library])

  // --- Interface -------------------------------------------------------------------------------
  const {
    active,
    selectLayout: selectInterface,
    layoutSelection,
    setLayoutSelection,
    collapsed,
    setCollapsed,
  } = useWorkspaceLayout(initialInterface, {
    defaultPane: 'map' as PlanningPane,
    storeInterface: planningInterfaces.storeInterface,
  })
  const [choosingInterface, setChoosingInterface] = useState(false)
  const [customizingRibbon, setCustomizingRibbon] = useState(false)
  const [paneHost, setPaneHost] = useState<HTMLDivElement | null>(null)
  const [taskPaneDocked, setTaskPaneDocked] = useState(false)
  const ribbonPreferences = useRibbonPreferences(active)
  const toolbar = ribbonPreferences.toolbar
  const {
    groupName,
    workflow: step,
    inRibbon,
    selectGroup,
    folded,
    toggleFold,
    minimized,
    toggleMinimized,
    selectWorkflow,
    editorHost,
    attachEditor,
  } = useWorkflowPlacement(active, false, (initialPlan.blocks.length ? 'compare' : 'area') as PlanningEditor)
  const workspaceRoot = useElementFullscreen<HTMLDivElement>()
  const phone = useMediaQuery('(max-width: 767px)')
  const [savedLayouts, setSavedLayouts] = useState(() => readSavedTileLayouts(PLANNING_WORKSPACE))
  const workspaceLayout = resolveTileLayout(PLANNING_WORKSPACE, layoutSelection, savedLayouts)
  const [hiddenPanes, setHiddenPanes, restorePreset] = useTilePanels(
    PLANNING_WORKSPACE,
    workspaceLayout.storageId,
    workspaceLayout.base,
  )
  const [phonePane, setPhonePane] = useState<PlanningPane>('map')
  const selectLayout = (value: string, saved = savedLayouts) => {
    const next = resolveTileLayout(PLANNING_WORKSPACE, value, saved)
    setLayoutSelection(value)
    if (!value.startsWith('saved:')) restorePreset(next.base)
  }

  // Playback steps through the periods; it stops at the last.
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      setShownState((current) => {
        const i = years.indexOf(current.year)
        if (i >= years.length - 1) {
          setPlaying(false)
          return current
        }
        return { ...current, year: years[i + 1] }
      })
    }, 900)
    return () => window.clearInterval(timer)
  }, [playing, years])

  const yearIndex = years.indexOf(shown.year)
  function runCommand(id: PlanningCommand) {
    switch (id) {
      case 'controls':
        return setCollapsed(!collapsed)
      case 'newPlan':
        if (confirmReplace()) replacePlan(emptyPlan())
        return
      case 'openSample':
        if (confirmReplace()) replacePlan(samplePlan(), ['Opened the synthetic Prince George sample.'])
        return
      case 'open':
        return planFileInput.current?.click()
      case 'export':
        setExportStart(undefined)
        return setExportOpen(true)
      case 'area':
      case 'blocks':
      case 'schedules':
      case 'compare':
      case 'review':
        setCollapsed(false)
        return selectWorkflow(id)
      case 'drawBlock':
        selectWorkflow('blocks', { reveal: false })
        return startDrawing('block')
      case 'drawShape':
        selectWorkflow('blocks', { reveal: false })
        return startDrawing('shape')
      case 'drawDisturbance':
        selectWorkflow('area', { reveal: false })
        return startDrawing('disturbance')
      case 'importBlocks':
      case 'importBaseline':
      case 'importZones':
        setImportKind(id === 'importBlocks' ? 'blocks' : id === 'importBaseline' ? 'baseline' : 'zones')
        return importInput.current?.click()
      case 'fitAll':
        return setFitKey((k) => k + 1)
      case 'oldForestMap':
        return setOldForestMapOn(!oldForestMapOn)
      case 'previousPeriod':
        return setShown({ year: years[Math.max(0, yearIndex - 1)] })
      case 'nextPeriod':
        return setShown({ year: years[Math.min(years.length - 1, yearIndex + 1)] })
      case 'customizeRibbon':
        return setCustomizingRibbon(true)
      case 'chooseInterface':
        return setChoosingInterface(true)
      case 'fullscreen':
        return workspaceRoot.toggle()
    }
  }
  const empty = !plan.blocks.length && !plan.baseline.length
  const commandStates: Partial<Record<PlanningCommand, CommandState>> = {
    controls: { pressed: !collapsed },
    area: { pressed: step === 'area' },
    blocks: { pressed: step === 'blocks' },
    schedules: { pressed: step === 'schedules' },
    compare: { pressed: step === 'compare' },
    review: { pressed: step === 'review' },
    drawBlock: {
      pressed: drawing === 'block',
      label: drawing === 'block' ? 'Finish block' : undefined,
      disabled: drawing !== null && drawing !== 'block',
      reason: 'Finish or cancel the drawing on the map first.',
    },
    drawShape: {
      pressed: drawing === 'shape',
      disabled: !selectedBlock || (drawing !== null && drawing !== 'shape'),
      reason: selectedBlock ? 'Finish or cancel the drawing on the map first.' : 'Select a block first.',
    },
    drawDisturbance: {
      pressed: drawing === 'disturbance',
      disabled: drawing !== null && drawing !== 'disturbance',
      reason: 'Finish or cancel the drawing on the map first.',
    },
    fitAll: { disabled: empty, reason: 'The plan has nothing to frame yet.' },
    oldForestMap: {
      pressed: oldForestMapOn,
      disabled: !plan.checks?.oldForest && !oldForestMapOn,
      reason: 'Calculate old and old interior forest in Compare first.',
    },
    previousPeriod: { disabled: yearIndex <= 0 },
    nextPeriod: { disabled: yearIndex >= years.length - 1 },
    customizeRibbon: { hidden: !toolbar },
    chooseInterface: { hidden: layouts.length < 2 },
    fullscreen: { label: workspaceRoot.fullscreen ? 'Exit full screen' : undefined, pressed: workspaceRoot.fullscreen },
  }
  const InterfaceIcon = layoutIcons[active.icon]
  const interfaceSwitch = (surface: 'header' | 'toolbar') => (
    <CommandButton
      id="chooseInterface"
      surface={surface}
      state={commandStates.chooseInterface}
      presentation={{
        ariaLabel: `${active.shortName ?? active.name}, switch workspace interface`,
        title: `Switch workspace · ${active.name}`,
        captionFrom: 'lg',
        caption: active.shortName ?? active.name,
        icon: (
          <InterfaceIcon className={surface === 'toolbar' ? 'size-4' : 'size-4 lg:mr-1 lg:size-3'} aria-hidden="true" />
        ),
      }}
      onRun={runCommand}
    />
  )
  const scheduleName = plan.schedules.find((s) => s.id === shown.schedule)?.name ?? ''
  const widgets: Partial<Record<PlanningWidget, ReactNode>> = {
    projectInfo: (
      <div className="lp-project-field">
        <h1>Block planning</h1>
        <span className="truncate text-xs text-muted-foreground">
          {plan.area.ndu ? `${plan.area.district} · ${plan.area.ndu}` : 'No reporting unit yet'}
        </span>
      </div>
    ),
    schedulePicker: (
      <StyledSelect
        aria-label="Schedule on the map"
        className="h-7 w-44 text-xs"
        value={shown.schedule}
        onValueChange={(schedule) => setShown({ schedule })}
        options={plan.schedules.map((s) => ({ value: s.id, label: s.name }))}
      />
    ),
    periodPicker: (
      <StyledSelect
        aria-label="Year on the map"
        className="h-7 w-24 text-xs"
        value={String(shown.year)}
        onValueChange={(year) => setShown({ year: Number(year) })}
        options={years.map((y) => ({ value: String(y), label: String(y) }))}
      />
    ),
    presets: phone ? null : (
      <TileLayoutPicker
        config={PLANNING_WORKSPACE}
        selection={layoutSelection}
        onSelect={selectLayout}
        saved={savedLayouts}
        onSaved={setSavedLayouts}
        hiddenPanels={hiddenPanes}
        onHiddenPanels={setHiddenPanes}
        size={toolbar ? 'ribbon' : 'toolbar'}
        showButtonLabel={!!toolbar}
        selectLabel="Block planning layout"
        dialogTestId="block-planning-layouts-dialog"
      />
    ),
    interfaceSwitch: interfaceSwitch(toolbar ? 'toolbar' : 'header'),
  }
  const presentations: Partial<Record<PlanningCommand, CommandPresentation>> = {
    controls: {
      ariaLabel: `${collapsed ? 'Show' : 'Hide'} planning steps`,
      captionFrom: 'xl',
      shortLabel: 'Steps',
      expanded: !collapsed,
      icon: collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />,
    },
    open: { captionFrom: 'lg', shortLabel: 'Open' },
    export: { captionFrom: 'lg', emphasis: 'primary' },
    fullscreen: {
      ariaLabel: `${workspaceRoot.fullscreen ? 'Exit full screen' : 'Full screen'} block planning workspace`,
      icon: workspaceRoot.fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />,
    },
  }
  const status = notice ?? (saveError ? { text: saveError, error: true } : null)
  const headerChrome = toolbar ? (
    <>
      <WorkspaceTools
        key={active.id}
        toolbar={toolbar}
        groupName={groupName}
        folded={folded}
        onToggleFold={toggleFold}
        minimized={minimized}
        onToggleMinimized={toggleMinimized}
        onGroupChange={selectGroup}
        onReorderTabs={(labels) => ribbonPreferences.reorderTabs(labels)}
        editorsAvailable
        editorHost={editorHost}
        editorMount={inRibbon ? attachEditor : undefined}
        disabled={false}
        states={commandStates}
        // A side guide sits under the header, which keeps the way back and the switcher.
        leading={toolbar.dock === 'top' && <ForestryBackLink />}
        narrowMenu={toolbar.dock === 'top' ? ['chooseInterface'] : undefined}
        switcher={
          toolbar.dock === 'top' && (
            <>
              {interfaceSwitch('toolbar')}
              <ThemeModeButton />
            </>
          )
        }
        widgets={widgets}
        onCommand={runCommand}
      />
      {customizingRibbon && ribbonPreferences.defaults && (
        <CustomizeRibbonPane
          toolbar={toolbar}
          defaults={ribbonPreferences.defaults}
          states={commandStates}
          currentTab={groupName}
          onClose={() => setCustomizingRibbon(false)}
          onApply={(draft) => {
            ribbonPreferences.save(draft)
            setCustomizingRibbon(false)
          }}
        />
      )}
    </>
  ) : null
  const header = (
    <div className="px-3">
      <WorkspaceHeader
        heading={
          <div className="flex min-w-0 items-center gap-1">
            <ForestryBackLink />
            <h1 className="truncate text-sm font-semibold">Block planning</h1>
          </div>
        }
        crumb={
          plan.area.ndu && (
            <span className="min-w-0 truncate text-sm text-muted-foreground">
              {plan.area.district} · {plan.area.ndu}
            </span>
          )
        }
        status={
          status ? (
            <span
              role={status.error ? 'alert' : 'status'}
              className={cn('truncate text-2xs', status.error ? 'text-danger' : 'text-foreground')}
              title={status.text}
            >
              {status.text}
            </span>
          ) : (
            <span className="truncate text-2xs text-muted-foreground">
              {scheduleName} · {shown.year}
            </span>
          )
        }
        projectInfo={<span className="text-xs">Block planning</span>}
        tools={active.headerTools ?? DEFAULT_PLANNING_HEADER_TOOLS}
        widgets={widgets}
        states={commandStates}
        presentations={presentations}
        onCommand={runCommand}
      />
    </div>
  )
  // A side guide keeps the header, so the plan's name and Save stay in view.
  const sideGuide = toolbar?.dock === 'side'
  const topChrome = toolbar && !sideGuide ? headerChrome : header

  // --- Steps -----------------------------------------------------------------------------------
  const stepProps: StepProps = {
    plan,
    edit,
    selectedBlock,
    selectBlock: setSelectedBlock,
    drawing,
    startDrawing,
    importFiles,
    shown,
    setShown,
    analysis,
    oldForestMapOn,
    setOldForestMapOn,
    onCommand: runCommand,
    openExport: (output) => {
      setExportStart(output)
      setExportOpen(true)
    },
  }
  const stepStatus = (id: PlanningEditor): 'done' | 'current' | 'todo' => {
    const done = {
      area: !!plan.area.district && !!plan.area.ndu,
      blocks: plan.blocks.length > 0,
      schedules: plan.schedules.length > 1 && plan.blocks.length > 0,
      compare: analysis.status === 'ready',
      review: Object.keys(plan.reviews).length > 0 || Boolean(plan.rangeReviews?.length || plan.landscape.rationale),
    }[id]
    return id === step ? 'current' : done ? 'done' : 'todo'
  }
  const steps = (
    <MapSidebarShell
      title="Planning steps"
      headerClassName="sr-only"
      density="compact"
      data-testid="block-planning-steps"
    >
      {notes.length > 0 && (
        <InlineAlert tone="info" title="Opened with changes">
          <ul className="list-disc pl-4">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <button type="button" className="mt-1 text-xs underline" onClick={() => setNotes([])}>
            Dismiss
          </button>
        </InlineAlert>
      )}
      {drawing && (
        <InlineAlert
          tone="info"
          title={
            drawing === 'disturbance'
              ? 'Drawing a past disturbance'
              : drawing === 'shape'
                ? 'Drawing another shape'
                : 'Drawing a block'
          }
        >
          Click the map to place corners; click the first corner or double-click to finish. Backspace takes the last
          corner back.{' '}
          <button type="button" className="underline" onClick={() => startDrawing(drawing)}>
            Cancel
          </button>
        </InlineAlert>
      )}
      <div hidden={inRibbon} className="sticky top-0 z-10 border-b border-border bg-background/95 p-1.5 backdrop-blur">
        <TabBar
          label="Planning steps"
          stretch
          stacked
          idPrefix="planning-steps"
          value={step}
          onChange={(value) => selectWorkflow(value as PlanningEditor)}
          activeClassName="font-semibold"
          options={PLANNING_STEPS.map((s) => ({
            value: s.id,
            label: s.label,
            marker: <StepMarker step={s.number} status={stepStatus(s.id)} className="h-4 w-4 text-3xs" />,
          }))}
          getTabProps={(option) => ({ title: PLANNING_STEPS.find((s) => s.id === option.value)?.title })}
        />
      </div>
      {PLANNING_STEPS.map((s) => (
        <section key={s.id} hidden={step !== s.id} aria-label={s.title} data-planning-step={s.id} className="space-y-1">
          {s.id === 'area' && <AreaStep {...stepProps} />}
          {s.id === 'blocks' && <BlocksStep {...stepProps} />}
          {s.id === 'schedules' && <SchedulesStep {...stepProps} />}
          {s.id === 'compare' && <CompareStep {...stepProps} />}
          {s.id === 'review' && <ReviewStep {...stepProps} />}
        </section>
      ))}
    </MapSidebarShell>
  )

  // --- Views -----------------------------------------------------------------------------------
  const resultsPlaceholder =
    analysis.status === 'not-ready' ? (
      <InlineAlert tone="info">{analysis.reason}</InlineAlert>
    ) : analysis.status === 'failed' ? (
      <InlineAlert tone="error">{analysis.error}</InlineAlert>
    ) : (
      <InlineAlert loading>Calculating the young-forest patches…</InlineAlert>
    )
  const panes = {
    map: (
      <TilePane title={`Map · ${scheduleName} · ${shown.year}`}>
        {() => (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-md">
              <PlanMap
                plan={plan}
                schedule={shown.schedule}
                year={shown.year}
                patches={patches}
                selectedBlock={selectedBlock}
                onSelectBlock={setSelectedBlock}
                sketch={sketch}
                drawing={drawing}
                fitKey={fitKey}
                oldForest={oldForestMapOn ? oldForestMap : null}
                crossings={crossingMap}
              />
            </div>
            <PlaybackControls
              frame={Math.max(0, yearIndex)}
              frameCount={years.length}
              onFrameChange={(i) => setShown({ year: years[i] })}
              playing={playing}
              onPlayingChange={setPlaying}
              frameLabel={String(shown.year)}
              label="Projection year"
            />
          </div>
        )}
      </TilePane>
    ),
    trend: (
      <TilePane title="Patch classes over time">
        {() =>
          result ? (
            <TrendChart plan={plan} result={result} year={shown.year} />
          ) : (
            <div className="p-2">{resultsPlaceholder}</div>
          )
        }
      </TilePane>
    ),
    table: (
      <TilePane title="Periods and schedules">
        {() =>
          result ? (
            <PeriodTable plan={plan} result={result} year={shown.year} />
          ) : (
            <div className="p-2">{resultsPlaceholder}</div>
          )
        }
      </TilePane>
    ),
  }
  const phoneOptions = PLANNING_WORKSPACE.panes.map((p) => ({ value: p.id, label: p.label }))
  const body = (
    <MapSectionLayout
      className="bg-transparent"
      sidebar={inRibbon ? null : <div className="contents" ref={attachEditor} />}
      disableSidebar={inRibbon}
      showDesktopSidebar={!collapsed}
      onToggleDesktopSidebar={() => setCollapsed(!collapsed)}
      desktopSidebarWidth={400}
      mobileInitialSheetState="full"
      mobileSnapTo={drawing ? 'collapsed' : 'full'}
      mobileSnapKey={drawing ? 'drawing' : 'steps'}
      mobilePeekTitle="Block planning"
    >
      <div className="flex h-full min-h-0 flex-col gap-2 p-2 md:pt-0" data-testid="block-planning-workspace">
        {phone && (
          <TabBar
            label="Visible view"
            value={phonePane}
            onChange={(v) => setPhonePane(v as PlanningPane)}
            options={phoneOptions}
            stretch
          />
        )}
        <div className="flex min-h-0 flex-1">
          <TiledWorkspace
            columns={PLANNING_COLUMNS}
            hidden={phone ? [] : hiddenPanes}
            focusedPane={phone ? phonePane : undefined}
            storageKey={(split) => tilePaneKey(PLANNING_WORKSPACE.namespace, workspaceLayout.storageId, split)}
            contents={panes}
          />
        </div>
      </div>
    </MapSectionLayout>
  )

  return (
    <RibbonPaneHost.Provider value={{ slot: paneHost, docked: taskPaneDocked, onDockChange: setTaskPaneDocked }}>
      <div
        ref={workspaceRoot.ref}
        {...workspaceFrameProps(active)}
        data-fullscreen={workspaceRoot.fullscreen || undefined}
        data-testid="block-planning-interface"
        className={cn(
          'lp-workspace relative flex h-full min-h-0 flex-col gap-2 overflow-hidden pt-1.5',
          toolbar && !sideGuide && 'max-md:!pt-[calc(env(safe-area-inset-top)+var(--app-navbar-offset,4rem))]',
          '[&[data-fullscreen]]:fixed [&[data-fullscreen]]:inset-0 [&[data-fullscreen]]:z-menu [&[data-fullscreen]]:h-dvh [&[data-fullscreen]]:bg-background',
        )}
      >
        {topChrome}
        {layoutsFallback && (
          <p role="status" className="shrink-0 truncate px-3 text-2xs text-warning">
            Workspace layouts could not be loaded: using the built-in {GUIDED_INTERFACE_NAME}.
          </p>
        )}
        <SaveExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          plan={plan}
          result={analysis.status === 'ready' ? analysis.result : undefined}
          running={analysis.status === 'running'}
          library={library}
          onTitle={(title) => edit((p) => setTitle(p, title))}
          startAt={exportStart}
        />
        {choosingInterface && (
          <InterfaceChooser
            layouts={layouts}
            current={active}
            onCancel={() => setChoosingInterface(false)}
            onChoose={(next) => {
              setChoosingInterface(false)
              setCustomizingRibbon(false)
              selectInterface(next)
            }}
          />
        )}
        <input
          ref={planFileInput}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Open a plan file"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void openPlan(file)
          }}
        />
        <input
          ref={importInput}
          type="file"
          accept=".geojson,.json,application/json"
          hidden
          aria-label="Import a GeoJSON file"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            void importFiles(importKind, files)
          }}
        />
        <div className={sideGuide ? 'lp-guided-frame' : 'lp-canvas-frame'}>
          {sideGuide && (
            <div className={active.panelFrame?.resizeCorners ? 'lp-guide-window' : 'contents'}>
              {headerChrome}
              {active.panelFrame?.resizeCorners && (
                <PanelCorner
                  storageKey={tilePaneKey(PLANNING_WORKSPACE.namespace, 'interface', 'guide-corner')}
                  label="planning guide"
                />
              )}
            </div>
          )}
          <RibbonPaneColumns
            viewsLabel="block planning views"
            docked={taskPaneDocked}
            storageKey={tilePaneKey(PLANNING_WORKSPACE.namespace, 'interface', `task-column:${active.id}`)}
            slotRef={setPaneHost}
          >
            <div className="flex h-full min-h-0 min-w-0 flex-1">{body}</div>
          </RibbonPaneColumns>
        </div>
        {createPortal(steps, editorHost)}
      </div>
    </RibbonPaneHost.Provider>
  )
}
