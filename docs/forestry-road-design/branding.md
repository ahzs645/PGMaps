# Brandkit branding

Open **Branding** from the workspace header or Ribbon **Find tools**. Import a single-brand Brandkit ZIP pack or `brandkit/consumer-profile/1` JSON, preview its complete light and reverse artwork, then choose any combination of workspace, help, and report/drawing branding. Importing saves a preview; **Apply choices** activates it. Selecting **DDC Access (default)** restores the built-in identity. Removing an active brand also restores that identity.

**Interface theme** opens the shared PGMaps Appearance editor. Preview a preset, edit either palette, and adjust the corner radius with any brand selected. Apply the theme across PGMaps or copy its CSS variables. Reset the primary colour to use the workspace brand's colour again.

Brands and choices live in this browser's IndexedDB, not the project file. Existing project names, organisation fields, road calculations, map symbols, and status colours retain their meaning. An explicitly uploaded block-sheet logo takes precedence over the selected brand. Screen and HTML typography is optional, independently of PDF typography. Consumer profiles name fonts but do not carry binaries; unavailable faces use fallback fonts.

## PDF fonts

**Use brand fonts in PDF** starts off. Standard PDF fonts work with every accepted profile while the logo retains its original geometry and colours. Embedded PDF fonts require supplied TrueType-outline TTF body and heading faces. OpenType/CFF and web fonts remain available on screen and in HTML but cannot be opted into PGMaps' jsPDF path. The dialog explains this limitation and disables that option. The supplied Province of British Columbia 1977 and B.C.Hydro 1983 packs use OTF/CFF fonts; both have been checked with standard-font report PDFs.

## Reports, drawings, and lessons

The selected export identity reaches report HTML/PDF, map PDF, plot-book HTML/PDF, D-line sheets, and block-map sheets. Artwork is fitted without stretching, recolouring, or cropping. Print paths honour supplied numeric minimum logo widths and clear-space ratios, and refuse a slot that is too small. Textual identity rules and historical reconstruction status remain available in the profile and preview; applying a historical pack does not make it a current official identity.

Downloaded report HTML and offline lessons freeze the chosen profile, artwork, font data, and font notices. Changing browser preferences later does not change that download. Workbench and Ribbon lesson downloads contain their playback assets, including the hand-written capture guards. Ordinary help pages follow the current help choice. Screen font files are packaged only when supplied by the pack or resolved from the pinned Brandkit library; source and affiliation URLs remain metadata.

## Integration and limits

`vendor/brandkit` is pinned to `7036dcbdcb7da3bdedf02ad62f3a1b2c9237054d`. The importer uses its `engine/consumer.js`, `fonts/provider.js`, and data-only `pack/host.js` entry points. It does not run pack HTML, extensions, or the Brandkit studio. Shared library fonts resolve only through the pinned local font library, with manifest hashes checked when supplied. Reinitialise submodules after checkout.

| Limit                                                  | Enforcing code                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| 32 MiB uploaded file; 4 MiB consumer JSON              | `importBrand.ts`: `MAX_ZIP`, `importBrand`                          |
| 64 MiB expanded ZIP; 16 MiB per member; 4,000 members  | `importBrand.ts`: `MAX_EXPANDED`, `brandArchive`                    |
| One source brand or consumer profile per import        | `importBrand.ts`: `importBrand`                                     |
| 8 MiB saved brand, 24 font faces, 2 MB per source font | `model.ts`: `MAX_BRAND_BYTES`, `parseBrandRecord`; `importBrand.ts` |
| 1 MB per logo, 20,000 elements, depth 40               | `model.ts`: `parseLogo`                                             |

Imports validate ZIP paths and CRCs, reject unsupported schema versions, and accept a passive outlined SVG subset. Scripts, resource references, event handlers, live text, and inherited `currentColor` artwork are rejected. Errors leave existing choices intact.

Run `npm run help:build` after branding runtime, lesson styles, or radius changes, and `npm run help:check` to verify generated exports. `src/branding/model.test.ts` covers profile safety, geometry, scope choices, ZIP budgets, and optional TTF PDF embedding. `tests/e2e/branding.spec.ts` covers independent choices, persistence, restoring defaults, and frozen offline downloads. Set `PGMAPS_BRANDKIT_PROVINCE` and `PGMAPS_BRANDKIT_HYDRO` to local source pack paths to run the two real-pack browser cases; those uploaded archives are not committed.
