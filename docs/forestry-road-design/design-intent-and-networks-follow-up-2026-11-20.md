# Not built yet: design intent that survives edits, and connected networks

Recorded on 20 November 2026, after two reviews of the road designer against Softree's
*Introduction to Forest Road Design* webinar (September 2020) and its *Version 12 Road
Networks* session (November 2026), and after #140 and #142 were merged. Each entry says what
the designer does today, with the file that does it, and what is missing. Nothing here is a
defect in what exists; defects go in [known issues](known-issues.md). When an entry is built,
remove it here and describe the feature in its own guide.

## What the reviews asked for and is now done

These came from the same reviews and landed with #140, #142 and the clean-up after them, so
they are not repeated below:

- One culvert edited at a time: a station-sorted inventory and one selected inspector with
  Geometry, Levels and Review tabs ([culverts](culverts.md)).
- The station table exports the shown rows and columns in their shown order, beside the full
  export ([builder tables](builder-tables.md)).
- A vertical control is placed at the exact station typed, not the nearest calculated one.
- Plan and 3D grade colours read the reviewed grade flags, as Review does.
- A small cover shortfall prints its deficit rather than two equal rounded figures.
- A plan map that cannot start leaves the other views working.
- Eligible cross-drains can take a provisional price, marked until a local rate is confirmed
  ([cost evidence](bc-cost-evidence.md)).

## Design intent that later edits keep

Today an edit writes values. A later edit to the road, the template or the profile does not
know which of those values the designer meant to hold.

### Hold K on vertical curves

- **Today.** A vertical point stores `chainage`, `elevation` and `curveLength` only
  (`VerticalPoint`, `types.ts`). K is derived for the schedule, and **Set every curve from K**
  (`VerticalDesignControls.tsx`) computes lengths once. Every curve is therefore held by its
  length: change the grades beside it and its K changes.
- **Missing.** A per-curve control mode: hold length (today's behaviour, and the default for
  every existing project) or hold K, with the held value saved. With K held, a grade edit
  recomputes the length (K = 10 and a 6-point grade change give 60 m; a 4-point change gives
  40 m). Where the length no longer fits between its neighbours, say so and keep the held
  value rather than shortening it silently. Undo, the project file, alternatives and the
  RoadEng export (Lock K / Lock L) must carry the mode.

### Culverts that stay attached to what they serve

- **Today.** A culvert stores its span, skew and both inverts as numbers (`Culvert`,
  `engineeringTypes.ts`). The editor can set provisional inverts, hold one end while a fall
  moves the other, and work out a required span, but each is a one-off edit. RoadEng's own
  Auto flags for skew, gradient and length are read and written back for interchange
  (`roadEngPlacedCulverts.ts`) and never used as PGMaps rules.
- **Missing.** Deliberate, saved relationships, each with a fixed alternative: inlet invert
  from a named ditch, skew from the stream line it crosses, length from the current road
  prism plus end allowances, and outlet from a stated fall. After a road or template edit,
  the derived values follow, fixed (surveyed) values stay, and the editor names which is
  which and what changed. A reference that can no longer be resolved shows as unresolved,
  never a silent zero.

### Construction rules over station ranges

- **Today.** Range rules exist for grade and curvature standards, haul direction, sidecast and
  material requirements. **Full bench** (`fullBenchProfile`, `fullBench.ts`) writes a revised
  profile once; nothing records that the range must stay full-benched.
- **Missing.** One range editor for requirements that later edits and the optimizer respect:
  minimum fill depth, minimum cut depth, maximum cut or fill height, full bench or no fill on
  a side, cover over a structure, and ditch fall. Each rule must say where it is measured
  (centreline, shoulder or whole formation). The same resolved rule then feeds the
  edit-time feedback, the profile optimizer's feasibility, Review and the printed reports.

## Editing the selected object

- **Today.** Culverts have an inventory and one inspector (#142). Curves, PVIs, template
  assignments, material and haul sites, constraints and field observations are still edited
  in their own lists or settings tabs, and **Section → Template library** moves the person to
  the Engineering tab's settings.
- **Missing.** The culvert pattern for the other objects: pick one on the plan, profile,
  section or 3D view, highlight it in all of them, edit only it, see its checks and cost
  under it, and step to the previous or next one. The selected station and the selected
  object stay separate.
- **Missing.** A template editor drawn from the evaluated section (`TemplateComponents.tsx`
  draws lane, ditch and cut slope on flat ground; `TemplateSandbox.tsx` previews more) where
  clicking a ditch, bench, course, wall or batter opens that component, and a "why this
  section looks like this" trail: base template, station assignment, local override, curve
  widening, material batter.
- **Missing.** One marking for every value's origin: entered, inherited, calculated,
  provisional, overridden or out of date.

## Checks and outputs

- **Avoid areas are tested on the centreline.** Review's constraint row samples centreline
  stations (`avoidAt`, `engine.ts`; also in [known issues](known-issues.md)). A batter, ditch
  or the road between stations can reach an area unseen. Test the built footprint and name
  the scope tested.
- **GIS exports have fixed fields.** The shapefile, GeoPackage and KMZ layers carry a set
  schema (`designExports.ts`, `gisExports.ts`). Missing: per-recipient choices of layers,
  features, fields, field order and Z geometry, saved as named export setups.
- **The headline cost does not say what it leaves out.** The summary shows the covered total
  while Review lists unpriced items, unclassified materials, placeholder rates and haul being
  off. Missing: a short coverage line beside the total ("3 culverts unpriced · haul
  excluded"), and section coverage kept apart from review status.
- **3D inspection.** Saved named views (such as "Crossing 3, downstream") and an along-road
  flythrough are listed with the rest of the 3D work in [the 3D view](3d-view.md).

## Connected road networks

**Engineering → Network planning** ([network planning](network-planning.md)) finds networks
on a raster with four methods and counts each constructed edge once. The gap is everything
after the search.

### What exists and where it stops

- **One branch at a time.** `networkPathAlignment` (`roads/workspace.ts`) turns one projected
  path into one road. It trims reused road at the ends, refuses a path with reused road in the
  middle ("Split those branches before designing their construction quantities"), gives every
  corner a radius of 0 and the road no vertical design, and stops at 2,000 points.
- **Shared construction is lost at adoption.** The planner's unique-edge accounting does not
  survive into roads: two adopted branches over one trunk are two roads, and their
  quantities, costs and package totals add the trunk twice (`packageSummary.ts` sums roads).
- **The worker drops the graph.** The routing worker removes its search graph before it
  returns (`roads/stages.ts`), so shared segments, junctions and which routes use which edge
  are gone by the time the page could adopt them.
- **Junctions hold numbers.** The profile shows other roads' levels at a junction and **Add
  control here** writes that level as a fixed elevation (`profileJunctions.ts`); it does not
  follow the other road when it changes. Two roads starting at one point are read as
  alternatives, not sibling branches.
- **Network planning needs a first road.** Its command is off until a road is sketched
  (`DevForestryRoads.tsx`), so a project cannot start from access points and destinations.
- **The limits disagree.** The planner takes 64 targets (`MAX_ROADS_TARGETS`, `roads/graph.ts`),
  12 stages (`MAX_NETWORK_STAGES`, `roads/planning.ts`) and 250,000 cells
  (`MAX_ROADS_CELLS`); a project holds 20 roads and 2,000 horizontal points in all
  (`MAX_ALIGNMENTS`, `MAX_POINTS`, `project.ts`). A network that plans can exceed what the
  project can hold once split into roads.

### What to build, in order

1. **Adopt a whole network, keeping its shape.** While the worker still has the graph, return
   a compact network: physical edges with stable ids, junctions, terminals, route membership,
   stage and which edges are existing road. Adoption creates each physical road once, splits
   at reused road instead of refusing, shows how many roads and points it will add and
   whether the project can take them, and commits as one undo step or not at all. Projects
   holding these relationships need a new project-file version so an older build refuses
   them rather than dropping them.
2. **Say how each road must connect.** An access gateway as a stored property (not list
   order); destinations with optional elevation bounds; attachment to a reviewed existing road
   over an allowed interval; a tangent approach (bearing, tolerance, straight length);
   required waypoints; fixed segments. A destination that reaches an existing-road fragment
   not joined to the gateway is not connected, and two lines crossing on the map are not a
   junction unless one is declared.
3. **Crossings as choices.** No-build areas, no-cross lines, cost areas, a fixed cost per
   physical crossing, and named crossing candidates that permit only their own footprint,
   chosen or left by the search and charged once. The network adapter reads avoid polygons
   only today and warns that streams are not priced; the single-route finder
   (`routing.ts`) already has more of this, so share one policy model.
4. **Design the network together.** Batch curve fitting and profiles over the physical roads
   with minimum radius, deviation, tangent and arc length, keeping locked controls and
   approaches, and a per-road result (passed, needs review, failed and why). Junction levels
   linked to the road they follow, with dependent roads marked stale when it changes.
   Network defaults, then road overrides, then station-range overrides, with a preview of
   who inherits a change and who keeps their own.
5. **Count and cost the network once.** Quantities and costs by physical asset, with junction
   and pad overlaps counted once against original ground, shared material and pit capacity,
   and one bridge charged once. Compare evaluated networks, not only planning scores, and
   call a result "best found" with its effort and assumptions, never optimal.
6. **One accepted revision in every output.** A network table of physical edges with their
   status, linked to the plan, profile, section and 3D views; reports and exports naming the
   same accepted revision, with new, reused and upgraded road kept apart.

Raise the project limits only after measuring fitting time, memory, recalculation, save and
load and interface response on real networks.

### Acceptance cases for the first network steps

| Case                                      | Must hold                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| Trunk with two spurs                      | One physical trunk; unique length and route distances reported apart          |
| Existing road inside a found path         | Split into new, existing, new; the existing part is not charged again         |
| Existing-road island                      | Does not count as reaching the gateway                                        |
| Lines crossing with no declared junction  | Stay disconnected                                                             |
| Two siblings from one start               | Read as one shared node, not alternatives                                     |
| Two candidate bridge sites                | Only eligible sites used; the chosen structure charged once                   |
| Junction level changed                    | Every dependent road updated or marked stale                                  |
| Network default changed                   | Roads with their own override keep it                                         |
| Adoption over capacity, failed or cancelled | The project is unchanged                                                    |
| Save and reopen                           | Ids, connections, overrides and sources unchanged                             |
