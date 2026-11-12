#!/usr/bin/env bash
# Writes pgTree.js: a plain-JS copy of src/pages/dev-forestry/treeGeometry.ts,
# so the bench draws PGMaps' own near-tree mesh without pulling in forest.ts.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/../../../../src/pages/dev-forestry/treeGeometry.ts"
sed -e "s#import { isBroadleaf, type ForestMesh, type TreeSpeciesId } from './forest'#const isBroadleaf = (s) => s === 'aspen' || s === 'birch'#" \
  -e 's/: TreeSpeciesId//; s/): ForestMesh {/) {/; s/: number\[\] = \[\]/ = []/g' \
  -e 's/(a: number\[\], b: number\[\], c: number\[\], woody: number)/(a, b, c, woody)/' \
  -e 's/(a: number\[\], b: number\[\], radius: number)/(a, b, radius)/' \
  -e 's/(x: number, y: number, z: number, r: number, h: number, phase: number)/(x, y, z, r, h, phase)/' \
  "$src" > "$here/pgTree.js"
echo "wrote $here/pgTree.js"
