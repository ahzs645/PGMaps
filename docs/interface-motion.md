# Interface motion

The shared implementation lives in `@pgmaps/geo-toolkit`. PG Maps adapters keep
theme, application events, and domain data at the host boundary. The Felt
[reference review](research/felt-motion-review.md) and
[synthetic study](research/felt-motion-study.html) explain the motivation; they
are not production code or a performance benchmark.

## Interaction rules

- Direct sheet/card/divider dragging follows the pointer without easing.
- Programmatic sheet and panel transitions use the shared 350 ms timing and
  cubic-out-style easing. Small popover and tooltip feedback uses 150 ms.
- A new action interrupts an old one. Grabbing a snapping sheet starts at its
  rendered position. Reopening or changing selection cancels pending removal.
- Filtering away the keyboard-focused result cancels its pending scroll jump
  and resets the results viewport, so the older jump cannot undo that action.
- Collapsed, rear, or closing bodies are inert immediately. Exposed stack
  controls and keyboard resize handles remain available.
- Full/compact/collapsed card detents support Arrow keys, Home/End, Space and
  Enter. Content scrolling does not become a sheet gesture away from its top
  boundary; card gestures start on its handle/header.
- The card's scroll port is sized to its visible height, so its bottom stays
  reachable. Keyboard/toolbar/safe-area handling remains in the shared sheet
  controller.
- Hidden desktop sidebars retain edits and child state. A docked bottom pane
  retains its last content through exit, then unmounts. Pass
  `bottomPaneResizing` while directly dragging its divider; the map's
  `deferResize` avoids reallocating its drawing buffer for every drag frame.
- Normal and reduced motion reach the same final state. Reduced motion removes
  spatial travel and the wait before an exit callback.

## Camera framing

`useFlyToSelection` accounts for the owning workspace's controls and feature
cards, including sibling or portalled cards registered on its interaction bus.
It uses native MapLibre offsets without leaving persistent padding. A discrete
sheet target can start a matching camera correction; direct manipulation defers
correction until release. Desktop size changes settle before correction.

A user map gesture cancels selection following. Changing selection or passing a
new `focusKey` requests it again. Independent workspace buses keep camera and
panel state separate; the legacy window bus exists only in host adapters.

The `/dev/data` row-selection camera uses that helper. Extent fitting and story
cameras retain their existing contracts; stories still fit cameras to their map
pane. No temporal playback or historical data has been inferred from Felt's HAR.

## Dialog and popover lifecycle

`DialogShell` starts closing immediately, then calls `onClose` and
`onOpenChange(false)` after exit. `onOpenChange(true)` remains immediate. This
lets conditionally mounted record dialogs animate before a host removes them.
A controlled reopen cancels pending callbacks and preserves edits. The record
footer's Close action uses the same path as Escape and the header button.

Native MapLibre popup and tooltip surfaces animate entry; MapLibre owns their
removal. DOM popovers/tooltips and layer legends retain closing content long
enough for their exit, with interaction disabled. Their anchor/focus behavior
continues to apply while the visual transition completes.

Animations are defined in toolkit CSS. No additional animation dependency or
optional Tailwind animation plugin is required.

## Verification

The toolkit's independent consumer has real MapLibre fixtures for normal and
reduced motion, touch dragging, interruption, stacking/focus, camera framing,
desktop state/canvas preservation, table reversal, and native/conditional
dialogs. Its own CI also verifies boundaries, lint, format, unit tests, the
packed consumer, nested workspaces, watch recovery, and MapLibre 6 compatibility.

PG Maps checks the pinned toolkit against its dependencies and tests
`/dev/data`, the shared mobile sheets, and the interaction demo. CI's software
WebGL renderer verifies behavior; perceived smoothness and hardware frame rate
still require representative physical-device profiling.
