import { createElement, type ReactNode } from 'react'

/**
 * `MapSectionLayout` without its sheet, resize and focus machinery, which need a real browser.
 * Interaction tests that render a LiDAR workspace mock the layout module with this:
 * `vi.mock('@/components/layout/MapSectionLayout', () => import('@/pages/dev-lidar/testing/mapSectionLayoutStub'))`.
 */
export const MAP_SIDEBAR_CLASS = ''
export function MapSectionLayout({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return createElement('div', null, sidebar, children)
}
