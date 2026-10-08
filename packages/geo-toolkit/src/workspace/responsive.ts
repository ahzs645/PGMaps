export type WorkspaceResponsiveMode = 'container' | 'viewport'
export const DEFAULT_WORKSPACE_BREAKPOINT = 768

/** Resolve presentation from measured width; units are CSS pixels, independent of pointer/device type. */
export function resolveWorkspacePresentation(
  width: number,
  responsive: WorkspaceResponsiveMode = 'container',
  breakpoint = DEFAULT_WORKSPACE_BREAKPOINT,
) {
  if (!Number.isFinite(breakpoint) || breakpoint <= 0)
    throw new RangeError('Workspace breakpoint must be a positive, finite width')
  const isMobile = width < breakpoint
  const isWide = width >= 1280
  // Preserve the host's existing sm breakpoint in viewport mode. Embedded
  // dialogs follow the workspace's configured mobile/desktop boundary.
  const isSmallDesktop = responsive === 'viewport' ? width >= 640 : !isMobile
  const responsiveAttributes: Record<string, 'true' | undefined> = {
    'data-workspace-mobile': isMobile ? 'true' : undefined,
    'data-workspace-desktop': !isMobile ? 'true' : undefined,
    'data-workspace-wide': isWide ? 'true' : undefined,
    'data-workspace-large': width >= 1024 ? 'true' : undefined,
    'data-workspace-sm': isSmallDesktop ? 'true' : undefined,
    'data-workspace-max-sm': !isSmallDesktop ? 'true' : undefined,
  }
  return { isMobile, isWide, responsiveAttributes }
}
