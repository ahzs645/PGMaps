import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { AnalysisMode } from './analysisWorkflows'
import { resolveLidarRoute, toolForMode, toolPath, type LidarToolId } from './workspaceTools'

/** One route owner for both Pages and the standalone preview; navigation keeps the map mounted. */
export function useLidarNavigation() {
  const location = useLocation(),
    navigate = useNavigate()
  const route = resolveLidarRoute(location.pathname, location.search)
  useEffect(() => {
    if (route.valid && location.pathname + location.search !== route.canonical)
      navigate(route.canonical, { replace: true })
  }, [location.pathname, location.search, route.canonical, route.valid, navigate])
  const openTool = (id?: LidarToolId) => navigate(toolPath(id))
  const openMode = (mode: AnalysisMode) => navigate(toolPath(toolForMode(mode)?.id, mode))
  return { ...route, openTool, openMode }
}
