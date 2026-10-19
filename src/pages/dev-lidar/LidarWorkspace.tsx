import { Button } from '@/components/ui/button'
import { FullscreenPanel } from '@/components/ui/fullscreen-panel'
import { Layers3 } from 'lucide-react'
import { NativeLidarMap } from './NativeLidarMap'
import { NativeTransect } from './NativeTransect'
import { TreeBenchmarks } from './TreeBenchmarks'
import { pointKey } from './treeInspection'
import { TreeInspector } from './TreeInspector'

import { LidarHeader } from './LidarHeader'
import { LidarLegend } from './LidarLegend'
import { LidarMapToolbar } from './LidarMapToolbar'
import { LidarSidebar } from './LidarSidebar'
import { LidarToolLibrary } from './LidarToolLibrary'
import { useLidarWorkspace } from './useLidarWorkspace'

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
    labels,
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
    inspectorWidth,
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
    isLibrary,
  } = controller
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground" data-lidar-workspace>
      <LidarHeader controller={controller} />
      {isLibrary && <LidarToolLibrary valid={navigation.valid} />}
      {!summary ? (
        !isLibrary && (
          <div
            className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-6 text-center"
            role="status"
          >
            <Layers3 className="size-8 text-muted-foreground" />
            <p className="text-sm">{error || 'Loading the completed LiDAR analysis…'}</p>
            {error && <Button onClick={retrySummary}>Retry</Button>}
          </div>
        )
      ) : (
        <div
          className={isLibrary ? 'hidden' : 'flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row'}
          aria-hidden={isLibrary}
        >
          <LidarSidebar controller={controller} />
          <FullscreenPanel
            title={
              analysisOptions.mode === 'trees'
                ? 'Linked tree workspace'
                : analysisOptions.mode === 'models'
                  ? 'Experimental 3D model'
                  : cloud
                    ? '3D LiDAR'
                    : 'Processed map'
            }
            compact
            dialogOptions={{ onOpenEffect: () => undefined }}
            className="order-1 flex min-h-0 flex-1 flex-col overflow-hidden rounded-none border-0 p-0 md:order-2 [&>div:first-child]:mb-0 [&>div:first-child]:shrink-0 [&>div:first-child]:border-b [&>div:first-child]:px-2 [&>div:first-child]:py-1 max-sm:[&>div:first-child>h2]:sr-only [&[data-fullscreen]]:overflow-hidden [&[data-fullscreen]]:p-0"
            actions={
              <>
                <LidarMapToolbar controller={controller} />
              </>
            }
          >
            {() => (
              <>
                <div
                  className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row"
                  style={{ '--tree-pane': `${inspectorWidth}%` } as React.CSSProperties}
                >
                  <div className="relative min-h-[25dvh] flex-1 overflow-hidden lg:min-w-[200px]">
                    <NativeLidarMap
                      treeCrop={
                        analysisOptions.mode === 'trees' &&
                        !transectControl.active &&
                        !cloud &&
                        analysisOptions.treeShowPoints
                          ? (benchmarkPreview?.crop ?? visibleTreeCrop)
                          : null
                      }
                      inspectionView={
                        tool?.id === 'transects' ? 'top' : analysisOptions.mode === 'trees' ? treeView : undefined
                      }
                      pointStatus={
                        benchmarkPreview
                          ? 'Deterministic benchmark display sample · method A · grey points unassigned'
                          : undefined
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
                      workflowFeatures={analysisOptions.mode === 'trees' && benchmarkPreview ? [] : workflowRows}
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
                      sceneGround={sceneGround}
                    />
                  </div>
                  {tool?.id === 'trees' && analysisOptions.mode === 'trees' && (
                    <div className="h-[52%] min-h-0 shrink-0 lg:h-full lg:w-[var(--tree-pane)]">
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
                  )}
                  {tool?.id === 'transects' && (
                    <div
                      className="h-[52%] min-h-0 shrink-0 overflow-y-auto overscroll-contain border-l bg-background lg:h-full lg:w-[var(--tree-pane)]"
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
                  )}
                </div>
                <LidarLegend controller={controller} />
              </>
            )}
          </FullscreenPanel>
        </div>
      )}
    </div>
  )
}
