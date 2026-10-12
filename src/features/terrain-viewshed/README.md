# Shared terrain viewshed

Host-owned feature used by the viewshed/sun planner and forestry's preliminary
road preview. It composes shared toolkit map layers without changing package
boundaries. `model.ts` and `outline.ts` are DOM/network-free; terrain transport
remains in the forestry DEM loader.

```tsx
const view = useViewshed(settings, retryCount, moving, {
  enabled: true,
  horizon: false, // Skip the solar skyline for a route preview.
  detailSize: 128,
  demZoom: 14,
})
<ViewshedOverlay result={view.overlayResult} mode="standing" opacity={0.6}
  showHidden={false} sourceKey="my-viewshed" />
```

`settings` contains an observer coordinate, radius in metres, and two eye
heights above ground. `result` is current and detailed; `overlayResult` keeps
the last completed footprint while moving/loading. Display `message` so a
previous footprint cannot be mistaken for the current observer's answer.
Each mounted consumer owns its worker. Disabled consumers do not start a
worker; a used consumer keeps it idle for reuse until unmount.

Movement uses 64×64 previews. Pausing requests the configured detail grid.
The worker coalesces movement, caches a complete terrain mosaic, and keeps
32 complete results in an LRU. Transferred buffers are cloned from the cache;
posting a result cannot detach stored cells. Incomplete terrain is not cached
as a finished view. Changing `retryCount` discards result/mosaic caches and
reloads the requested terrain tiles.

The shared DEM loader keeps up to 128 decoded tiles per JavaScript realm
(32 MiB), coalesces overlapping in-flight requests, and cancels a request only
when its last consumer leaves. Validated Terrarium PNGs persist in browser
Cache Storage for seven days, bounded to 128 entries, so camera/analysis
workers and later visits reuse downloaded data. Failed HTTP requests and bad
PNGs are not stored. An explicit retry bypasses storage and HTTP caches;
storage failures fall back to memory/normal HTTP caching. MapLibre's own
terrain rendering continues to use its normal image/HTTP cache.

For road coverage, pass `observers` (1–32 points at one eye height) and an
optional fixed `bounds` in the hook options. Each output cell is red if any
sample has a verified visible sightline. It stays unknown if no sample sees
it and at least one relevant ray is unknown. Cells outside every sample's
radius remain outside. No solar skyline is calculated for combined coverage.
The worker extends complete prefix results by computing only newly added
observers and skipping cells already known visible. All results use the same
grid for a selected stretch, so accumulating cannot erase a previously red
cell through resampling. Retries discard the prefix as well as the usual caches.

Forestry supports **Current view**, **Whole stretch**, and **As you move**.
Start/end controls select the centreline portion; both endpoints are sampled,
at intervals no greater than 100 m unless the 32-viewpoint budget requires a
wider spacing (displayed in the panel). **As you move** adds stations through
the furthest road position reached by playback or scrubbing; moving backwards
retains them. Reset starts again at the selected start, and changing the road,
selection, radius or eye height creates a new accumulation. The merged grid
is 128×128 across the full selected footprint; long stretches have coarser
display cells and may need a lower DEM zoom to stay within the 64-tile budget.
This is sampled preliminary terrain coverage, not a continuous-road guarantee.
