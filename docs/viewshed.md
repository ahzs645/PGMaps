# Viewshed and sun planner

`/dev/viewshed` is a terrain-only planning tool. Drag the observer pin, place it
on the map, use the map centre, or enter coordinates. The red footprint and its
terrain-shaped outline update during dragging,
using coalesced 64×64 previews in a worker. Releasing the pin computes a detailed
192×192 result and skyline. The previous footprint stays visible with an updating
status until the next result arrives; statistics and sun visibility wait for the
current detailed result. A dashed neutral circle marks the analysis limit.
The circle can cover 0.5–25 km. Satellite imagery and 1×
3D terrain give the overlay the same context as the reference video; a plan map
and hidden-terrain shading are available as toggles. “Mountain example” moves
the observer to the Mount Robson area and tilts the camera to 65°. Map tilt
ranges from 0–75°; right-drag rotates and tilts the view. The mountain geometry
comes from elevation tiles at real 1× scale, and the red polygons follow that
surface. Camera movement does not change sightline calculations.

Standing and seated modes colour visible ground rose. Compare colours ground
visible to both observers green, seated-only blue, and standing-only amber.
Heights are independently adjustable from 0.5–20 m above ground. Purple means
unknown terrain, including incomplete sightlines; missing data is never filled
with sea level. Percentages include unknown samples in the circle's denominator.

The analysis reuses the forestry DEM loader and terrain-only sightline model.
It tests the centres of a 192×192 Mercator grid against the fixed DEM mosaic,
with Earth curvature and the existing 0.13 refraction coefficient. Ray steps
are at least 15 m or one DEM pixel, whichever is larger. The DEM starts at zoom
13 and reduces its detail to keep requests within 64 tiles. The page reports
both DEM sampling and displayed cell spacing; neither establishes source
accuracy. Visible cell regions are traced into polygons, including occluded holes, and
draped with MapLibre’s native terrain fill and line layers. Trees and buildings are excluded. Differences of
fractions of a metre are exploratory and may not be supported by DEM accuracy.

The sun planner uses a low-order geometric solar-centre ephemeris and a skyline
sampled every 0.5° at both observer heights. Date and time are interpreted in
the selected IANA zone with the offset on that date. Skipped daylight-saving
times are rejected; a repeated fall-back hour resolves to one occurrence.
Azimuth is clockwise from true north. The gold map line and skyline plot
update instantly without a new viewshed run. A known ridge can establish a
blockage even when other terrain is missing. A clear result requires complete
terrain along that direction and means clear **within the selected radius**.
Ridges beyond that range, atmospheric refraction of sunlight, the solar disc,
weather and vegetation can change the first visible sunrise. This is a
planning estimate, not a prediction of the exact first-light time.

Tests cover flat ground, ridge occlusion, observer height differences, unknown
ground, known obstructions with missing terrain, distance geometry, solar
position, and date-specific time-zone offsets.

The previously published BC terrain tool remains available at
`/dev/viewshed/terrain`, linked as “Local DEM tools”. It retains local terrain
GeoTIFF import, vertical-reference metadata, target-height controls, tile-detail
selection, BC presets, keyboard observer movement, and the `read_viewshed` tool.

The viewshed worker, pure model, contour builder and overlay are shared through
`src/features/terrain-viewshed`. Forestry uses the same feature for its
preliminary road preview. See the feature README for API and cache limits.
