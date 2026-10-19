import { Button } from '@/components/ui/button'
import { MapSidebarShell } from '@/components/ui/map-panels'
import { TabBar } from '@/components/ui/tab-bar'
import { X } from 'lucide-react'
import { LidarDownloads, LidarMethods, LidarResults } from './AnalysisPanels'
import { RoofInspectionPanel } from './RoofInspectionPanel'

import { featureCentre } from './analysisWorkflows'
import { WorkflowPanel } from './WorkflowPanel'

import { LidarMapSettings } from './LidarMapSettings'
import type { LidarController } from './useLidarWorkspace'
export function LidarSidebar({ controller }: { controller: LidarController }) {
  const {
    summary,
    setCloud,
    setFocus,
    setSceneGround,
    tab,
    setTab,
    setPanelOpen,
    setToolsOpen,
    setSurfaceVisible,
    analysisOptions,
    setAnalysisOptions,
    setWorkflowsRequested,
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
    sidebar,
    isMobile,
    showPanel,
    go,
    selectRaster,
    inspectRoof,
    startAnalysis,
    selectWorkflow,
    analysisBase,
    tool,
  } = controller
  const panelTabs = [
    ...(tool?.modes.length ? [{ value: 'analysis', label: 'Analyze' }] : []),
    { value: 'layers', label: 'Map' },
    ...(tool?.id === 'buildings' ? [{ value: 'buildings', label: 'Roofs' }] : []),
    { value: 'results', label: 'Dataset' },
    { value: 'methods', label: 'Methods' },
    { value: 'files', label: 'Files' },
  ]
  if (!summary || !tool) return null
  return (
    <aside
      ref={sidebar}
      id="lidar-sidebar"
      aria-label="LiDAR controls and results"
      hidden={!showPanel}
      className={`${showPanel ? 'flex' : 'hidden'} order-2 h-[42%] min-h-0 w-full shrink-0 flex-col overflow-hidden border-t md:order-1 md:h-full md:w-[310px] md:border-t-0`}
    >
      <MapSidebarShell
        title={tool?.title ?? 'LiDAR'}
        headerClassName="shrink-0 p-2.5"
        titleClassName="text-xs"
        className="border-r-0 shadow-none md:border-r"
        scrollClassName="overscroll-contain"
        contentProps={{ tabIndex: 0, 'aria-label': `${tab} panel content` }}
        actions={
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Close side panel"
            onClick={() => setPanelOpen(false)}
          >
            <X className="size-3.5" />
          </Button>
        }
        metadata={
          <TabBar
            value={tab}
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
            className="shrink-0"
          />
        }
      >
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
                if (isMobile) setPanelOpen(false)
              }}
              onPoints={() => {
                setCloud(true)
                setToolsOpen(true)
                if (model) setSceneGround(model.ground_m)
                if (isMobile) setPanelOpen(false)
              }}
            />
          )}
        </div>
        <div id="lidar-panel-results" role="tabpanel" aria-labelledby="lidar-tab-results" hidden={tab !== 'results'}>
          <LidarResults summary={summary} analysisBase={analysisBase} selectRaster={selectRaster} />
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
        <div id="lidar-panel-files" role="tabpanel" aria-labelledby="lidar-tab-files" hidden={tab !== 'files'}>
          <LidarDownloads summary={summary} analysisBase={analysisBase} />
        </div>
      </MapSidebarShell>
    </aside>
  )
}
