# Versioning and releases

The toolkit currently remains a private MIT-licensed package inside PG Maps.
Its source, build scripts, tests, API documentation and license move together
when it gets a separate repository. No package is published by the current CI.

## Supported surface

`API.md` identifies the supported entry points. Fine-grained implementation
paths retained for PG Maps compatibility are provisional. Keep existing paths
working during this extraction; migrate host imports before removing them.

Before 1.0, a minor version can change a supported API or its observable
behavior. Patch releases preserve signatures and documented semantics. Record
changes to scoring, missing values, classification boundaries, scene behavior,
responsive defaults and peer requirements even when TypeScript still compiles.
At 1.0, follow semantic versioning: breaking changes require a major version.

## Release verification

From the host repository, run:

```sh
npm run toolkit:check
npm run toolkit:lint
npm run toolkit:format:check
npm run toolkit:test
npm run toolkit:example:build
npm run toolkit:watch:check
npm run toolkit:example:test
npm run toolkit:nested:test
npm run toolkit:pack:check -- --browser
```

Also run the host's affected compatibility/browser tests and TypeScript build.
The toolkit workflow exercises package and independent-consumer checks without
scraper data. The packed consumer resolves real compiled exports outside the
repository, rather than relying on application aliases.

Keep the existing MIT license and contributor attribution in each artifact.
Third-party datasets, services, attribution and permissions remain the host's
responsibility; the toolkit license does not relicense them.

## Separate repository

1. Copy this package directory and the independent consumer to the new repository.
2. Port the toolkit CI commands and packed-consumer check to that repository's
   layout, then verify a fresh dependency installation and source build.
3. Keep the package name and documented exports. Choose the release version,
   record the changes, and configure a registry or packaged-artifact release.
4. Remove `private` only when publication is intended. No registry credentials
   or publishing automation are required for the current in-repo stage.
5. Replace PG Maps' `file:packages/geo-toolkit` dependency with the released
   version. Remove its local toolkit workspace, source paths and test aliases
   after the host builds and its compatibility checks pass against the artifact.

Versioned consumers receive toolkit changes when their dependency is updated;
changing the toolkit repository alone does not update deployed websites.
