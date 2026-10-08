# Transit travel times

Open `/dev/transit`, also listed in the Dev Library. This is the Prince George
adaptation of the uploaded Camille Roux Brussels travel-time map.

See [Transit travel-time pipeline](transit-pipeline.md) for the build/runtime
architecture, reproducible release commands, and the settings to extract before
adapting another city. The pipeline currently remains configured for Prince George.

- Drag A or select **Set starting point** before clicking/searching.
- Dragging either marker continuously updates the heatmap and makes that marker
  the heat origin, as in the reference. The final position is saved on release.
  Heat colours blend between results without disappearing; reduced-motion
  preferences disable this transition.
- Light and dark themes have separate heat palettes and matching legends, using
  identical time thresholds. Dark mode uses deeper greens, gold, amber and coral
  with softer opacity and lighter contour lines; theme changes reuse routing.
- The worker generates street-access samples for the padded visible bounds.
  Spacing follows zoom (down to 12.5 metres), with a 120,000-cell budget and
  bilinear interpolation of minutes into a 2× raster before colouring. The
  bundled grid remains a legacy fallback; the interactive worker does not use it.
  Finer display samples do not improve the accuracy of street inputs.
- During a drag through an area without nearby street access, the last connected
  preview stays visible with an explicit label. Releasing there commits the
  unavailable result and shows the street-access warning.
- Click to place B, drag it, or select a stop/address. Shift/right click places A.
- Select a departure time in Pacific time on the displayed reference date.
- Switch buses off for walking alone; toggle heat colours, routes and stops.
- Select the colour scale and 15/30/45/60-minute contours.
- Choose **From A/From B** to move the heat origin while retaining the A-to-B journey.
- **Share map** includes both points, departure, transport mode, scale, contours
  and current camera in the URL. Layer visibility is local presentation state.

The same shared PGMaps map/sidebar/legend controls work on desktop and mobile.
Stop search is local; an explicit address search uses the BC Address Geocoder.
Failed address requests leave local stop search available. Routing and street
pathfinding and heat-raster generation run in a worker. Camera changes rebuild
the access grid; colour-scale changes reuse the route solution. During dragging, completed frames are shown while
one latest position waits for calculation; older queued positions are replaced.
Results from a previous departure time or transport mode are discarded.

Marker and heat sampling share one spatial access index and the snapshot's
350-metre estimated access limit. Access walking counts toward travel time.
The main connected street component takes priority over nearby isolated assets;
isolated fallback access is explicitly labelled. The scraper's spatial audit
sweeps the full 50-metre study grid and records facility coverage gaps. Run
`npx vitest run src/pages/dev-transit/access-sweep.test.ts` to compare all 270,810
browser heat samples and marker accesses against the independent snapshot builder.

The source snapshot and builder are scraper-owned in
`vendor/bcdatamapper/datascrapers/transit`; see `TRAVEL-TIME.md` there for input
provenance, rebuilding and the limits of the walking model. The current snapshot
uses October 7, 2026 service, not today's timetable. No real-time data is shown.

After rebuilding inside the submodule, run
`npm run data:sync-from-bcdatamapper` from PGMaps. For a committed release, commit
and push the submodule artifacts first, then update the PGMaps submodule pointer.
Generated `public/data/transit` files stay ignored.
