#!/usr/bin/env python3
"""Make the map's text outlines from supplied font files, never from image tracing.

Usage: python3 scripts/illustrated-map/build-font-glyphs.py \
  --smallcaps /path/to/GreatForest-SmallCaps.ttf \
  --regular /path/to/GreatForest-v2-Simplified-Regular.ttf

Requires fontTools. The complete fonts are not copied into the repository.
"""
import argparse
import json
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont


def glyph_data(path: Path) -> dict:
    font = TTFont(path)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    characters = {}
    for character in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 &-,.":
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
    output = {"smallcaps": glyph_data(args.smallcaps), "regular": glyph_data(args.regular)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, separators=(",", ":")) + "\n")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
