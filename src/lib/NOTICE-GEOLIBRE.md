# GeoLibre adaptation

`colorVision.ts` adapts GeoLibre's colour-vision simulation (`apps/geolibre-desktop/src/lib/cvd-simulation.ts`
in [GeoLibre](https://github.com/opengeos/GeoLibre)): the mode list, the full-severity matrices of
Machado, Oliveira and Fernandes (2009) with the BT.709 luminance row for achromatopsia, and the
`feColorMatrix` value layout.

The map essentials (`src/components/ui/map-essentials.tsx` and the files it composes) follow
GeoLibre's map context menu, status bar, camera keys and *Identify* as ideas only; their code is
PGMaps' own.

Changes in this adaptation: PGMaps naming, a filter applied to the page's root element rather than
to the map canvases, so legends and sidebars are simulated with the map, and a session-only
setting.

GeoLibre is licensed under the MIT License:

```
MIT License

Copyright (c) 2026 Qiusheng Wu

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
```
