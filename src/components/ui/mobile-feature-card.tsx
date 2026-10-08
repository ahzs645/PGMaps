import { useTheme } from 'next-themes'
import type { ComponentProps } from 'react'
import { MobileFeatureCard as ToolkitMobileFeatureCard } from '@pgmaps/geo-toolkit/ui/mobile-feature-card'
import { useWorkspace, WorkspaceProvider } from '@pgmaps/geo-toolkit/workspace/workspace-context'
export * from '@pgmaps/geo-toolkit/ui/mobile-feature-card'
/** Selected cards in legacy sections may be mounted beside, rather than inside, the layout. */
export function MobileFeatureCard(props: ComponentProps<typeof ToolkitMobileFeatureCard>) {
  const workspace = useWorkspace()
  const { resolvedTheme } = useTheme()
  if (workspace) return <ToolkitMobileFeatureCard {...props} />
  return <WorkspaceProvider eventTarget={typeof window === 'undefined' ? undefined : window} placement="viewport" responsive="viewport" theme={resolvedTheme === 'dark' ? 'dark' : 'light'} style={{ display: 'contents' }}
    rootElement={typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('[data-map-layout-root="true"]')}>
    <ToolkitMobileFeatureCard {...props} />
  </WorkspaceProvider>
}
