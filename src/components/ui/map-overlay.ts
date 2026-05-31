export const MAP_OVERLAY_Z = {
  controls: 'z-10',
  legend: 'z-10',
  passiveOverlay: 'z-20',
  activeOverlay: 'z-50',
  modal: 'z-[1200]',
} as const

export const MAP_OVERLAY_ROOT_STYLE = {
  '--map-mobile-sheet-visible-height': '0px',
  '--map-legend-panel-visible-height': '0px',
  '--map-timeline-height': '0px',
  '--map-safe-bottom-offset': 'env(safe-area-inset-bottom, 0px)',
} as const
