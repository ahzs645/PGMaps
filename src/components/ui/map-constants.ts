/**
 * Shared constants for all PGMaps map views.
 *
 * Every map should reference these values so that basemap style, default
 * paint properties, selection highlighting and fly-to animations stay
 * consistent across Air Quality, Census, Score Builder, Parks, Explorer
 * and Food Map.
 */

/* ------------------------------------------------------------------ */
/*  Basemap tile styles                                                */
/* ------------------------------------------------------------------ */

/** Carto positron / dark-matter – the canonical PGMaps basemap. */
export const MAP_STYLES = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
} as const

/* ------------------------------------------------------------------ */
/*  Default map center / zoom (Prince George)                          */
/* ------------------------------------------------------------------ */

export const PG_CENTER: [number, number] = [-122.764593, 53.909784]
export const PG_DEFAULT_ZOOM = 12

/* ------------------------------------------------------------------ */
/*  Choropleth paint defaults                                          */
/* ------------------------------------------------------------------ */

export const CHOROPLETH_FILL_OPACITY = 0.72
export const CHOROPLETH_LINE_COLOR = '#0f172a'
export const CHOROPLETH_LINE_WIDTH = 0.7
export const CHOROPLETH_LINE_OPACITY = 0.5
export const CHOROPLETH_FALLBACK_COLOR = '#475569'

/* ------------------------------------------------------------------ */
/*  Selection highlight                                                */
/* ------------------------------------------------------------------ */

export const SELECTION_LINE_COLOR = '#38bdf8'
export const SELECTION_LINE_WIDTH = 2.8
export const SELECTION_LINE_OPACITY = 1

/* ------------------------------------------------------------------ */
/*  Fly-to / fitBounds animation defaults                              */
/* ------------------------------------------------------------------ */

export const FIT_BOUNDS_PADDING = 80
export const FIT_BOUNDS_DURATION = 600
export const FIT_BOUNDS_MAX_ZOOM = 14
