# Editing the profile by grade, and junction levels

The road profile chart and the **Vertical** schedule edit the vertical alignment by grade as well as
by PVI elevation, and mark where the project's other roads meet or cross this one, with the level
the profile has to meet there.

The arithmetic is `gradeEdit.ts` and `profileJunctions.ts`, free of DOM, terrain and network
access; `ProfileEditing.tsx` and `GradeScheduleFields.tsx` hold the pointer, key and popover
plumbing.

## What you can do

- **Type a tangent's grade.** In **Data → Vertical**, the **Grade in** and **Grade out** cells take a
  grade. **Typed grade moves** picks the PVI that moves: **Ahead PVI** (the default: the up-station
  end moves, the down-station end holds) or **Back PVI**. On the profile, press a tangent's grip
  (the small bar at the middle of each tangent) or focus it and press Enter: a popover takes the
  grade and the end that holds. The moved PVI's grade on its far side changes with it.
- **Shift-drag a PVI** to hold one adjacent grade: the PVI slides along that tangent. Dragging
  up-station holds the grade in (the PVI runs on along the incoming tangent), dragging down-station
  holds the grade out. Keyboard: Alt+→ and Alt+← on a focused PVI slide it 5 m the same way.
- **Drag a tangent's grip** up or down to move both its PVIs together; its own grade does not
  change. Keyboard: ↑ and ↓ on a focused grip move it 0.1 m (Shift: 1 m).
- **Snap grades.** The magnet on the profile toolbar snaps a grade to the nearest 0.5 % while
  dragging (on by default; the choice is kept in this browser). A plain PVI drag rounds whichever
  adjacent grade needs the smaller change of level; a Shift-drag rounds the free grade by where the
  PVI sits on the held line; a tangent drag rounds the nearer outer grade. The snapped grade shows
  at the cursor.
- **Delete a PVI.** Click a PVI (it fills in) or focus it, then press Delete or Backspace. Undo
  brings it back. Keys never act while typing in a field.
- **Escape** puts a drag back where it started and closes a popover.
- **Junction markers.** A dashed magenta line marks each station where another road of the project
  meets or crosses this one. The diamond sits at that road's level, with the road's name and the
  difference from this road's formation. Click it (or focus it and press Enter) for both stations,
  both levels and **Add control here**, which adds a vertical control at that station and level
  (elevation only, no tolerance) through the same controls as **Design → Vertical standards**.

## When a drag is held

The handle stops short of the cursor, and the reason shows beside it, when:

- a PVI sits on an elevation control (`CONTROL_HOLD_M`) that it currently meets: it keeps its
  station and stays inside the control's tolerance band;
- a Shift-drag is holding a grade;
- the PVI is an end PVI, which keeps its station;
- the PVI would come within `MIN_PVI_GAP_M` of a neighbour;
- an adjoining grade would pass `MAX_DRAG_GRADE`.

A typed grade that would move a PVI held by a control, or make a grade steeper than the cap, is
refused with a message naming the PVI and what to change. Nothing is moved.

## Limits and budgets

| Limit                                      | Value                                  | Enforced by                                    |
| ------------------------------------------ | -------------------------------------- | ---------------------------------------------- |
| Snap step                                  | 0.5 %                                  | `GRADE_SNAP_STEP_PERCENT`, `gradeEdit.ts`      |
| Steepest typed or snapped grade            | ±100 % (the drag cap)                  | `MAX_EDIT_GRADE_PERCENT` from `MAX_DRAG_GRADE` |
| PVI spacing during a drag                  | at least 5 m from each neighbour       | `MIN_PVI_GAP_M`, `verticalTools.ts`            |
| PVI held by a control                      | within 0.5 m of the control's station  | `CONTROL_HOLD_M`                               |
| Tangent grip: drag threshold               | 4 px; a shorter press opens the grade  | `MIN_TANGENT_DRAG_PX`                          |
| Tangent grip shown                         | tangents at least 36 px long on screen | `MIN_TANGENT_GRIP_PX`                          |
| Fewest PVIs left by Delete                 | 2                                      | `MIN_PROFILE_PVIS`                             |
| Road end meeting another road              | within 5 m                             | `JUNCTION_SNAP_M`, `junctionTurn.ts`           |
| Junction markers per profile               | 60, by station                         | `MAX_PROFILE_JUNCTIONS`, `profileJunctions.ts` |
| Existing control counted as the junction's | within 1 m of its station              | `JUNCTION_CONTROL_MATCH_M`                     |
| Vertical controls per road                 | 200                                    | `MAX_VERTICAL_CONTROLS`; `project.ts` parser   |

A free drag rounds levels to the centimetre, as before. A typed or snapped grade keeps the level
it needs unrounded, so the grade reads exactly as entered.

## Assumptions

- **Grades are PVI to PVI.** A typed or snapped grade is the tangent's, not the grade on a vertical
  curve around it.
- **The other road's level** is its formation where it has a designed profile (two or more PVIs),
  and its ground where it does not; a mapped road follows the ground. Both are read from that
  road's last calculation, interpolated between its stations.
- **Junctions are found on calculated stations.** Crossings are found between the two roads'
  station lines, so on a tight curve the junction station can be off by a fraction of the station
  spacing.
- **Two design roads drawn from one start are alternatives**, not a junction, as in the junction
  turn check, and get no marker. A mapped road from the same point does.
- **A control added at a junction is exact.** Widen its tolerance in **Vertical standards** if the
  tie-in can be looser.

## Failure modes

- **A marker's level reads unknown.** The other road's terrain has a gap at the junction. Nothing
  is guessed; **Add control here** stays off.
- **No marker where roads plainly meet.** The end is more than 5 m from the other road, or both
  roads are design roads starting at the same point.
- **A PVI will not move.** It sits on a control it meets. Edit or remove the control, or hold the
  PVI and move the other end.
- **A typed grade is refused.** The grade on the moved PVI's far side would pass 100 %, or the moved
  PVI is held by a control: hold the other end instead.
- **Delete does nothing.** The profile has two PVIs, the fewest it keeps.
