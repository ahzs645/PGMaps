# Training: connected access, gravel and condition

Load **Projects → Browse example scenarios → Training · connected access, gravel and condition**.
This offline example compares two new roads from the same synthetic harvest block to a connected,
U-shaped road network. It combines final connector checks, dated road condition, vehicle restrictions,
material quantities, source capacity and actual road-network haul.

Every observation, road permission, vehicle allowance, source and price in this example is invented
for teaching. The linked `example.invalid` inspection URLs are deliberately labelled synthetic and
do not represent field reports. The project uses the same **synthetic hillside terrain** and terrain
identity as the other offline examples; saved projects restore that same sampler. It is not real
Prince George terrain, and none of its inputs establish permission to use a road or take gravel.

## What is loaded

- **Connector A** builds roughly 100 m east from the block. The aggregate source is at the opposite
  end of the U, about 2.5 km away along the connected road network.
- **Connector B** builds roughly 400 m west from the same start and reaches the aggregate source
  directly. Both have independent vertical controls sampled from the synthetic terrain at no more
  than 20 m spacing, with an explicitly entered section template and costs.
- **Three existing-road sections** form the U, with declared junctions, grades sampled from the
  synthetic ground, explicit summer/logging-truck/weight assumptions, bidirectional travel and
  explicit zero allowances for rehabilitation, structures, access and setup. The initial no-bridge
  assumption is part of this invented example, not a detection result.
- **Dated overall-road observations** on all three roads were observed on October 27, 2026 and
  reviewed by the synthetic scenario reviewer on October 28. The assessment date is October 28,
  2026, and the maximum inspection age is explicitly set to 365 days. These demonstration values
  are not prescribed inspection intervals. Manual condition remains a separate planning assumption.
- **Aggregate at B** has zero acquisition and handling rates entered explicitly and a shared
  100,000 compacted m³ capacity for surfacing and fill. A separate waste-disposal source at B has
  an independent 100,000 bank m³ capacity and explicit zero disposal/handling/setup rates. Source
  entrances sit on the connected road, rather than at a nearest polygon centre.

Loaded and return haul rates start at zero as explicit teaching inputs; the road network must still
support each required direction. Zero transport prices do not permit a disconnected or restricted
route. These zero rates and capacities are placeholders for exploring behaviour, not quotes.

## Comparisons to try

1. Compare the two checked alternatives with the initial zero haul rates. The shorter new road A
   wins on these inputs.
2. Set the loaded actual-network haul rate to **40 CAD/(m³·km)** while retaining the separately
   entered zero return allowance. B wins because its longer construction avoids the connected
   source haul around the U. For a real quote, enter the return-cycle cost separately or document
   that the loaded rate already includes it; no reverse path is assumed merely because its price
   is zero.
3. Return the haul rate to zero and set the **A arm's rehabilitation price to 10 CAD/m**. B wins
   because it does not require that arm. These are sensitivity values, not BC cost benchmarks.
4. Mark a simulated bridge/structure restriction **closed** on the A arm. A becomes unavailable;
   B can still reach the source and outlet through its own arm. An unavailable path receives no
   fabricated priced total.
5. With **require current condition evidence** enabled, advance the planning date to
   **January 1, 2028**. All three dated road observations have expired, so the network is unavailable
   under that policy. The entered manual serviceable/assumed conditions remain unchanged. Add and
   review appropriate newer evidence to investigate reopening the comparison; do not treat a tenure
   timestamp as an inspection date.
6. Disable the aggregate source or reduce its shared capacity below demand. An unmet material need
   stays unresolved; the comparison does not fall back to an unconnected free pit or an unquoted
   base supply rate. The waste source's bank capacity cannot supply compacted fill.

Read the [dated evidence guide](road-condition-evidence.md) for conflicts, replacements and unresolved
closures. Condition estimates never establish loaded-truck bridge capacity. Final connector checks
remain separate from existing-road restrictions and source availability.

The fixture tests use the actual synthetic terrain, dense final connector checks, connected graph and
the same full-cost evaluator as the UI. They verify the winner changes, disconnected/restricted paths,
evidence expiry and project restoration:

```sh
npx vitest run src/pages/dev-forestry-roads/trainingFullCostScenario.test.ts
```
