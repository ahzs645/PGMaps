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
