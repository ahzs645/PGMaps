# FSR target choice and interface review

This follow-up reviewed Terrain, Design, Section, Engineering, Review, Projects,
Save/export and the connected plan/profile/detail views at desktop (1512 × 982),
phone (390 × 844) and short landscape (844 × 390) sizes.

## Choosing a destination

**Design → Find a route → Find nearby FSRs** discovers choices without generating
or replacing a road. **FSR to connect to** lists named sections with straight-line
distances. The user can keep automatic selection or choose one specific section.
The selected card distinguishes straight-line distance from generated road length
and provides **Locate selected FSR**; locating closes the phone controls to reveal
the mapped road and junction.

The explicit-choice browser fixture selected a farther FSR while a nearer one was
available. Its connector ended at the chosen segment's interior point, preserved
the original alignment and recorded `preference: chosen`, the target name and
coordinate, network scope and route measurements. Reopening project JSON retained
the record. Closing the selected road made it unavailable and disabled connection;
the application did not silently substitute the nearest road.

A real Tabor journey returned WILLOW FSR (3.96 km), WILLOW–STONEBUCK FSR (8.79 km)
and STONE CREEK–RED ROCK (8.81 km) after a 10 km discovery query. Explicit WILLOW
selection generated a 4,157.47 m proposed connection at the default 12% screening
limit. Its final point met the mapped segment exactly, and the original project
remained saved beside the separate regional-screening project.

## Interface findings addressed

- Phone map chrome previously overlapped the open controls. Actual pointer hit
  testing now confirms that the sidebar remains above the map legend.
- Existing-road condition review was below terrain imports and unrelated links.
  **Review existing roads** now opens and scrolls directly to that panel.
- Aggregate supply was difficult to find behind haul settings. **Gravel & aggregate
  costs** now opens the source settings directly.
- A hidden road-review panel could replace the chosen connection's blue map
  highlight with another road after generation. The recorded target's line and
  exact junction now remain highlighted after generation and JSON reopening.
  Explicit FSR selection takes precedence over earlier road-review highlights;
  hidden workflow tabs do not drive road-review or destination previews.
- Long discovery notices previously wrapped the desktop toolbar onto another row.
  The final measured header stays 44 px high at 1512 px width; Save remains on the
  same row, 6 px below the header's top.
- Training-mode save status now explicitly says that reload starts fresh.
- Terrain source cards support arrow, Home and End keys with matching selection
  and focus. A 45% review threshold visibly disables corridor optimization and
  explains its separate 1–30% grade range.
- Selecting a new pit reference clears the prior enabled supply assumptions:
  the candidate starts disabled with zero capacity and unpriced rates. The generic
  1 km haul placeholder is identified as unverified, rather than retaining the old
  stockpile's entered distance.

## Verification

Twenty distinct browser checks passed across the combined and targeted runs:
ten existing road workflows and ten planning/interface checks. The final focused
manual-choice and phone checks passed again after the last interface fixes.
The road unit suite passed 413 tests (one existing test skipped); TypeScript,
feature lint and whitespace checks passed.
An additional direct MapLibre inspection confirmed the exact Far-FSR line and
junction, with no Near-FSR highlight, after generation and JSON reopening.

The final screenshots and source observations for this session are in
`/workspace/scratch/forestry-road-ui-review/`, including
`desktop-fsr-header-final.png`, `desktop-recorded-fsr-final.png`,
`desktop-reopened-fsr-final.png`, `mobile-selected-fsr-controls.png` and
`mobile-selected-fsr-map.png`.

The [workspace audit](workspace-audit-2026-10-28.md) records the earlier terrain,
data and engineering checks. These checks do not establish current road condition,
access rights, aggregate supply permission or construction suitability.
