# Failed searches, steeper grades, presets and found-road settings

Four additions to **Design → Find the best route**:

- A goal that finds no line shows on the plan where its search stopped.
- **Try steeper grades** says whether the ends connect a little over the grade limit.
- **Search presets** fill the grade limit and tightest curve for a spur, a block road or a mainline.
- Every road the search finds keeps the settings it was found with, shown beside it and printed in
  the report.

The code lives in these files:

- **Calculations:** `routeSearchStop.ts`, `steeperGrades.ts`, `searchPresets.ts` and
  `foundRoadSearch.ts`. None of them touches the DOM or the network.
- **Wiring:** `routeComparison.ts` (`failureStop`, `probeSteeperGrades`, the settings stamp).
- **Sidebar:** `RouteFailureRow.tsx`, `RouteSearchPresets.tsx` and `FoundRoadSearchNote.tsx`.
- **Plan features:** `routePreviewFeatures.ts`.

The route search itself is described in
[Alignment and optimization → Find the best route](alignment-and-optimization.md#find-the-best-route).

## Before you rely on it

- **The stop mark comes from the search the reason describes.** For a corridor-search failure, that
  is the search that got nearest the end. For a switchback-search failure, it is the switchback
  search. Only a goal that found **no line** gets a mark. A goal that found a line but could not fit
  a profile has nothing to mark. Neither has a goal whose search could not start (an end off the
  terrain, a grade limit over 30 %).
- **The reached line is a trial line, not a road.** It is the path the search held to its point
  nearest the end. It met the checks as far as it went, but no profile was fitted to it, and a line
  that never reached the end proves nothing past its last point. The red dashed gap runs straight
  to the end. It does not mark where the trouble lies.
- **Try steeper grades is information only.** It never adds a road, never draws one, and never
  changes the project's grade limit. "Connects at 14%" means a bounded search found a line at
  14 %. It does not mean a road at 14 % is acceptable here.
- **"Does not connect up to 16%" means a bounded search found nothing.** The retry uses the faster
  search that leans toward the end, in the same corridor, so a wider corridor or a field line can
  still exist.
- **Presets are starting values.** Each preset copies one row of the BC Engineering Manual's
  Table 3-5. The manual gives that table by design speed, not by road class. Which speed suits a
  spur, a block road or a mainline is this tool's choice, and it is marked **confirm**. The
  manual's notes say maximum grades must be set from site conditions.
- **The found-road settings describe how the road started.** Edit the road's horizontal points and
  the record stays as it was. Its "Found by" line then says the road has been edited since.

## Using it

1. Open **Design → Find the best route**, choose the goals and press **Compare**.
2. **A goal with no road** shows a dashed row with its reason and a red line reading **Highlight on
   the plan: where it stopped, 812 m short of the end; platform too steep.** The plan marks every
   failed goal as soon as the comparison ends:
   - the line the search reached, in the goal's colour;
   - a red dashed gap from its end to the road's end;
   - a **Search stopped · Shortest** label;
   - for a switchback-search reason, a label at the place the reason names, such as "Platform too
     steep".

   Click the row, or focus it and press Enter or Space, to highlight its marks (a wider line and a
   red ring on the label). The row then reads **Highlighted on the plan**; click it again to clear
   the highlight. Hovering or focusing the row also highlights its marks.

3. **From the plan**, click the **Search stopped** label, the named-place label or the reached
   line. The matching row is selected and scrolled into view. Both labels are buttons, so the
   keyboard reaches them too.
4. **Try 14% and 16%** sits under a failed row (the limit plus 2 and 4 points). It runs the retry
   with Cancel in the toast. The button is then replaced by the finding, for example:
   - "Connects at 14%: 2% over the 12% limit, a 412 m line by the corridor search. For information
     only: no road was added and the grade limit is still 12%."
   - "Does not connect up to 16%: the search found no line at 14% or 16% in the same corridor
     either."
5. To run the retry with every comparison, tick **When a goal finds no line, try +2% and +4%**
   under **Search settings**. It is off by default, and only runs when a goal finds no line, so a
   comparison where every goal finds a road takes no longer. The tick is not saved with the
   project.
6. **Preset: Spur · Block road · Mainline** sits above the grade limit. A click sets **Grade limit
   %** and **Tightest curve (m)**. The matching preset stays pressed until either value changes,
   and Undo reverses it. Each click is an undo step of its own, however quickly the next follows
   (`startsUndoStep`); typed values within 450 ms still merge (`UNDO_MERGE_MS`). The (i) beside
   the presets lists what each one sets, the adverse and switchback grades it only shows, and the
   source.
7. **A found road's settings.** Open a road the comparison found. A line above the goal buttons
   reads "Found 2026-11-10 · Lowest cost · 12% · ±180 m". Its (i) lists:
   - the goals it led;
   - the grade limit and tightest curve, and the preset they matched;
   - the corridor, ground trend and side-hill limit;
   - the switchback rules;
   - the stream-crossing and cross-drain prices;
   - how the line was found.

   The report prints the same rows under **Terrain and assumptions**.

## The presets

Source: BC Ministry of Forests, _Engineering Manual_, 25 May 2026, §3.5.2, Table 3-5 "Geometric
Road Design Parameters", p. 126 ([PDF](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/resource-roads/engineering-manual/engineering_manual.pdf)),
read 10 November 2026. The table gives suggested values for average conditions.

| Preset     | Table 3-5 row used (confirm) | Grade limit set: favourable, sustained | Tightest curve set | Shown only: adverse sustained, switchbacks, road width |
| ---------- | ---------------------------- | -------------------------------------- | ------------------ | ------------------------------------------------------ |
| Spur       | 20 km/h                      | 16 %                                   | 15 m               | 9 %, 8 %, 4–4.5 m                                      |
| Block road | 30 km/h                      | 12 %                                   | 35 m               | 8 %, 8 %, 5–6 m                                        |
| Mainline   | 50 km/h                      | 10 %                                   | 100 m              | 7 %, 7 %, 6 m (8 m and over for two lanes)             |

**Why the favourable grade.** The route search holds one grade limit in both directions. The
adverse grade depends on which way loaded trucks travel, and that is the user's choice under
**Grades by haul direction**. A preset never sets it: `standards.loadedDirection` and
`routeSearch.haulGrades` are shared by every road.

Table 3-5's notes also apply:

- On curves under 80 m radius, reduce the adverse maximum by 0.5 % for every 10 m less radius.
- Short favourable pitches must have slack grade before or after them.
- Grades over 18 % need extra scrutiny for hauling safety (§3.5.2.3).

None of these is applied automatically.

## Limits and budgets

| Limit                                | Value                                                                           | Enforced by                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Steeper grades tried                 | limit + 2, then limit + 4 percentage points; stops at the first that connects   | `steeperGrades.ts` `STEEPER_GRADE_STEPS_PERCENT`                           |
| Steepest grade tried                 | 30 %, the most the corridor and switchback searches take                        | `MAX_STEEPER_GRADE_PERCENT`                                                |
| Searches per steeper grade           | one corridor search leaning toward the end; then the switchback search if on    | `routeComparison.ts` `probeSteeperGrades`, `QUICK_SEARCH_WEIGHT`           |
| Retries per comparison (option on)   | one sweep, shared by every goal that found no line                              | `routeComparison.ts` `steeperFor`                                          |
| Gap line drawn                       | when the stop is at least 1 m from the end                                      | `routeSearchStop.ts` `MIN_GAP_M`                                           |
| Reached line                         | the corridor search's pieces, curves at quarter points; switchback labels as-is | `corridorOptimizer.ts` `reachedLine`; `switchbackSearch.ts` `reachedChain` |
| Found-road settings: grade; curve    | 1–30 %; 0–1,000 m                                                               | `foundRoadSearch.ts` `parseFoundRoadSearchSettings`                        |
| Found-road settings: corridor; trend | 25–1,000 m; 0–100 m                                                             | `parseFoundRoadSearchSettings`                                             |
| Found-road settings: prices          | crossing $0–100,000,000; cross-drain $0–1,000,000                               | `parseFoundRoadSearchSettings`                                             |
| Found-road settings: note            | 600 characters                                                                  | `MAX_FOUND_ROAD_NOTE_CHARS`                                                |
| Found-road settings: switchbacks     | the saved switchback ranges                                                     | `switchbackOptions.ts` `parseSwitchbackRouteOptions`                       |

## Built-in assumptions

- **What the mark shows.**
  - **Corridor-search reason:** the stop is the search's point nearest the end in a straight line.
    That reason names no other place.
  - **Switchback-search reason:** the named place is the refused try nearest the end, for the rule
    the sentence names (`switchbackFailureFocus`). It follows the sentence's own order: switchbacks
    off, a rule that refused every switchback, then the rule that stopped most pieces near the
    furthest point.
- **Goals that failed for one reason share a row and a mark.** They read the same failure record.
- **Goals whose searches returned the same line share its row** (`mergeSameLines`), named after
  each of them ("Lowest cost · Shortest"). When that line breaks a limit and no other road meets
  them, the row and its flags are the reason for every one of those goals.
- **The steeper retry searches the corridor you set,** around the same guide and with the same
  ground trend and budgets. It does not widen the corridor or try the grid route the comparison
  falls back on. A goal the comparison only solved through those fallbacks could still read "does
  not connect" a little steeper. That cannot happen to a goal with a failure row, since that goal
  found no line through any of them.
- **The settings record** stamps the local day (YYYY-MM-DD), the goals the road led, and the
  corridor half-width you entered. The note says when a search widened it or followed a grid
  route. The preset is recorded only when the grade limit and tightest curve still match one.

## Failure modes

- **No mark on a failed row.** The goal found a line and lost it at the profile fit, or its search
  could not start. The reason says which. Without a mark there is no **Try** button either.
- **"Could not try 14%: …"** The search refused to run, for example because an end is off the
  terrain. Nothing was tried past it.
- **A long retry.** Each steeper grade is one more corridor search, plus a switchback search when
  switchbacks are on. A failed comparison with the option ticked takes up to two to four
  budget-length searches longer. Cancel stops it at its next slice.
- **"No steeper grade tried: 30% is already at the 30% the searches take."** The limit is already
  at the searches' ceiling.
- **A preset button not pressed after a click.** Another edit changed the grade limit or the
  tightest curve. The preset is recognised only while both values match.

## Speed of the comparison

The searches cache terrain reads and corridor-distance checks by exact position. Those caches were
`Map`s keyed by strings such as `x + ',' + y`. Turning two doubles into a string on each of millions
of reads took a third of a corridor search's time. They now use `pointCache.ts`:

- `PointCache`, an open-addressed table on typed arrays that holds the same entries;
- `fixed9Key`, the profile optimizer's `toFixed(9)` key as a whole number of billionths.

The ground trend's node cache and its per-read array went the same way (`groundTrend.ts`). Profiles
fitted to one line are kept for the run, so the Shortest goal reuses the fit Lowest cost made on the
same shortest line.

Results do not change. The keys match exactly what the strings matched. `pointCache.test.ts` checks
`fixed9Key` against `toFixed(9)`, ties included. The training project's comparison (Lowest cost and
Shortest, the browser test's run) produced the same rows, lines, profiles and prices, by SHA-256 of
the rows. It took about 40 s before and 23 s after, in Node on the development machine, two runs
each.

## Provenance

Interaction ideas from the review of reference tools
([2026-11-10](reference-interfaces-review-2026-11-10.md), backlog items 6 and 15):

- forestroaddesigner drew a failed search's stopping point and suggested trying a slightly steeper
  grade.
- SylvaRoad kept a parameter record beside each output.

No code, text or images were taken from either. The preset values come from the BC Engineering
Manual, cited above.
