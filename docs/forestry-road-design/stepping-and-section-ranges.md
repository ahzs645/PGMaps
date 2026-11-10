# Stepping along the road and spreading a section

Three tools for walking a road station by station and acting on what you find:

- **Jump** in the station bar moves the shared station to the next or previous place of one kind:
  a PVI, a curve point, a flagged station, an incomplete section, a culvert or a template change.
  The `]` and `[` keys do the same.
- **Hold scale** and **Pin this section** under the cross-section keep the section's frame still
  while stepping, and draw one station's outline behind the others for comparison.
- **Use this section for…** under the cross-section gives the section at the selected station to a
  range of stations, typed or dragged on the profile, and then lists the stations of that range
  whose cut or fill batter never met the ground.

The calculations are `stationJumps.ts`, `sectionFrame.ts` and `sectionRangeApply.ts`. They have no
DOM or network access. The controls are `StationJumpMenu.tsx` and `SectionPaneTools.tsx`.

## Jumping between places

Choose the kind from the menu beside the station box (it shows how many of each the road has),
then use the ‹‹ and ›› buttons beside it, the menu's **Previous** and **Next**, or the keys:

| Key | Does                              |
| --- | --------------------------------- |
| `]` | Next place of the chosen kind     |
| `[` | Previous place of the chosen kind |

The keys work anywhere on the page except in a text or number field, a list box or a dialog,
which keep their own typing. ⌘[ and Ctrl+[ are left to the browser; a bracket typed with AltGr
counts. Each jump puts what is there in the header notice ("PVI at 0+125.5: PVI 2 · VC 40 m").

A jump sets the station to the place's exact chainage, which the views evaluate there (the same
rule as a typed station, `roadStationAt`). It starts from the station you asked for, not the
nearest calculated one, so a second press always moves on.

| Kind               | Places                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PVI                | Every vertical point of the profile, start and end included                                                                                                                           |
| Curve point        | BC and EC of each fitted horizontal curve, or TS, SC, CS and ST when it is spiralled                                                                                                  |
| Flagged station    | The first station of each run of stations with a flag; Review rows that need attention and name a station; the start of each stretch where stopping sight distance is short, each way |
| Incomplete section | The first station of each run of incomplete sections, with the first reason                                                                                                           |
| Culvert            | Each culvert's station; the jump also selects the culvert                                                                                                                             |
| Template change    | Both ends of every template station assignment                                                                                                                                        |

## Hold scale and the pinned section

With **Hold scale** off the section chart fits each station's own extent, so the axes change at
every step. Turned on, it keeps the offset and elevation spans of the section shown at that moment,
and moves the frame up and down with the formation at the centreline (the ground there on a
terrain transect). The road then stays still on screen and the ground moves under it. A section
that no longer fits is cut at the frame, and a line under the readout says so; turn Hold scale off
and on to refit.

**Pin this section** keeps the selected station's section and draws it dashed and faint behind
every other station of the same road. It is moved up or down to share the current station's
formation level at the centreline (the ground on a terrain transect), so the shapes compare
directly; the offsets are not moved. The legend's **Pinned** label gives the shift. The pin is a
copy of the section when it was pinned: edits made since do not move it, which is what makes a
before-and-after comparison possible. Showing another road, or a terrain profile, drops the pin.

## Use this section for…

1. Select the station whose section you want, and press **Use this section for…**.
2. Mark the range: drag along the profile (the drag marks the range instead of moving the station
   while **Drag on profile** is pressed; Escape stops it), type the from and to stations, or step
   to each end and press **From here** and **To here**.
3. Press **Apply**.

What is given to the range depends on the section at the selected station:

| Section at the station                                   | What the range gets                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| The base section on both sides                           | Its template ranges are cleared, so it falls back to the base section |
| One named template on both sides, outside any transition | A range of that template on both sides, no transition                 |
| Different templates per side, or inside a transition     | The section exactly as shown, saved as a new template "Section at …"  |

Ranges already in the way are trimmed to make room, or split when they span the new one. A
trimmed range with a transition keeps it, capped at half its new length, so it now blends back to
the base section at the cut. A plain range of the same template that touches the new one is joined
to it. Before any existing range changes, the pane lists each one and what happens to it, and
waits for **Replace**. One undo (⌘Z / Ctrl+Z) takes the whole change back.

After applying, the pane lists the stations of the range where a batter never met the ground,
read from the recalculated road: each side, whether it was cutting or filling where the section
stopped, and whether it ran past the section reach or the terrain ran out. Each station in the
list selects it. The list follows the results, so it updates after further edits; × clears it.

## Limits and budgets

| Limit                                  | Value            | Enforced by                                        |
| -------------------------------------- | ---------------- | -------------------------------------------------- |
| A jump passes a place this close       | 1 mm             | `JUMP_TOLERANCE_M`, `stationJumps.ts`              |
| Places of one kind merged into one     | within 0.5 m     | `JUMP_MERGE_M`                                     |
| Shortest range a section is given to   | 1 m              | `MIN_SECTION_RANGE_M`, `sectionRangeApply.ts`      |
| A trimmed range shorter than this goes | 0.5 m            | `MIN_TRIMMED_PIECE_M`                              |
| Templates in the library               | 50               | `MAX_TEMPLATES`; `validateEngineering`             |
| Template station assignments           | 200              | `MAX_ASSIGNMENTS`; `validateEngineering`           |
| Batter misses listed by station        | 12, then a count | `MAX_LISTED_BATTER_MISSES`, `SectionPaneTools.tsx` |
| Range dragged on the profile           | rounded to 0.1 m | `useSectionTools`                                  |

The flagged-station kind works out the Review list and the sight distance check only when the menu
opens or a flagged-station jump is made; both are cached per calculated road.

## Built-in assumptions

- A section is given to both sides. To give one side only, assign the template by side under
  Design → Templates.
- "Never met the ground" is the section builder's unresolved daylight flag. It is called cut when
  the ground at the batter's last designed point stands above it and fill when below; with no
  ground there it is unknown.
- Flagged stations are taken per run: a 200 m stretch over the grade limit is one place, not twenty.

## Failure modes

- **"Choose a range on the road…" or "at least 1 m long".** The typed stations lie off the road or
  too close together.
- **"…the library already holds 50".** The section mixes templates or sits in a transition and has
  to be saved as a new template. Remove an unused template, or select a station with a named
  template on both sides.
- **"The template ranges cannot take this section: …".** Another template entry is already invalid
  (its message follows). Fix it under Design → Templates first.
- **"… already has this section."** Nothing changed: the range already holds it.
- **Use this section for… is greyed out.** A preview (draft, numeric peg, template or cost preview)
  or a terrain profile holds the views, or a task is running.
- **The pinned outline is far off.** One of the two sections has no formation and no ground at the
  centreline; the outline is drawn at its own elevations, and the label's tip says so.
- **No curve points.** The plan cannot be fitted (for example a road of one point); the workspace
  reports why.
- **Clearance touches are not a flagged station.** The low-vehicle clearance check in Profile
  geometry runs only while that panel is open, so its touches are not jump targets.

## Provenance

Interaction ideas from the 10 November 2026 review of reference tools
(`reference-interfaces-review-2026-11-10.md`, backlog items 11 and 18): Lima VVA's feature
navigation keys and held section frame, and Topografia's apply-to-range with its list of stations
whose batter failed. No code from those tools was used.
