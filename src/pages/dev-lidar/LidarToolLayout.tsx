import {
  createContext,
  useContext,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
  type Ref,
} from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Building2,
  Cylinder,
  GitCompareArrows,
  Grid3x3,
  Layers3,
  Leaf,
  ListTree,
  Spline,
  TreeDeciduous,
  TreePine,
  Trees,
  Upload,
} from 'lucide-react'
import type { MapTableController } from '@/components/map/useMapTable'
import { MapSectionLayout, MAP_SIDEBAR_CLASS } from '@/components/layout/MapSectionLayout'
import { MOBILE_COLLAPSED_VISIBLE_HEIGHT } from '@pgmaps/geo-toolkit/workspace/sheet-math'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { MapSidebarShell } from '@/components/ui/map-panels'
import { AppSelect } from '@/components/ui/select'
import type { Basemap } from './basemaps'
import { LIDAR_BASE, LIDAR_TOOLS, type LidarToolId } from './workspaceTools'

export const LIDAR_TOOL_ICONS: Record<LidarToolId, ElementType> = {
  coverage: Grid3x3,
  data: Upload,
  inventory: ListTree,
  volume: Cylinder,
  compare: GitCompareArrows,
  canopy: TreeDeciduous,
  trees: TreePine,
  forestry: Trees,
  species: Leaf,
  buildings: Building2,
  transects: Spline,
}

/** What every LiDAR tool's sidebar header needs from the workspace around it. */
export interface LidarFrame {
  toolId: LidarToolId
  basemap: Basemap
  setBasemap: (basemap: Basemap) => void
  openTool: (id: LidarToolId | undefined) => void
}

const LidarFrameContext = createContext<LidarFrame | null>(null)
export const LidarFrameProvider = LidarFrameContext.Provider

const BASEMAP_OPTIONS = [
  { value: 'vector', label: 'Vector map' },
  { value: 'satellite', label: 'Satellite' },
  { value: 'none', label: 'No basemap' },
]

/** Switches tool and basemap. Only shown inside the LiDAR workspace, which supplies the frame. */
function LidarToolSwitcher({ frame }: { frame: LidarFrame }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
      <AppSelect
        className="min-w-0 flex-1"
        triggerAriaLabel="LiDAR tool"
        value={frame.toolId}
        onValueChange={(value) => frame.openTool(value as LidarToolId)}
        options={LIDAR_TOOLS.map((tool) => ({ value: tool.id, label: tool.title }))}
      />
      <AppSelect
        className="w-[8.5rem] shrink-0"
        triggerAriaLabel="Basemap"
        value={frame.basemap}
        onValueChange={(value) => frame.setBasemap(value as Basemap)}
        options={BASEMAP_OPTIONS}
      />
    </div>
  )
}

/**
 * The frame every `/dev/lidar` tool shares: the app's `MapSectionLayout` (resizable desktop
 * sidebar with its edge toggle, the phone bottom sheet, the docked table) with one sidebar
 * header naming the tool, a way back to the LiDAR library, and the tool and basemap pickers.
 *
 * `metadata` sits under the header and does not scroll (tabs, a view switch); `sidebar` is the
 * scrolling body. `children` fill the map pane, which is positioned, so overlays can float.
 */
export function LidarToolLayout({
  toolId,
  title,
  subtitle,
  metadata,
  sidebar,
  children,
  table,
  sidebarRef,
  sidebarOpen,
  onSidebarOpenChange,
  collapseSheetKey,
  mobilePeekSubtitle,
  label,
  reserveMobileSheet = false,
}: {
  toolId: LidarToolId
  title?: string
  subtitle?: ReactNode
  metadata?: ReactNode
  sidebar: ReactNode
  children: ReactNode
  table?: MapTableController
  /** A marker inside the sidebar root, for finding its scroll port (`parentElement`). */
  sidebarRef?: Ref<HTMLSpanElement>
  /** Controls the desktop sidebar; omit both to let the layout own it. */
  sidebarOpen?: boolean
  onSidebarOpenChange?: (open: boolean) => void
  /** Change it to fold the phone sheet down to its peek, e.g. after choosing something on the map. */
  collapseSheetKey?: number
  mobilePeekSubtitle?: ReactNode
  /** Names the map pane for assistive technology. */
  label?: string
  /**
   * Keeps the folded phone sheet off the bottom of the pane, for tools that stack a pane under
   * the map (the tree inspector, a transect). A map alone runs under the sheet, as elsewhere.
   */
  reserveMobileSheet?: boolean
}) {
  const frame = useContext(LidarFrameContext)
  const tool = LIDAR_TOOLS.find((item) => item.id === toolId)
  const [width, setWidth] = useState(360)
  const heading = title ?? tool?.title ?? 'LiDAR'
  const sidebarNode = (
    <MapSidebarShell
      className={MAP_SIDEBAR_CLASS}
      icon={LIDAR_TOOL_ICONS[toolId] ?? Layers3}
      title={heading}
      subtitle={subtitle ?? tool?.description}
      hideTitleOnMobile
      scrollClassName="overscroll-contain"
      actions={
        frame ? (
          <Button variant="ghost" size="icon" className="size-8 shrink-0" asChild>
            <Link to={LIDAR_BASE} aria-label="All LiDAR tools" title="All LiDAR tools">
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        ) : undefined
      }
      metadata={
        <>
          {sidebarRef && <span ref={sidebarRef} hidden />}
          {frame && <LidarToolSwitcher frame={frame} />}
          {metadata}
        </>
      }
    >
      {sidebar}
    </MapSidebarShell>
  )
  return (
    <MapSectionLayout
      sidebar={sidebarNode}
      table={table}
      desktopSidebarWidth={width}
      onDesktopSidebarWidthChange={setWidth}
      showDesktopSidebar={sidebarOpen}
      onToggleDesktopSidebar={onSidebarOpenChange ? () => onSidebarOpenChange(!sidebarOpen) : undefined}
      mobilePeekTitle={heading}
      mobilePeekSubtitle={mobilePeekSubtitle ?? 'LiDAR · drag up for controls'}
      mobileSnapTo={collapseSheetKey ? 'collapsed' : undefined}
      mobileSnapKey={collapseSheetKey}
    >
      <div
        className={cn(
          'absolute inset-0 flex min-h-0 flex-col overflow-hidden',
          reserveMobileSheet && 'max-md:pb-[calc(var(--lidar-sheet-peek)_+_env(safe-area-inset-bottom,0px))]',
        )}
        style={{ '--lidar-sheet-peek': `${MOBILE_COLLAPSED_VISIBLE_HEIGHT}px` } as CSSProperties}
        aria-label={label}
        data-lidar-workspace
      >
        {children}
      </div>
    </MapSectionLayout>
  )
}
