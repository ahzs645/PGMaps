import { TabBar } from '@/components/ui/tab-bar'
import { LidarDownloads, LidarMethods, LidarResults } from './AnalysisPanels'
import { RoofInspectionPanel } from './RoofInspectionPanel'

import { featureCentre } from './analysisWorkflows'
import { WorkflowPanel } from './WorkflowPanel'

import { LidarMapSettings } from './LidarMapSettings'
import type { LidarController } from './useLidarWorkspace'

/** The sidebar's tabs, which stay put above its scrolling panels. */
export function LidarSidebarTabs({ controller }: { controller: LidarController }) {
  const { tab, setTab, analysisOptions, setWorkflowsRequested, startAnalysis, tool } = controller
  const panelTabs = [
    ...(tool?.modes.length ? [{ value: 'analysis', label: 'Analyze' }] : []),
    { value: 'layers', label: 'Map' },
    ...(tool?.id === 'buildings' ? [{ value: 'buildings', label: 'Roofs' }] : []),
    { value: 'results', label: 'Data' },
    { value: 'methods', label: 'Methods' },
  ]
  return (
    <TabBar
      value={tab === 'files' ? 'results' : tab}
      options={panelTabs}
      onChange={(value) => {
        setTab(value as typeof tab)
        if (value === 'analysis') {
          setWorkflowsRequested(true)
          if (!analysisOptions.mode && tool?.defaultMode) startAnalysis(tool.defaultMode)
        }
      }}
      label="LiDAR analysis panels"
      idPrefix="lidar"
      variant="underline"
      stretch
      className="shrink-0 border-b border-border"
    />
  )
}

export function LidarSidebar({ controller }: { controller: LidarController }) {
  const {
    summary,
    setCloud,
    setFocus,
    setSceneGround,
    tab,
    setToolsOpen,
    setSurfaceVisible,
    analysisOptions,
    setAnalysisOptions,
    meshVisible,
    setMeshVisible,
    setTransectControl,
    workflowProducts,
    treeProduct,
    workflowRows,
    selectedWorkflow,
    selectedCrown,
    treeCrop,
    activeTreeCrop,
    model,
    showPanel,
    go,
    closeOnMobile,
    startAnalysis,
    selectRaster,
    inspectRoof,
    selectWorkflow,
    analysisBase,
    tool,
  } = controller
  if (!summary || !tool) return null
  return (
    <>
      <div id="lidar-panel-layers" role="tabpanel" aria-labelledby="lidar-tab-layers" hidden={tab !== 'layers'}>
        <LidarMapSettings controller={controller} />
      </div>
      <div id="lidar-panel-analysis" role="tabpanel" aria-labelledby="lidar-tab-analysis" hidden={tab !== 'analysis'}>
        {showPanel && tab === 'analysis' && (
          <WorkflowPanel
            allowedModes={tool?.modes}
            treeProduct={{
              ...treeProduct,
              crop: activeTreeCrop,
              cropError: treeCrop.error,
              cropStatus: treeCrop.status,
              retryCrop: treeCrop.retry,
            }}
            selectedCrown={selectedCrown}
            onIsolateTree={() => {
              if (!selectedCrown) return
              setCloud(false)
              setSurfaceVisible(false)
              setTransectControl((previous) => ({ ...previous, active: false }))
              setAnalysisOptions((previous) => ({ ...previous, treeShowPoints: true, treeOnlySelected: false }))
              setSceneGround(selectedCrown.properties.ground_m)
              setFocus((previous) => ({
                index: -1,
                revision: previous.revision + 1,
                center: selectedCrown.properties.centre,
                zoom: 20,
              }))
            }}
            onAllTrees={() => {
              setAnalysisOptions((previous) => ({
                ...previous,
                treeShowPoints: false,
                treeOnlySelected: false,
              }))
              go(-1)
            }}
            data={workflowProducts.data}
            error={workflowProducts.error}
            retry={workflowProducts.retry}
            options={analysisOptions}
            features={workflowRows}
            selected={selectedWorkflow}
            model={model}
            meshVisible={meshVisible}
            onMeshVisible={setMeshVisible}
            onMode={startAnalysis}
            onOptions={(patch) => setAnalysisOptions((previous) => ({ ...previous, ...patch }))}
            onSelect={selectWorkflow}
            onForestPoints={(plot) => {
              setCloud(true)
              setSurfaceVisible(false)
              setToolsOpen(true)
              setSceneGround(plot.ground_m)
              const feature = workflowRows.find((row) => row.properties.id === plot.id)
              if (feature)
                setFocus((previous) => ({
                  index: -1,
                  revision: previous.revision + 1,
                  center: featureCentre(feature),
                  zoom: 18,
                }))
              closeOnMobile()
            }}
            onPoints={() => {
              setCloud(true)
              setToolsOpen(true)
              if (model) setSceneGround(model.ground_m)
              closeOnMobile()
            }}
          />
        )}
      </div>
      <div
        id="lidar-panel-results"
        role="tabpanel"
        aria-labelledby="lidar-tab-results"
        hidden={tab !== 'results' && tab !== 'files'}
      >
        <LidarResults summary={summary} analysisBase={analysisBase} selectRaster={selectRaster} />
        <LidarDownloads summary={summary} analysisBase={analysisBase} />
      </div>
      <div
        id="lidar-panel-buildings"
        role="tabpanel"
        aria-labelledby="lidar-tab-buildings"
        hidden={tab !== 'buildings'}
      >
        <RoofInspectionPanel
          analysisBase={analysisBase}
          sourceHash={summary.source_sha256}
          active={showPanel && tab === 'buildings' && tool?.id === 'buildings'}
          onView={inspectRoof}
        />
      </div>
      <div id="lidar-panel-methods" role="tabpanel" aria-labelledby="lidar-tab-methods" hidden={tab !== 'methods'}>
        <LidarMethods summary={summary} />
      </div>
    </>
  )
}
