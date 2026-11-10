import { MapTableBridge, useMapTable } from '@/components/map/useMapTable'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { ResizableSplit } from '@/components/ui/resizable-split'
import { NativeLidarMap } from './NativeLidarMap'
import { NativeTransect } from './NativeTransect'
import { TreeBenchmarks } from './TreeBenchmarks'
import { pointKey } from './treeInspection'
import { TreeInspector } from './TreeInspector'

import { LidarLegend } from './LidarLegend'
import { LidarMapToolbar } from './LidarMapToolbar'
import { LidarSidebar, LidarSidebarTabs } from './LidarSidebar'
import { LidarToolLibrary } from './LidarToolLibrary'
import { LidarFrameProvider, LidarToolLayout, type LidarFrame } from './LidarToolLayout'
import { lidarTableSources } from './lidarTable'
import { useLidarWorkspace } from './useLidarWorkspace'
import { ModelComparisonWorkspace } from './comparisons/ModelComparisonWorkspace'
import { InventoryWorkspace } from './inventory/InventoryWorkspace'
import { lazy, Suspense, useMemo, type CSSProperties } from 'react'
import { VolumeWorkspace } from './volume/VolumeWorkspace'

const CoverageWorkspace = lazy(() =>
  import('./lidarbc/CoverageWorkspace').then((m) => ({ default: m.CoverageWorkspace })),
)
const ImportWorkspace = lazy(() => import('./imports/ImportWorkspace').then((m) => ({ default: m.ImportWorkspace })))

export function LidarWorkspace(props: { analysisBase: string; cloudBase: string }) {
  const controller = useLidarWorkspace(props)
  const {
    tool,
    summary,
    error,
    retrySummary,
    raster,
    trees,
    buildings,
    cloud,
    setCloud,
    reference,
    minTreeHeight,
    focus,
    sceneGround,
    setSceneGround,
    color,
    toolsOpen,
    setToolsOpen,
    basemap,
    setBasemap,
    openTool,
    panelOpen,
    setPanelOpen,
    sheetCollapse,
    sidebar,
    labels,
    hillshade,
    surfaceVisible,
    surfaceOpacity,
    analysisOptions,
    meshVisible,
    pickedReturn,
    setPickedReturn,
    transectControl,
    setTransectControl,
    transectProfile,
    setTransectProfile,
    benchmarkPreview,
    setBenchmarkPreview,
    treeView,
    focusBenchmark,
    workflowProducts,
    treeProduct,
    workflowRows,
    selectedWorkflow,
    selectedCrown,
    treeCrop,
    activeTreeCrop,
    inspection,
    visibleTreeCrop,
    cutOverlay,
    model,
    isMobile,
    selectWorkflow,
    analysisBase,
    cloudBase,
    navigation,
  } = controller
  // The map draws no crowns during a benchmark preview, so the table offers none either.
  const mappedRows = useMemo(
    () => (analysisOptions.mode === 'trees' && benchmarkPreview ? [] : workflowRows),
    [analysisOptions.mode, benchmarkPreview, workflowRows],
  )
  const models = workflowProducts.data?.models.records
  const tableSources = useMemo(
    () => lidarTableSources(analysisOptions.mode, mappedRows, models ?? []),
    [analysisOptions.mode, mappedRows, models],
  )
  const toolId = tool?.id
  const frame = useMemo<LidarFrame | null>(
    () => (toolId ? { toolId, basemap, setBasemap, openTool } : null),
    [toolId, basemap, setBasemap, openTool],
  )
  const table = useMapTable({
    sources: tableSources,
    selectedRowId:
      analysisOptions.mode === 'models' ? analysisOptions.selectedId : (selectedWorkflow?.properties.id ?? null),
    onSelectRow: (row, source) => selectWorkflow(source.getRowId(row)),
    // The camera URL is written outside the router, and `selectWorkflow` moves the camera.
    url: false,
    flyOnSelect: false,
    inlineButton: true,
  })
  if (!tool || !frame)
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
        <LidarToolLibrary valid={navigation.valid} />
      </div>
    )
  const inspectorPane = tool.id === 'transects' || (tool.id === 'trees' && analysisOptions.mode === 'trees')
  const mapPane = summary && (
    <div
      className="relative h-full min-h-0 flex-1 overflow-hidden"
      // Stacked over an inspector on a phone, the map pane no longer reaches the bottom sheet, so
      // its legend, scale and status must not lift themselves clear of it.
      style={
        inspectorPane
          ? ({ '--map-mobile-sheet-visible-height': '0px', '--map-safe-bottom-offset': '0px' } as CSSProperties)
          : undefined
      }
    >
      <NativeLidarMap
        treeCrop={
          analysisOptions.mode === 'trees' && !transectControl.active && !cloud && analysisOptions.treeShowPoints
            ? (benchmarkPreview?.crop ?? visibleTreeCrop)
            : null
        }
        inspectionView={tool?.id === 'transects' ? 'top' : analysisOptions.mode === 'trees' ? treeView : undefined}
        pointStatus={
          benchmarkPreview ? 'Deterministic benchmark display sample · method A · grey points unassigned' : undefined
        }
        pointAppearance={{
          picked: pickedReturn ? pointKey(pickedReturn) : null,
          assignments: benchmarkPreview?.assignments ?? inspection.state.assignments,
          colour: benchmarkPreview ? 'segment' : inspection.state.settings.colour,
          pointSize: inspection.state.settings.pointSize,
        }}
        inspectionOverlay={
          analysisOptions.mode === 'trees' && !transectControl.active
            ? (benchmarkPreview?.features ?? cutOverlay)
            : null
        }
        pickedReturn={analysisOptions.mode === 'trees' ? pickedReturn : null}
        transectControl={tool?.id === 'transects' ? transectControl : undefined}
        onTransectProfile={setTransectProfile}
        heatmaps={workflowProducts.data?.heatmaps ?? null}
        workflowOptions={analysisOptions}
        workflowFeatures={mappedRows}
        selectedWorkflowId={selectedWorkflow?.properties.id ?? null}
        onWorkflowSelect={selectWorkflow}
        buildingModel={analysisOptions.mode === 'models' && meshVisible ? model : null}
        modelActive={analysisOptions.mode === 'models'}
        summary={summary}
        analysisBase={analysisBase}
        cloudUrl={new URL('ept.json', cloudBase).href}
        raster={raster}
        trees={trees}
        buildings={buildings}
        reference={reference}
        cloud={cloud}
        minTreeHeight={minTreeHeight}
        focus={focus}
        color={color}
        toolsOpen={toolsOpen}
        onToolsOpenChange={setToolsOpen}
        basemap={basemap}
        surfaceVisible={surfaceVisible}
        surfaceOpacity={surfaceOpacity}
        labels={labels}
        hillshade={hillshade}
        sceneGround={sceneGround}
      >
        <MapTableBridge table={table} />
      </NativeLidarMap>
      <LidarMapToolbar controller={controller}>{table.button}</LidarMapToolbar>
      <LidarLegend controller={controller} className={inspectorPane ? 'max-lg:hidden' : undefined} />
    </div>
  )
  let workspace
  if (tool.id === 'data')
    workspace = (
      <Suspense
        fallback={
          <InlineAlert loading className="m-4">
            Opening import workspace…
          </InlineAlert>
        }
      >
        <ImportWorkspace basemap={basemap} cloudBase={cloudBase} />
      </Suspense>
    )
  else if (tool.id === 'coverage')
    workspace = (
      <Suspense
        fallback={
          <InlineAlert loading className="m-4">
            Opening BC coverage…
          </InlineAlert>
        }
      >
        <CoverageWorkspace basemap={basemap} />
      </Suspense>
    )
  else if (tool.id === 'inventory')
    workspace = <InventoryWorkspace basemap={basemap} sourceSha={summary?.source_sha256} />
  else if (tool.id === 'volume') workspace = <VolumeWorkspace summary={summary} error={error} basemap={basemap} />
  else if (tool.id === 'compare')
    workspace = <ModelComparisonWorkspace summary={summary} error={error} basemap={basemap} onRetry={retrySummary} />
  else if (!summary)
    workspace = (
      <LidarToolLayout
        toolId={tool.id}
        sidebar={
          <div className="space-y-3 p-4">
            {error ? (
              <>
                <InlineAlert tone="error" title="Could not load the LiDAR analysis">
                  {error}
                </InlineAlert>
                <Button size="sm" variant="outline" onClick={retrySummary}>
                  Retry
                </Button>
              </>
            ) : (
              <InlineAlert loading>Loading the completed LiDAR analysis…</InlineAlert>
            )}
          </div>
        }
      >
        <div className="flex flex-1 items-center justify-center bg-muted/30 p-6" />
      </LidarToolLayout>
    )
  else
    workspace = (
      <LidarToolLayout
        toolId={tool.id}
        label={
          analysisOptions.mode === 'trees'
            ? 'Linked tree workspace'
            : analysisOptions.mode === 'models'
              ? 'Experimental 3D model'
              : cloud
                ? '3D LiDAR'
                : 'Processed map'
        }
        metadata={<LidarSidebarTabs controller={controller} />}
        sidebar={<LidarSidebar controller={controller} />}
        sidebarRef={sidebar}
        sidebarOpen={panelOpen}
        onSidebarOpenChange={setPanelOpen}
        collapseSheetKey={sheetCollapse}
        table={table}
        reserveMobileSheet={tool.id === 'trees' || tool.id === 'transects'}
      >
        {inspectorPane ? (
          <ResizableSplit
            direction="row"
            splitQuery="(min-width: 1024px)"
            storageKey="lidar:inspector"
            className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden"
            panes={[
              {
                id: 'lidar-map',
                label: 'map',
                size: 56,
                min: 240,
                stackedHeight: 340,
                content: mapPane,
              },
              {
                id: 'lidar-inspector',
                label: tool.id === 'transects' ? 'transect' : 'tree inspector',
                size: 44,
                min: 300,
                stackedHeight: 480,
                content:
                  tool.id === 'transects' ? (
                    <div
                      className="h-full min-h-0 overflow-y-auto overscroll-contain border-l bg-background"
                      aria-label="Transect workspace"
                    >
                      <NativeTransect
                        profile={transectProfile}
                        data={treeProduct.data}
                        base={analysisBase}
                        control={transectControl}
                        onControl={setTransectControl}
                      />
                    </div>
                  ) : (
                    <div className="h-full min-h-0">
                      <TreeInspector
                        showTransect={false}
                        isMobile={isMobile}
                        controller={inspection}
                        crop={activeTreeCrop}
                        crown={selectedCrown}
                        ids={workflowRows.map((f) => f.properties.id)}
                        error={treeProduct.error || treeCrop.error}
                        status={
                          analysisOptions.treeShowPoints
                            ? treeCrop.status
                            : 'Select a crown on the map or list to load its original returns.'
                        }
                        onSelect={selectWorkflow}
                        onRetry={treeProduct.error ? treeProduct.retry : treeCrop.retry}
                        picked={pickedReturn}
                        onPick={setPickedReturn}
                        onTransect={(active) => {
                          setTransectControl((s) => ({ ...s, active }))
                          setCloud(active)
                          if (active) setSceneGround(null)
                        }}
                        transect={
                          <NativeTransect
                            profile={transectProfile}
                            data={treeProduct.data}
                            base={analysisBase}
                            control={transectControl}
                            onControl={setTransectControl}
                          />
                        }
                        benchmark={
                          <TreeBenchmarks
                            source={treeProduct.data}
                            onPreview={setBenchmarkPreview}
                            onPick={setPickedReturn}
                            picked={pickedReturn}
                            onFocus={focusBenchmark}
                          />
                        }
                      />
                    </div>
                  ),
              },
            ]}
          />
        ) : (
          mapPane
        )}
      </LidarToolLayout>
    )
  return <LidarFrameProvider value={frame}>{workspace}</LidarFrameProvider>
}
