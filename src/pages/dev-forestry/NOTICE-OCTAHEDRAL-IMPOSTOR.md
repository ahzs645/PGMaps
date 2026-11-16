# three.ez octahedral impostor: what PGMaps takes from it

The road view's baked tree cards follow methods from
[@three.ez/octahedron-imposter](https://github.com/agargaro/octahedron-imposter) by Andrea Gargaro,
reviewed as version 0.0.1 in the `main` branch archive supplied on 15 November 2026. The upstream
work is under the MIT License, reproduced below.

No upstream code is included: the library patches three.js materials and bakes through three.js's
renderer, and PGMaps' tree layer is its own WebGL 2 inside a MapLibre layer, with no three.js in
the bundle. What is adapted is method, re-implemented in TypeScript and GLSL:

- **A baked impostor** (`impostorBake.ts`): an orthographic picture of the model from each of a
  set of directions, colour in one sheet and surface normal with depth in a second, the picture
  nearest the eye shown at draw time.
- **The model's own shading for its impostor** (`CROWN_LIGHT_GLSL` in `treeLayer.ts`): the card is
  lit by the function its mesh is lit by, from the baked normal.
- **An atlas written to image files to look at** (`scripts/forestry/tree-atlas/export.ts`).
- From the library's showcase scene: **a lower pixel ratio while the view moves**
  (`MovingResolution.tsx`), and **a cheap stand-in for a tree's shadow** (`treeShadows.ts`; the
  showcase casts each tree's shadow from a box).

Changes in this adaptation:

- Views ring the stem at eye level, eight of them, instead of covering a hemisphere on an
  octahedral grid. The road view looks within 45° of level, and a tree is close to round.
- Each view is as narrow as its tree, not a square round the bounding sphere, which leaves about
  seven tenths of a tall tree's cell empty.
- The bake is rasterised on the CPU, not rendered on the GPU, so it is the same bytes on every
  machine and runs in the unit tests.
- A stem shows one view, changing to the next at its own angle through a short dither, instead of
  a weighted blend of three. A blend of two cut-out outlines ghosts every branch; and with one
  view a pixel, a stand's cover is the mean of its views' cover, which
  `screenCoverage.test.ts` pins.
- The baked normal is corrected for a stem drawn wider than the tree its card was taken from.
- Depth is baked and kept in the second sheet but not yet used: the library's own depth parallax
  is commented out in the version reviewed.

Not taken: the library's tree and pine models, bark and leaf textures and ground image, which
carry no stated source; its hemi-octahedral mapping and three-view blend, which belong to a camera
that looks down on its trees (see `docs/forestry-visual-quality.md`, **Baked tree cards**, for when
that would be worth adding).

## MIT License

Copyright (c) 2025 Andrea Gargaro

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
