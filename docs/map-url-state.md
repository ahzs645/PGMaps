# Shared map URL state (`map-url-state.ts`)

`src/components/ui/map-url-state.ts` is the single source of truth for putting a
map's view (center/zoom) — and, for the compact-hash style, layer codes — into a
readable, bookmarkable URL. It replaces the per-map copies of this logic.

Two readable URL styles, both built on the same pure helpers:

| Style | Looks like | Used by |
| --- | --- | --- |
| Query params | `?lng=-122.75&lat=53.91&z=10` | census (and easy for parks/explorer) |
| Compact hash | `#/10.00/53.91/-122.75/B1/L1/L2` (zoom/lat/lng/…codes) | aqmap |

## Why two faces

- **`useMapViewUrlState(options)`** — for maps that live under react-router and use
  `useSearchParams` / `useUrlState` for their other params (census, parks, explorer).
  It writes the view through `setSearchParams` with a functional updater and
  `{ replace: true }`, so it composes with the page's other params instead of
  clobbering them (see `memory/url-state-router-gotchas.md`). It reads the initial
  view **once** and never mirrors the URL in React state, so the map stays
  uncontrolled and there's no feedback loop.
- **Pure helpers** (`serializeMapViewHash` / `parseMapViewHash` /
  `readMapViewFromQuery` / `applyMapViewToQuery` / `isMapViewValid` /
  `parseZoomField` / `parseNumberField`) — for maps that own the entire URL
  themselves via `window.history.replaceState` (aqmap). aqmap's
  `serializeAqmapHash` / `parseAqmapHash` delegate to these, so the compact-hash
  format has exactly one implementation.

## Adopting view-in-URL on a new map (census is the worked example)

In the component that renders the base `<Map>`:

```tsx
import { useMapViewUrlState } from '@/components/ui/map-url-state'

const { initialView, hasUrlView, onViewportChange } = useMapViewUrlState({
  defaultView: { center: PG_CENTER, zoom: 10 },
})

// Seed the (uncontrolled) map and observe moves:
<Map
  center={initialView.center}
  zoom={initialView.zoom}
  onViewportChange={onViewportChange}
/>
```

If the map auto-fits bounds on load, gate that first fit on `hasUrlView` so a
bookmarked view isn't immediately overwritten (see `CensusMap.tsx`):

```ts
const skipInitialAutoFitRef = useRef(hasUrlView)
// inside the fit effect, before fitBounds:
if (skipInitialAutoFitRef.current) {
  skipInitialAutoFitRef.current = false
  lastBoundsKeyRef.current = boundsKey
  return
}
```

### Parks / Explorer follow-up

Both already sync their filters to the URL (parks via `useSearchParams`,
explorer via `useExplorerFilters`) but neither persists center/zoom. To add it,
drop `useMapViewUrlState` into `ParksMap` / `ExplorerMap` exactly as above.
Caveat: parks renders through the persistent `SharedMap` host, which does not yet
forward `onViewportChange` — that prop needs threading through first.

## Options

`defaultView` (required), `minZoom`/`maxZoom` (default 0/22), `lngLatPrecision`
(4) / `zoomPrecision` (2), `queryKeys` (default `{ lng, lat, z }`), `debounceMs`
(default 350, matches aqmap's `URL_UPDATE_DELAY_MS`). A view whose zoom is out of
range, or whose lat/lng is non-finite or outside ±85°, is treated as absent and
falls back to `defaultView`.
