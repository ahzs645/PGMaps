# PGMaps adapter quality controls

The active Nanite and worldgen adapters share `render-options-v1`. These controls
apply to their PGMaps entry points only. Standalone engine demos keep their defaults.
PGMaps stores a separate choice for each engine in this browser, outside the scene
configuration and assessment fingerprint.

| Control            | Default in PGMaps | Effect                                                                    |
| ------------------ | ----------------- | ------------------------------------------------------------------------- |
| Live resolution    | 100%              | 50–100% of the adapter's existing pixel ratio; camera framing stays fixed |
| Live frame limit   | Unlimited         | Optional 15–120 submitted frames per second                               |
| Pending GPU frames | 2                 | At most 1–3 live submissions awaiting completion                          |
| Dissolve mode      | Relative          | Pixel threshold scales with image height relative to the reference        |
| Dissolve threshold | 4 pixels          | Larger thresholds transition to canopy sooner                             |
| Reference height   | 1080 pixels       | Reference for relative dissolve                                           |
| Frustum culling    | On                | Conservative camera bounds for adapter forest batches                     |

The message is `{type:'pgmaps-render-options', options:Partial<RenderOptions>}`.
It changes display state without rebuilding placement. Adapters advertise the
capability in their hello; older pages receive no unfamiliar controls.

Relative dissolve uses `threshold * imageHeight / referenceHeight`, following
[VNS's resolution-relative dissolve](https://3dnature.com/downloads/tutorial-videos/getting-started-vns-3-part-5-fields-forest/gswvns3-05f/).
Consequently changing live scale or final image height does not by itself move the
physical tree/canopy transition. Fixed-pixel mode remains available. Each adapter
bounds the full transition by its actual patch coverage, including eye offset
and a guard, to prevent a gap when the requested pixel cutoff exceeds that coverage.

Final requests carry a frozen `renderOptions` snapshot. Captures use the requested
image dimensions and bypass live scaling, pacing and queue limits. They restore
the latest live settings on success or failure. Dissolve settings enter the final
image's cache key; live scale and pacing do not. Applied settings and reported
geometry approximations are retained in the saved image's illustration provenance.
The capture's existing `canopyCutoffPx` remains the quality threshold input.

Stats distinguish submitted FPS from completed FPS and report submit-to-completion
latency. Completion includes queued GPU work; it is not a pure GPU timestamp.
Renderer memory and draw counters are diagnostics, not evidence of a hardware
speedup. Software Vulkan/SwiftShader results must be identified as software results.

PGMaps omits unused embedded tree meshes when posting to these procedural adapters.
Downloaded scene packages retain their models for other consumers. Component data
and old-engine conversion are described in the adjacent stand-components contract.

The native MapLibre renderer, analysis, placement grid and assessment calculations
are outside these controls. Expansion remains recorded metadata: changing display
quality does not invent extra assessment stems. Procedural crown topology and
species presets are approximations even when measured dimensions are preserved.
