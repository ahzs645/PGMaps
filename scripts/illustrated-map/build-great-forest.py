#!/usr/bin/env python3
"""Write the Great Forest faces' metrics for the app from the committed fonts.

Reads public/illustrated-map/fonts/great-forest/*SmallCaps*.ttf and *Simplified*.ttf and writes
src/lib/mapSheet/greatForestMetrics.generated.json: per face, units per em, ascender, descender,
cap height and the advance of every mapped code point, so a sheet lays out text set in the face
as the embedded font draws it. Requires fontTools.

  python scripts/illustrated-map/build-great-forest.py
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
FONTS = ROOT / "public/illustrated-map/fonts/great-forest"
FACES = {
    "smallcaps": "GreatForest-SmallCaps-v1.000-VancouverIslandNorth.decompressed.ttf",
    "simplified": "GreatForest-Simplified-v1.000-VancouverIslandNorth.decompressed.ttf",
}


def face(path: Path) -> dict:
    font = TTFont(path)
    glyph_set = font.getGlyphSet()
    glyphs = {}
    for code, name in sorted(font.getBestCmap().items()):
        if code < 0x20:
            continue
        glyphs[chr(code)] = glyph_set[name].width
    os2 = font["OS/2"]
    return {
        "name": font["name"].getDebugName(4),
        "version": font["name"].getDebugName(5),
        "file": path.name,
        "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "unitsPerEm": font["head"].unitsPerEm,
        "ascender": font["hhea"].ascent,
        "descender": font["hhea"].descent,
        "capHeight": getattr(os2, "sCapHeight", 0) or font["head"].unitsPerEm * 0.7,
        "advances": glyphs,
    }


def main() -> None:
    output = {key: face(FONTS / name) for key, name in FACES.items()}
    target = ROOT / "src/lib/mapSheet/greatForestMetrics.generated.json"
    target.write_text(json.dumps(output, separators=(",", ":"), ensure_ascii=False) + "\n")
    print(json.dumps({key: len(value["advances"]) for key, value in output.items()} | {"bytes": target.stat().st_size}))


if __name__ == "__main__":
    main()
