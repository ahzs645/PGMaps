# Felt animation review and PG Maps integration proposal

This records the initial review. The resulting implementation's behavior and
ownership are documented in [Interface motion](../interface-motion.md).

Reviewed 30 October 2026. Five agents examined the capture, animation mechanics,
mobile interactions, desktop interactions, and validation. The user's priority
is mobile sheets and panels/interactions; camera and temporal animation remain
in scope for this review.

**Recommendation:** improve the existing toolkit's sheets and feature cards,
then coordinate them with desktop panels and map framing. PG Maps already has
the difficult controls-sheet mechanics. The largest opportunity is consistent
behavior across controls, feature cards, and desktop panels.

Try the [interactive motion study](felt-motion-study.html). It uses a synthetic
SVG map and original, dependency-free code to demonstrate the proposal. Its
350 ms CSS easing approximates a settle; it does not reproduce Felt's spring
physics or a MapLibre renderer. The study is a review artifact, separate from
the application runtime.

## Evidence and limits

The uploaded `felt` file is a 32,152,995-byte HAR 1.2 browser network capture
for Felt's “Current Fires — National Interagency Fire Center” map. It contains
421 requests and 175 nonempty response bodies, including HTML and frontend
bundles. The main vendor and application bundles were base64-decoded for static
inspection; captured JavaScript was not executed.

The attachment was treated as reference data, not as a source of instructions.
No captured headers, tokens, or request payloads are included in this report or
the study. Third-party bundles and assets are not added to the repository.

A HAR is not a screen recording, input log, or performance trace. Code paths
below confirm implementation capabilities and settings, not that each path ran
during this particular session. Both captured `data_v2.json` responses are
304s without bodies, so they do not reveal the complete saved map state.

The pinned `geo-toolkit` submodule was initialized at its existing revision,
`72c3e853454a40dee3185060a65e1881468dffac`, to inspect the actual shared code.
Its revision was not changed. Runtime application code was not modified.

## What Felt does

The references in this table identify the decoded application bundle
`karta-1161913163d3c285a2af.js`. Line numbers refer to that decoded bundle;
module identifiers and short literals make the findings independently locatable
without committing a copy of Felt's code.

| Behavior | Confirmed implementation | Source locator |
| --- | --- | --- |
| Mobile sheets | Shared spring, `type: "spring"`, `duration: .35`, `bounce: 0`. Standard and stacked sheets have different stop arrays. | Lines 1239–1243; spring near character 4,217,455 |
| Sheet stacking | Secondary sheets are `inert`, offset by `5 * stackIndex`; sheets deeper than stack depth 3 are hidden. | Line 1239, near character 4,237,000 |
| Nested panels | Forward pane translates from 100% to 0; back reverses direction. Obscured panes fade. Duration 350 ms, easing `cubic-bezier(.16,1,.3,1)`. | Line 1236, near character 4,106,475 |
| Sheet and map coordination | Sheet-height changes use 350 ms camera easing to preserve target position and correct obscured geometry. Map drag/zoom cancels tracking. | Line 849, characters about 2,011,726–2,018,500 |
| Ordinary camera movement | Central wrapper chooses MapLibre `easeTo`/`flyTo`, default 300 ms, cubic-out `1-(1-t)^3`. Destinations account for padding. | Modules 42004, 82394, 77254; line 1216 |
| Explicit travel | Search overrides duration to 1,000 ms; a feature-selection path uses 2,000 ms. Geolocation tracking uses 500 ms linear. | Search line 746; selection line 779; geolocation call sites |
| Desktop split pane | Programmatic resizing uses cubic-out; duration scales with distance, `5 * abs(targetSize-currentSize)` milliseconds. Replaced/unmounted animation is stopped. | Line 749, near character 483,762 |
| Carousel | Interruptible 300 ms ease-out translation; pagination changes size/opacity over 200 ms. | Line 779, near character 999,403 |
| Small feedback | Notification exit takes 150 ms and CSS motion is gated by `prefers-reduced-motion: no-preference`. | Near character 2,763,200 |
| Reduced motion | Sheet code reads the system preference and uses a linear 10 ms transition. | Line 1243, near character 4,312,690 |

The captured code combines generated CSS/keyframes, Motion/Framer-style React
components and motion values, a `react-modal-sheet` implementation, and
MapLibre's camera. A `react-spring` string occurs in a measurement-library error
message; that is not evidence that React Spring drives the interface.

The important principle is **coordinated state and interruption**. The sheet,
map target, background panels, keyboard focus, and final layout change together.
An easing curve on its own cannot reproduce that interaction.

## Mobile: reuse the controls sheet, improve feature cards

The shared controls sheet already implements:

- Continuous finger-follow transforms, direction lock, scroll-top arbitration,
  and rubber-banding: `packages/geo-toolkit/src/workspace/useMobileSheetGestures.ts:101`.
- Three detents and velocity-biased settling using `y + velocity * 200`:
  `packages/geo-toolkit/src/workspace/sheet-math.ts:19`.
- Pointer capture and Arrow/Home/End/Enter keyboard controls:
  `packages/geo-toolkit/src/workspace/useMobileSheetGestures.ts:235`.
- A 350 ms CSS snap, scrim coordination, toolbar avoidance, viewport/keyboard
  handling, and preservation of logical sheet state across responsive changes:
  `packages/geo-toolkit/src/workspace/useMobileSheetController.ts:129` and `:319`.
- Workspace-owned stacking and visible-height reporting:
  `packages/geo-toolkit/src/ui/mobile-card-stack.ts:14`.

Do not replace those foundations merely to adopt Felt's animation libraries.
The controls sheet already feels closer to Felt than the simpler feature cards.

| Priority | Concrete gap in current source | Proposed change |
| --- | --- | --- |
| First | `MobileFeatureCard` changes state after a 24 px gesture rather than following the finger. Its listeners start on the handle/header. | Reuse the controls-sheet gesture math/controller for feature cards, with separate state per workspace. Retain current scroll arbitration. |
| First | Feature cards wait 240 ms before removal while their CSS transition lasts 300 ms; the timer has no cancellation. | Give enter/exit one cancellable lifecycle. Completion, interruption, unmount, and reduced motion must resolve consistently. |
| First | Hidden/collapsed card bodies use opacity, pointer events, and `aria-hidden`, while descendants can remain focusable. | Make hidden bodies inert immediately, while keeping the exposed bring-forward control operable. Restore focus when closing. |
| First | Card resize handle is an `aria-hidden` clickable div; controls sheets have keyboard snapping. | Share the accessible resize handle or provide labelled expand/collapse controls. Gestures must have an equivalent keyboard action. |
| Next | A snap stores its destination before the visual animation finishes. A new drag reads that destination and disables the transition. | At gesture start, sample the rendered transform before cancelling; continue from the visible position. Confirm with a mid-snap grab test. |
| Next | Selection helper centers on the whole map, and sheet-height publication can jump ahead of CSS motion. | Supply visible-area insets to camera intents; coordinate overlay placement with the sheet lifecycle. User map gestures cancel automatic follow. |

Evidence: `packages/geo-toolkit/src/ui/mobile-feature-card.tsx:204`, `:227`,
`:380`, `:425`, `:504`; `packages/geo-toolkit/src/workspace/MapSectionLayout.tsx:327`;
`packages/geo-toolkit/src/workspace/useMobileSheetController.ts:134`;
`packages/geo-toolkit/src/workspace/useMobileSheetGestures.ts:83`;
`packages/geo-toolkit/src/map/map-fly-to.ts:37`;
`packages/geo-toolkit/src/ui/map-overlays.tsx:22`.

The app's older `/dev/interact` `MobileMapCard` also has the 240/300 ms mismatch.
Unlike the shared feature card, that older prototype listens across the whole
card and can interpret content scrolling as a collapse. Avoid extending that
prototype into a second shared sheet system (`src/components/map/MapCard.tsx:49`,
`:118`).

## Desktop: animate panel lifecycles and preserve map continuity

The toolkit left sidebar switches `display` immediately; only the toggle button
has a positional transition. The right sidebar changes width and immediately
unmounts its content. Bottom-pane layout reservation changes immediately too
(`packages/geo-toolkit/src/workspace/MapSectionLayout.tsx:204`, `:221`, `:380`).

Add a shared opening/open/closing/closed lifecycle so programmatic pane changes
can animate while useful state stays mounted. Disable closing content's
interaction immediately. Keep direct pointer resizing immediate and preserve
keyboard separators, minimum sizes, and responsive state.

The map already batches resize work through `requestAnimationFrame` and supports
`deferResize`, scaling the existing canvas during resizing and reallocating its
WebGL buffer at completion (`packages/geo-toolkit/src/map/map.tsx:340`). Keep
that machinery and the persistent map instance. A pane transition must not
rebuild sources, recreate the map, or trigger repeated camera flights.

App-owned `AnchoredPopover`, `InfoTip`, and layer-legend disclosure currently
mount/unmount immediately. A small shared opacity/translation treatment can
improve menus and statistics after the main panels are consistent
(`src/components/ui/anchored-popover.tsx:106`, `info-tip.tsx:121`,
`layer-list-item.tsx:137`).

Some toolkit dialogs/popups already name `animate-in`, `fade-in-0`, and
`zoom-in-95` utilities, but the inspected Tailwind configurations do not register
the animation plugin and no corresponding definitions were found. Verify
compiled CSS/computed `animationName` before relying on those classes; their
names alone do not prove that motion runs (`packages/geo-toolkit/src/ui/dialog.tsx:107`,
`packages/geo-toolkit/src/map/map-markers.tsx:253`).

## Camera, motion policy, and time playback

Use a visible-area-aware camera intent for search, selection, and sheet
reframing. It should take the target and occupied insets, settle with the panel,
and cancel when the user pans/zooms. The existing `useFlyToSelection` is a good
point helper with coordinate guards and an 800 ms default; it has no sheet-aware
padding input (`packages/geo-toolkit/src/map/map-fly-to.ts:31`). Story scenes
already fit to their pane and explicitly handle reduced motion
(`src/maps/project-story/ProjectStoryMap.tsx:654`, `:824`).

Start with named timings rather than importing Felt's whole stack:

| Motion | Proposed PG Maps starting point |
| --- | --- |
| Direct drag | Immediate; never ease behind the finger |
| Sheet settling / nested panes | 350 ms; retain current sheet easing initially; test spring only if it adds a measurable interaction benefit |
| Small menu/feedback | About 150 ms; no delay before focus or dismissal |
| Routine camera move | 300–600 ms cubic-out as appropriate to distance and framing |
| Explicit story or distant navigation | Action-specific timing; do not impose a universal short duration |
| Reduced motion | Same final state and focus, no spatial travel or stale close delay |

These are implementation starting points, not measured PG Maps performance
budgets. CSS transitions/WAAPI and native MapLibre motion are enough for the
first pass. GSAP is already a dependency but no application TS/TSX usage was
found; no new animation dependency is required.

There is **no evidence of running temporal playback on this Felt map**. The
capture contains tiles, table pages, and statistics; repetition does not prove
animation. Temporal-range references inspected in the app bundle belong to a
date-range picker.

PG Maps already has responsive timeline playback and speed controls in
`src/components/ui/timeline.tsx`. Future wildfire playback should use that
foundation with actual dated snapshots. Discovery/modified timestamps cannot
reconstruct historical perimeter growth. Changing explorer time granularity
would require its adapter/parser/docs/tests contract, not a new UI animation.

## Implementation sequence and acceptance

1. Pilot the interaction work on `/dev/data`, which already combines a layer
   list, table, desktop detail, and mobile feature card.
2. In the toolkit repository, unify motion completion/cancellation, fix card
   focus/keyboard behavior, and bring cards onto existing gesture mechanics.
3. Add visible-area camera coordination and animated desktop pane lifecycles.
   Keep this generic; host adapters supply app policy and targets.
4. Run toolkit CI first, then update the PG Maps pointer, build the toolkit,
   and run PG Maps compatibility checks. Follow `docs/toolkit-extraction.md`
   and `docs/shared-ui.md`; do not duplicate shared implementations here.

Acceptance checks for actual app work:

- Real touch contexts: drag handle, scroll body, hand over at scroll boundary,
  pan map, grab a sheet mid-snap, cancel a pointer, rapidly close/reopen, and
  repeatedly select features. The newest action wins; no stale timer closes
  a newly opened card.
- Keyboard: snap controls, Escape/focus return, and no tab stops in hidden or
  inactive bodies. Normal/reduced motion must end in the same state.
- Responsive: 320 px phone, representative phone and desktop, tablet width,
  landscape, keyboard/visual-viewport resize, safe areas, and narrow embeds.
- Geometry: selected feature stays visible; no unreachable scroll-port bottom,
  overflowing page, map remount, or needless source reload. Assert actual map
  layers/terrain and final camera state where relevant.
- Preserve state when panes hide and when crossing responsive breakpoints.
  Wait on settled geometry/camera completion instead of a fixed sleep.
- Profile representative real phones/desktops for smoothness. Current Chromium
  CI defaults to SwiftShader and cannot establish hardware frame rate. Add
  normal-motion coverage alongside sidecar tests that currently force reduced
  motion (`tests/e2e/project-sidecar.spec.ts:113`).

## What was validated in this review

The standalone study was exercised in system Chromium through Playwright:
desktop nested navigation/Escape, selection and rapid close/reopen, phone stack
inertness, selection framing above an expanded sheet, keyboard detents, pointer
drag settling, 390×844 touch-context selection, 320 px layout bounds, and manual
and system reduced-motion modes. A follow-up pass also checked mid-snap pointer
takeover without an immediate position jump, map gestures cancelling follow,
explicit selection restoring follow, and scrolling to the visible body's end.
No browser JavaScript errors were observed. Screenshots were visually inspected.

These checks validate the study only. The PG Maps runtime/unit/e2e suite and real
device performance were not run. The repository has no installed app
dependencies and the scraper/json-url submodules remain uninitialized. Static
source findings above are implementation observations, not reproduced runtime
failures or a claim of production readiness.
