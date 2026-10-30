# Dated evidence for existing-road condition

The existing-road review can retain an inspection report or dated imagery link and use it to estimate
a **planning condition as of a chosen date**. This organizes evidence for comparing access options.
It does not predict deterioration, establish a construction year, grant access, or calculate a bridge
load rating. No age is inferred from a tenure award, record creation, retrieval or retirement date.

## Recording and reviewing evidence

1. Select the exact road section under **Terrain → Existing roads & reuse** and locate it on the plan.
2. Open **Add an inspection or imagery observation**. Record the inspection date or image acquisition
   date, the source URL, findings and notes. A link retrieval date is not an observation date. Record
   visibility, season, intended use, inspected limits and missing coverage in the notes.
3. Choose **Overall road**, **Road surface**, **Road drainage**, **Bridge** or **Culvert**. Give a
   structure ID or station when the observation concerns a particular asset. Evidence for one bridge
   is not evidence for another. A positive surface-only observation does not establish the whole road.
4. Record the reviewer and review date when a person has reviewed that evidence. The review date must
   follow the observation date. A typed name is attribution supplied by the user; the application does
   not authenticate professional registration, competence or a signature.
5. Enter separate maximum evidence ages for inspection and imagery, and the assessment date. Both
   ages start **unset**, so no source is treated as current until its planning applicability is chosen.
   These are project assumptions, not regulatory inspection schedules or calibrated deterioration
   parameters. The assessment reports the age, applicable records and earliest window ending date.
6. Read conflicts, unresolved closures, expired observations and component findings before using the
   estimate. **Use estimate as planning condition** explicitly copies a result into the separate manual
   planning condition as an assumption. Adding evidence, changing its age window or reviewing an image
   never silently edits the manual condition, marks it field verified, or approves road reuse.

The source link and notes are retained in the project; linked images and reports are not downloaded,
embedded or automatically interpreted. A private report must remain accessible to its intended
reviewers. Copying a project does not change the source's permissions.

## How the estimate is resolved

`roadCondition.ts` is a pure calculation over saved observations, an explicit date and a source-age
policy. It never reads the current clock or the basemap. Calendar dates use `YYYY-MM-DD` without
timezone conversion, and age is the whole number of calendar days since the observation.

| Evidence state | Treatment |
| --- | --- |
| Review missing | Retained for review; cannot establish a current positive estimate |
| Observation or review after the assessment date | Future evidence; does not participate at that date |
| Source-age window unset | Source is unassessed; no automatic age default |
| Age equal to the configured maximum | Still within the window on that date |
| Age beyond the maximum | Expired; current condition becomes unknown where evidence is missing |
| Multiple current findings for the same component and asset disagree | Conflict retained; a later date alone does not choose a winner |
| Reviewed applicable record explicitly replaces an earlier record | Replaces that record and its supersession chain for the same component and asset |
| Earlier reviewed closure has no applicable explicit resolution | Remains an unresolved closure flag, including after its age window expires |
| Imagery says a bridge or culvert is serviceable | Insufficient source for that positive structure finding |

A current closure blocks reuse. An old reviewed closure does not prove that the road is still closed,
but expiry does not reopen it: the current condition remains unknown and the unresolved closure flag
continues to block the network. A new positive record must explicitly resolve the earlier closure.
An unknown finding cannot resolve a closure. Imagery cannot clear an earlier bridge or culvert
closure; record an appropriate reviewed inspection instead. An explicit manual **closed** condition
also remains blocking until the reviewer changes it.

Otherwise, applicable rehabilitation findings identify known work needs; an overall positive record
can support a serviceable planning estimate; missing, contradictory or explicitly unknown findings
leave the condition unknown. These categories are screening inputs. They do not assign rehabilitation
quantities or prices. Two different structures with different findings are separate component/asset
assessments, rather than an artificial conflict between assets.

The full-cost network's **require current condition evidence** policy requires a consistent current
positive estimate, in addition to the explicit road-reuse permission and its independent access,
season, direction, grade, vehicle and structure checks. An unresolved closure remains blocking even
when current-evidence checking is switched off. A road condition estimate always reports
`truckCapacityEstablished: false`; neither a fresh photograph nor a generic inspection finding supplies
a numerical bridge load rating or an authorization for a loaded logging truck.

## Storage and bounds

Observations live in `roadEvidence.observations`; source-age assumptions live in
`roadEvidence.conditionPolicy`. The full-cost planning date is `totalCostPlanning.asOf`. The estimate
is derived again from those inputs, so it is not saved as a timeless condition claim. Project JSON,
road GeoJSON properties and BC record refreshes preserve the entered evidence. Existing manual
`condition`, `conditionBasis`, `reuseAllowed` and known `constructionYear` remain separate fields.

When a BC refresh changes a same-ID section's geometry, including a reversal, the application retains
the old observations and restriction inputs as history but sets `roadEvidence.geometryReviewRequired`
and disables reuse. Repeated refreshes cannot clear that marker. Locate the updated line and check
that the retained records apply to its full scope, direction and structures; replace evidence where
needed. **Confirm evidence scope for updated geometry** clears the marker but leaves reuse off until
the reviewer explicitly enables it again. The graph also blocks the marker independently, and project
imports cannot combine a pending geometry review with enabled reuse.

| Bound | Enforced in | Result |
| --- | --- | --- |
| 100 observations per road | `roadCondition.ts`, `MAX_ROAD_CONDITION_OBSERVATIONS` | Import or add refused beyond the bound |
| Up to 100 replaced IDs per observation | `parseRoadConditionObservations` | Invalid, missing, duplicate, cyclic, later-dated or other-asset targets refused |
| 2,000-character URL and notes; 200-character reviewer/asset reference | `parseRoadConditionObservations` | Invalid record refused |
| Full HTTP/HTTPS URLs, without embedded credentials | `parseRoadConditionObservations` | Script, local-file, relative and credential-bearing links refused |
| Integer age windows from 0 to 36,500 days, or unset | `MAX_CONDITION_EVIDENCE_AGE_DAYS`, `parseRoadConditionPolicy` | Invalid policy refused; this is an input bound, not a recommended inspection interval |

Tests cover source-specific expiry boundaries, future and unreviewed evidence, component/asset scope,
conflicting findings, explicit replacement chains, historical closure retention, imagery limits and
portable input validation:

```sh
npx vitest run src/pages/dev-forestry-roads/roadCondition.test.ts
```

## BC sources informing the workflow

The [BC Engineering Manual](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/resource-roads/engineering-manual/engineering_manual.pdf),
downloaded for this review on October 28, 2026, is dated **May 25, 2026**. Section 6.4 (printed
pp. 265–269) describes documented, risk-based road inspections with scope covering surface, drainage,
slopes, access and other features; it also distinguishes inspection intensity. That supports retaining
the observation's scope and findings rather than treating a photograph or record timestamp as an
all-purpose road inspection. Section 2.1.2 discusses maps and digital imagery as planning information.

Section 6.5 (printed pp. 272 onward) treats major-crossing inspections and load-rating work separately
from road maintenance condition. The [FSR structure standards](https://www2.gov.bc.ca/gov/content/industry/natural-resource-use/resource-roads/engineering-standards-guidelines/bridge-guidelines-standards-specifications)
and [Bridge Standards Manual](https://www2.gov.bc.ca/gov/content/industry/natural-resource-use/resource-roads/engineering-standards-guidelines/bridge-guidelines-standards-specifications/bridge-standards-manual)
provide the relevant structure design and evaluation context. The application does not turn those
documents' schedules or professional roles into a universal age cutoff or a substitute load rating.
