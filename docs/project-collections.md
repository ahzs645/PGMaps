# Project folders

The project catalog supports reusable, single-level folders. They organize
existing packages; they are not a new workspace type and contain no map data.

Folder definitions live in `src/lib/projectCollections.ts`. Each definition has
a unique URL-safe `slug`, a `title`, a `description`, and an ordered list of
`projectSlugs`. Add another definition to create another parent folder. List each
project in at most one folder and use registered package slugs. The unit tests
validate membership, uniqueness, and the climate collection's completeness.

The initial **B.C. Climate & Health** folder contains the Northern Health
resilience narrative, EchoScreen, and all 18 climate-category stories. Counts are
derived from loaded catalog summaries, not hard-coded in the UI.

- Share a folder with `/dev/projects?collection=bc-climate-health`.
- The root catalog shows folders plus ungrouped projects. Members are not repeated
  as top-level entries, including in “Browse all projects”.
- Root search and type filters return matching folders with matching/total counts.
  Opening a folder retains those filters. Inside a folder, search and pagination
  apply to its members, in the configured order.
- “All projects” in the folder breadcrumb clears its search/filter and returns
  to the root. Browser Back from a story returns to the folder URL. Individual
  story URLs, existing back-to-catalog controls, imports and downloads are unchanged.
- Folder membership is catalog metadata. It does not move JSON packages, embed
  raster/vector data, fetch member packages, or change the R2 deployment path.
- Imported packages appear at the root unless their slug is explicitly registered
  in a folder. Unknown folder URLs show an explicit empty state and a way back.

After adding members, run `npm run projects:index:check`, the project-collection
unit tests, and `tests/e2e/project-collections.spec.ts`. Adding or renaming an
actual package still requires `npm run projects:index` and its package audit.
