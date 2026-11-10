# Fitting the geometry of a mapped road

**Design → Fit geometry** (shown on a mapped road) reads the road's tangents and curves by least
squares, and copies the result as an editable design: intersection points with a radius, and a
spiral length when asked, at each bend. Use it to bring an existing road's geometry into a design
for upgrading, to read the radius of a bend from a LiDAR trace, or to see how well a map line
supports a radius at all.

The calculation is `leastSquaresFit.ts`, free of DOM, terrain and network access.
`polylineFit.ts` stays the tool for a found route or sketched line: it keeps a fitted line within a
stated distance of the source; this one minimises the offsets and reports them.

## Before you rely on it

- **It reads the points as loaded.** A mapped road is thinned when it is loaded (the panel shows
  the tolerance). Offsets are measured to the thinned line, which has already lost detail up to that
  tolerance.
- **A short or noisy bend does not fix its radius.** Each fitted radius comes with a standard
  error. When that is more than 10 % of the radius the radius is shown with a "?": the bend is too
  short for the scatter of its points. A 30 m arc measured to ±0.3 m can give anything from 58 m to
  70 m depending on the method (the reference case in `leastSquaresFit.test.ts`).
- **Tangents are held fixed.** Each curve is fitted between the two tangents found either side of
  it. A tangent read slightly off the road bench moves the PI and the curve with it.
- **A bend whose tangents do not meet is not forced.** A reverse bend with no straight between its
  curves, or tangents that meet behind one of them, is listed as not fitted and copied as the line's
  own vertices (sharp corners the design then needs curves at).
- **Copying never changes the mapped road.** The copy is a new design road, "Fitted design on …".

## How it fits

1. The line is resampled every 2 m, so the fit weighs length, not the density of vertices.
2. **Tangents.** From seeds along the line, a total-least-squares line (the principal axis of the
   points) is grown one point at a time, adding whichever neighbour keeps it tighter, while no point
   is further than the tolerance from it. The longest run becomes a tangent; the search repeats on
   the line either side. Runs shorter than the shortest tangent are not tangents.
3. **Curves.** For each pair of neighbouring tangents, the PI is where their lines meet and the
   deflection is the angle between them. The radius minimising the sum of squared perpendicular
   offsets of the points from the middle of one tangent to the middle of the next is found by a
   scan and golden-section search. With **Fit spirals**, the radius and a spiral length each side
   (the engine's symmetric spiral) are then refined together by a pattern search that moves both
   ways on both and halves its step. The curve is held inside the room the tangents leave.
4. **Fit quality.** RMS and largest offset over the bend's points, and the radius's standard error
   σ_R ≈ √(2σ²/f″(R)), with σ² the residual variance and f″ the curvature of the sum of squares at
   the fitted radius.
5. The free circle through each bend's points is also computed (Kåsa's algebraic fit refined to
   the geometric fit by Levenberg–Marquardt), with its own standard error from σ²(JᵀJ)⁻¹.

## Limits and budgets

| Limit                               | Value                                  | Enforced by                                  |
| ----------------------------------- | -------------------------------------- | -------------------------------------------- |
| Tangent tolerance                   | 0.05–20 m                              | `FIT_TOLERANCE_LIMITS`, `leastSquaresFit.ts` |
| Shortest tangent                    | 5–1,000 m                              | `FIT_MIN_TANGENT_LIMITS`                     |
| Resampling                          | every 2 m, at most 4,000 points a line | `FIT_SAMPLE_M`, `MAX_FIT_POINTS`             |
| Corner read as straight             | under 0.5° of deflection               | `MIN_FITTED_DEFLECTION_DEG`                  |
| Radius searched                     | 5–10,000 m, within the tangents' room  | `FIT_RADIUS_RANGE_M`                         |
| Radius flagged as poorly determined | standard error over 10 % of the radius | `POORLY_DETERMINED_SHARE`                    |

The fit runs when you press **Fit**, not on every edit. With spirals it takes up to about a second
on a road with many bends.

## Built-in assumptions

- Plan geometry only: no profile or crossfall is fitted here.
- Spirals are symmetric, the same length either side of a curve, as the road engine draws them.
- Offsets are perpendicular distances in a local plane about the road's first point.
- The standard errors assume independent offsets of equal scatter; a digitized line's errors are
  correlated along it, so read σ as a lower bound.

## Failure modes

- **No tangents.** The tolerance is tighter than the line's own scatter, or the shortest tangent is
  longer than any straight run. Loosen the tolerance or shorten the tangent.
- **Every bend "?"** on a map line: the line is too coarse to fix radii. Trace the road on LiDAR
  (Terrain → find the road on the terrain) and fit that.
- **Not fitted: the tangents are parallel.** An S-bend with no straight between its curves. Lower
  the shortest tangent so a short straight is found, or design that bend by hand.
- **The copied design has sharp corners.** Those are the bends listed as not fitted.

## Provenance

- Functional specification: RFLTools §4 and §13.4–§13.6 (clean-room stage 1, 10 November 2026).
  Written from that specification and the papers below; no code from RFLTools (GPL-3.0) was used.
  Unlike RFLTools, the algebraic fit solves a general 2×2 system, so points symmetric about an axis
  through their centroid are fitted like any others (the original divides by their cross-moment),
  and the spiral search moves both ways.
- Kåsa, I. (1976). A circle fitting procedure and its error analysis. _IEEE Trans. Instrumentation
  and Measurement_ IM-25(1):8–14. Bullock, R. (2006). _Least-squares circle fit_.
- Gander, W., Golub, G. H., Strebel, R. (1994). Least-squares fitting of circles and ellipses. _BIT_
  34:558–578. Chernov, N., Lesort, C. (2005). Least squares fitting of circles. _J. Math. Imaging
  and Vision_ 23:239–252.
- Golub, G. H., Van Loan, C. F. (2013). _Matrix Computations_, 4th ed. (total least squares).
- Meyer, C. F., Gibson, D. W. (1980). _Route Surveying and Design_, 5th ed.; TAC (2017) §3.2;
  AASHTO (2018) §3.3.8 (clothoid geometry).
- Checked against the specification's worked numbers (`leastSquaresFit.test.ts`): exact circle
  (100, 200), R 50; the noisy set's Kåsa centre (99.8523, 199.7380), R 50.2647, max 0.1361 and its
  geometric centre (99.8499, 199.7336), R 50.2687, max 0.1371; the short arc's Kåsa R 57.99 and
  geometric R 69.52; and the spiral–curve–spiral R 100, Ls 40, Δ 60° with Ts 78.0927 m recovered from
  a line traced off it.
