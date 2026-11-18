# Page icons

Each page's browser-tab icon is listed in `src/config/page-icons.json`:

```json
{
  "default": "favicon.svg",
  "routes": [{ "path": "/dev/forestry/road-design", "icon": "brand/access.svg" }]
}
```

- `icon` names a file under `public/` (`.svg`, `.png` or `.ico`), without a leading slash. It is resolved against the deploy base, so it holds under `VITE_BASE_PATH`.
- `path` covers that page and everything below it (`/help` covers `/help/first-road`, not `/helpers`). The longest listed path wins; anything unlisted gets `default`.
- Two things read the file, both through `src/lib/pageIcons.ts`:
  - the app shell's `usePageIcon` (`src/hooks/usePageIcon.ts`, mounted once in `App.tsx`), which swaps the tab icon as the route changes;
  - `scripts/write-spa-fallback.mjs`, which writes the route's icon into its entry page (`dist/<route>/index.html`), so the tab is right before any script runs. A route that has no entry page there still gets its icon once the app loads.
- A page never sets its own icon. Add a row to the JSON instead.
- The standalone road designer has one page, so `standalone/forestry-road-design/index.html` names its icon directly.

## The DDC product tiles

The road designer and its help (`/help`) show the DDC Access tile, `public/brand/access.svg`: a midnight (`#0B2B4A`) square, the six-dot symbol in white and a band of the product's accent across the bottom 12%. The family's other tiles differ only in that band's colour (Atlas `#7FA6BA`, Forest `#3F7055`, Fire `#CD6448`, Land `#AD8A4E`). To give another tool one, save the tile as `public/brand/<product>.svg` with the same markup and the band changed, then add its route. A tool that should work offline also keeps the file in its `offlinePrecache` group (`vite.config.ts`); `brand/` is already in the road designer's.

`pageIcons.test.ts` checks that every listed icon exists in `public/`.
