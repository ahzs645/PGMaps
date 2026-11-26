#!/usr/bin/env python3
"""Make the map's text outlines from supplied font files, never from image tracing.

Usage: python3 scripts/illustrated-map/build-font-glyphs.py \
  --smallcaps /path/to/GreatForest-SmallCaps.ttf \
  --regular /path/to/GreatForest-v2-Simplified-Regular.ttf

Requires fontTools. The complete fonts are not copied into the repository.
"""
import argparse
import hashlib
import json
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont


def glyph_data(path: Path, include_alternates: bool = False) -> dict:
    font = TTFont(path)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    characters = {}
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 &-,."
    # The regular font maps its narrower capital alternates to lowercase codepoints.
    # Keep those genuine outlines so a word need not squash all of its wide capitals.
    if include_alternates:
        alphabet += "abcdefghijklmnopqrstuvwxyz"
    for character in alphabet:
        name = cmap.get(ord(character))
        if name is None:
            raise ValueError(f"{path.name} lacks {character!r}")
        glyph = glyph_set[name]
        svg_pen = SVGPathPen(glyph_set)
        bounds_pen = BoundsPen(glyph_set)
        glyph.draw(svg_pen)
        glyph.draw(bounds_pen)
        characters[character] = {
            "d": svg_pen.getCommands(),
            "advance": glyph.width,
            "bounds": bounds_pen.bounds,
        }
    return {
        "name": font["name"].getDebugName(1),
        "unitsPerEm": font["head"].unitsPerEm,
        "version": font["name"].getDebugName(5),
        "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "glyphs": characters,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--smallcaps", required=True, type=Path)
    parser.add_argument("--regular", required=True, type=Path)
    parser.add_argument(
        "--output", type=Path,
        default=Path(__file__).resolve().parents[2] / "src/lib/illustratedMap/fontGlyphs.generated.json",
    )
    args = parser.parse_args()
    output = {"smallcaps": glyph_data(args.smallcaps), "regular": glyph_data(args.regular, include_alternates=True)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, separators=(",", ":")) + "\n")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
