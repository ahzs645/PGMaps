# What the six network scenarios show

The browser planner includes six small scenarios for learning how network methods,
constraints and development stages change the result. Open **Design → Plan road
network**, choose **Example or imported raster scenario**, select an example and
enable **Compare all four methods**. The [workflow guide](network-planning.md)
explains the controls, exports and transfer into detailed road design.

The numbers below were calculated from implementation revision
[`ce6b80e59b3c03b8596ead7cc42ca9ba8e585b83`](https://github.com/ahzs645/PGMaps/commit/ce6b80e59b3c03b8596ead7cc42ca9ba8e585b83),
using the example defaults and the actual stage runner. Inputs come from
[`examples.ts`](https://github.com/ahzs645/PGMaps/blob/ce6b80e59b3c03b8596ead7cc42ca9ba8e585b83/src/pages/dev-forestry-roads/roads/examples.ts).
CLUS is a published synthetic reference fixture; the other five are synthetic
teaching scenarios. None is a surveyed site or a recommended construction plan.

## Compare new construction and target coverage together

Each value is **unique new raster-edge length in metres**, rounded to one decimal.
Shared edges are counted once. All targets are reached unless a reached/total
count appears in parentheses. A shorter incomplete network is not a successful
alternative to a complete one.

| Scenario | Independent LCP | Iterative LCP | MST | Straight snap |
| --- | ---: | ---: | ---: | ---: |
| CLUS reference · 4 targets | 13.9 | 10.5 | 11.1 | 12.0 |
| Shared spurs · 6 targets | 1,272.5 | 909.7 | 858.0 | 2,040.0 |
| Wetland crossing or detour · 3 targets | 1,026.3 | 696.6 | 693.1 | 440.0 **(1/3)** |
| Hillside with grade limits · 3 targets | 1,729.7 | 1,369.7 | 1,299.4 | 960.0 **(2/3)** |
| Three-period harvest · 6 targets | 986.3 | 881.4 | 881.4 | 978.0 |
| Disconnected ground · 3 targets | 160.0 **(1/3)** | 160.0 **(1/3)** | 160.0 **(1/3)** | 160.0 **(1/3)** |

CLUS uses a 5 × 5 grid with 1 m cells. The hillside uses 41 × 31 cells at 20 m;
the remaining examples use 25 × 25 cells at 20 m. These resolutions are part of
the experiment, not recommendations for a real project.

## 1. CLUS: no method dominates every example

ILCP produces less new construction than MST here, and its relative construction
objective is lower: **63.005 versus 65.051**. LCP's objective is 69.509 and snap's
is 118.173. MST selects a tree over pairwise terminal paths; it does not guarantee
the cheapest geometric network after shared construction is considered. Use
the comparison to inspect alternatives instead of assuming one method always wins.

## 2. Shared spurs: plan several landings together

All six targets are reached by every method. ILCP uses **28.5% less new road**
than independent LCP; MST uses **32.6% less**. The MST construction objective is
994.381, compared with LCP's 1,358.546. Shared trunks and branches explain why a
multi-landing network can differ substantially from a collection of independently
designed access roads. Change the ILCP order to explore its sequencing sensitivity.

## 3. Wetland: distinguish exclusion from expense

The three routed methods reach all targets and avoid the expensive crossing
corridor entirely. Snap reaches only the middle target, traversing seven high-weight
crossing cells; the straight routes to the outer targets intersect excluded cells.
Its incomplete network scores 1,970, compared with 683.137 for the complete MST
network. This demonstrates both hard no-build areas and traversable but costly ground.

## 4. Hillside: screen grades before refining geometry

With the example's **12% ground-grade limit**, all three routed methods reach all
targets. Their largest raster-edge grade is **11.886%**. Snap cannot connect the
central landing, so its shorter 960 m result is incomplete. MST uses 24.9% less
new road than LCP. These grades belong to terrain-sampled grid paths: adopted
branches still need exact junctions, horizontal curves or switchbacks, a designed
vertical profile and footprint checks in the detailed designer.

## 5. Staged harvest: the sequence changes the available network

This introduces the shared-spur example's six targets over three periods while
retaining constructed graph edges. Staged ILCP and MST both produce **881.4 m**.
That is 2.7% longer than planning all targets together with MST, but 3.1% shorter
than planning them together with ILCP. Neither direction is a general rule.
Period boundaries change existing access and nearest-road endpoints. LCP remains
independent within each period; roads built in previous periods can still be reused.

## 6. Disconnected ground: failure is a useful result

Every method reaches one target and reports two unreachable targets, building
the same 160 m feasible branch with objective 150. The model neither opens the
excluded barrier nor presents a disconnected landing tree as completed access.
Inspect the target outcomes before comparing totals or adopting a branch.

## Reproduce the calculation

From the PGMaps repository root, with its existing dependencies installed, run
the following. It uses the existing `tsx` dependency; no extra package is needed.
For the recorded numbers, use the implementation revision linked above.

```bash
node --import tsx --input-type=module <<'JS'
import { ROADS_EXAMPLES, prepExData } from './src/pages/dev-forestry-roads/roads/examples.ts'
import { runNetworkStages } from './src/pages/dev-forestry-roads/roads/stages.ts'

const rows = []
for (const { id } of ROADS_EXAMPLES) {
  const example = prepExData(id)
  const stages = example.stages?.map(s => s.landings) ?? [example.input.landings]
  for (const method of ['lcp', 'ilcp', 'mst', 'snap']) {
    const result = runNetworkStages({
      ...example.input,
      options: { ...example.input.options, method },
    }, stages)
    const reached = result.targets.filter(t =>
      t.status === 'connected' || t.status === 'already-connected').length
    rows.push({
      scenario: id, method, reached: `${reached}/${result.targets.length}`,
      newMetres: result.newLengthM.toFixed(3),
      relativeObjective: result.objective.toFixed(3),
    })
  }
}
console.table(rows)
JS
```

The objective sums original weights on unique newly constructed edges. It is
**not a currency estimate**, and scores from differently scaled example rasters
are not comparable. These runs demonstrate documented scenarios, not universal
optimality, full R-runtime equivalence or construction readiness. See the
[compatibility inventory](roads-package-compatibility.md) for those distinctions.
