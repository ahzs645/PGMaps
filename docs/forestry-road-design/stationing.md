# Stationing and station equations

A road is measured by **chainage**: metres along it from 0 at its first point. Every
calculation, stored range, PVI, culvert and export column named `_m` stays in chainage. A road's
**stationing** only renames those places for people: a start station and station equations
(Design → **Stationing**). A road without stationing labels its stations by chainage exactly as
before, `0+123.4` from 0+000.

The model, labels and typed-station rules are `roadStationing.ts` (no DOM or network access); the
panel is `StationingPanel.tsx`.

## What a station name is

- **The calculated chain** is the start station plus the chainage, as LandXML (`staStart`,
  `StaEquation@staInternal`) and Softree's traverses use it.
- **A station equation** stands at a back station on that chain. From there on, stations are
  named from its **ahead** station: ahead plus the distance since, or minus it when **Down** is
  ticked (LandXML's `staIncrement="decreasing"`). At the equation itself the ahead name wins.
- A forward equation (ahead above back) leaves a gap in the names. A back equation (ahead below
  back) names some stations twice; their labels then carry the stretch they lie in, `0+450.0 (2)`
  for the stretch after the first equation.
- A road read from a file measured on its grid (LandXML) keeps the file's names exactly:
  `chainageScale` (road chainage ÷ file stations, the import's scale) makes the chain the start
  station plus chainage ÷ scale. Between equations a name then differs from start + chainage by
  that scale, at most a few tenths of a percent.

## Where names are used

- **Every station label on screen**: the plan's station ticks, the profile and section axes and
  readouts, the station bar, the station table, Review rows, drainage, sight distance and the
  rest. They read the stationing of the road on screen; a terrain profile and a road being pegged
  are stationed by chainage. Exports and reports never read the screen's: each writer labels with
  its own road's stationing (`withStationing`), and an analysis carries the stationing of the road
  it was made from.
- **Typed stations.** The station box, Point query's _Go to_, the station table's From and To,
  a culvert's station, and every template, ground, haul and grade range field take station names
  on a road with stationing (`stationEntry.ts`, drawn by `StationFields.tsx`): template range
  starts and ends, values by station, **Use this section for…**, widening and its copy, stripping,
  horizons, haul sites, fill requirements, haul direction and sidecast ranges, grade and curvature
  ranges and vertical controls. Their labels read "(station)" (a label that already says station
  keeps its own), and the field stores chainage. A name that occurs twice goes to the occurrence
  nearest the field's own value (the selected station in the box); a name an equation skips, or
  one off the road, goes to the nearest end or the side of that equation with the nearer name.
  Leaving a field with the name it shows changes nothing. On a road without stationing these
  fields take chainage, labelled "(m)", exactly as before.
- **Reports and exports.** The printed report's station schedule and crossing review add a
  Station column before the chainage and state the start, end and each equation. The Station CSV
  and the station table's CSV add a `station` column after `station_m`. The plot book, charts
  sheet, DXF labels, connector checks and package summary print names. LandXML writes the start
  station as `staStart`, every station from it, and each equation as a `StaEquation`
  (`staInternal`, `staBack`, `staAhead`, `staIncrement`, `desc`); reading one back gives the same
  stationing. RoadEng alignments have no station equations: a RoadEng design written from a road
  takes its start station as the L-line's first station (a road read from RoadEng keeps its
  design's own) and carries the stationing in `[PGMaps] Stationing`, which reading the design back
  restores. A road read from a RoadEng design whose L-line starts at another station than 0 is
  stationed from it (`roadEngImpliedStationing`, at the file's grid-to-road scale): GuardRail's
  stations read 1+400 to 4+200 and its ranges take those names. Such a road writes no
  `[PGMaps] Stationing` while its stationing is still its design's own
  (`isRoadEngImpliedStationing`); one taken back to 0+000 here writes it, since its L-line still
  starts at the design's station. The Softree location ASCII file starts from the road's start station; its L-stations
  run on through equations, as RoadEng's do.

## Editing

**Start station** moves every name and keeps each equation at its place on the road. **Equation
at selected station** adds one where the station bar stands, with the name the station has now
as its ahead station, so nothing is renamed until the ahead station is edited. **Back** is the
name just before the equation (read with the equations before it), **Ahead** the name from it.
**Station from 0+000** removes the stationing. Each committed field is one undo step; an edit
that would not run along the road is refused with the reason and changes nothing.

## Limits and budgets

| Limit                               | Value          | Enforced by                                         |
| ----------------------------------- | -------------- | --------------------------------------------------- |
| Station equations on a road         | 100            | `MAX_ROAD_STATION_EQUATIONS`, `checkRoadStationing` |
| Start, back and ahead stations      | ±10,000 km     | `MAX_ROAD_STATION_M`                                |
| Two equations' back stations apart  | at least 1 mm  | `MIN_STATION_EQUATION_GAP_M`                        |
| An equation's description           | 200 characters | `MAX_STATION_EQUATION_TEXT`                         |
| Road chainage per file station      | 0.5–2          | `checkRoadStationing`                               |
| A typed station is a calculated one | within 0.5 mm  | `STATION_MATCH_M`, `stationAt.ts`                   |

## Failure modes

- **"The first station equation must come after the start station."** or **"…must run along the
  road, one per place."** The back stations are not in order after the start; nothing changed.
- **"Station 1,900 is not on the road before this equation."** A typed Back name is not a name
  the stretch before that equation carries.
- **"A station equation skips station …; showing …".** The typed name falls in a forward
  equation's gap.
- **A label ends in "(2)".** A back equation names that station twice; the number is the stretch.
- **An equation past the road's end** after the road was shortened stays in the stationing but
  names nothing; LandXML and the report leave it out.
- **A LandXML equation is left out**, and the import notice says why, when it has no
  `staInternal` or `staAhead` number or does not follow the one before it. A `staBack` that is not
  the name the stations before it give is reported, not used.
