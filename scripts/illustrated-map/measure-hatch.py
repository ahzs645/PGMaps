#!/usr/bin/env python3
"""Measure a rendered hatch, so a generated texture can be fitted to a reference image.

Requires numpy, scipy and Pillow. Reads one raster image and a window of it that holds only
hatching (no labels, symbols or water), and reports, in image pixels:

  inkCoverage            share of the window inked (yellow-green strokes on white)
  strokeSpacing          period of the ink along rows (autocorrelation)
  bandPeriod             period of the ink down columns: the height of a row of strokes
  strokeLength           median major-axis length of connected strokes (and quartiles)
  strokeWidth            median ink area / length of connected strokes
  leanFromVertical       stroke direction from the structure tensor (smoothed 4 px), degrees:
                         10th, 50th and 90th percentiles, and of its absolute value

The page 8 patch preset was fitted with it. Page 8's northern hatch, windows
280,0,560,280  0,240,420,400  300,250,560,420  30,0,110,240 of the brand guidelines' embedded
1536 x 945 map image (public/illustrated-map/page8-reference.jpg), gives about 0.32 coverage,
spacing 3, bands 8-12, strokes 8.6 long, |lean| median 6 and 90th percentile 25-28 degrees.

Example:
  python scripts/illustrated-map/measure-hatch.py public/illustrated-map/page8-reference.jpg 280,0,560,280
"""
from __future__ import annotations

import argparse
import json

import numpy as np
from PIL import Image
from scipy import ndimage


def autocorrelation_period(signals: list[np.ndarray]) -> int:
    curves = []
    for signal in signals:
        centred = signal - signal.mean()
        energy = (centred**2).sum()
        if energy <= 0:
            continue
        curves.append(np.correlate(centred, centred, "full")[len(centred) - 1:] / energy)
    curve = np.mean(curves, axis=0)
    i = 1
    while i < len(curve) - 1 and curve[i] > curve[i + 1]:
        i += 1
    j = i
    while j < len(curve) - 1 and curve[j] < curve[j + 1]:
        j += 1
    return int(j)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("image")
    parser.add_argument("window", help="x0,y0,x1,y1 in image pixels, hatching only")
    args = parser.parse_args()
    x0, y0, x1, y1 = (int(v) for v in args.window.split(","))
    rgb = np.asarray(Image.open(args.image).convert("RGB")).astype(float)[y0:y1, x0:x1]
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    ink = ((b < 150) & (g > 120) & (r > 110)).astype(float)

    out = {"inkCoverage": round(float(ink.mean()), 3)}
    out["strokeSpacing"] = autocorrelation_period([row for row in ink[::2] if row.mean() > 0.2])
    out["bandPeriod"] = autocorrelation_period(list(ink.T[::2]))

    labels, count = ndimage.label(ink > 0)
    lengths, widths = [], []
    for index, region in enumerate(ndimage.find_objects(labels), start=1):
        ys, xs = np.nonzero(labels[region] == index)
        if len(ys) < 4 or len(ys) > 200:
            continue
        major = 4 * np.sqrt(max(np.linalg.eigvalsh(np.cov(np.vstack([xs, ys])))[1], 0))
        lengths.append(major)
        widths.append(len(ys) / max(major, 1e-9))
    out["strokeLength"] = {
        "median": round(float(np.median(lengths)), 2),
        "p25": round(float(np.percentile(lengths, 25)), 2),
        "p75": round(float(np.percentile(lengths, 75)), 2),
    }
    out["strokeWidth"] = round(float(np.median(widths)), 2)

    gy, gx = ndimage.sobel(ink, 0), ndimage.sobel(ink, 1)
    jxx = ndimage.gaussian_filter(gx * gx, 4)
    jyy = ndimage.gaussian_filter(gy * gy, 4)
    jxy = ndimage.gaussian_filter(gx * gy, 4)
    gradient = 0.5 * np.arctan2(2 * jxy, jxx - jyy)
    lean = ((np.degrees(gradient) + 90) % 180) - 90
    coherence = np.sqrt((jxx - jyy) ** 2 + 4 * jxy**2) / (jxx + jyy + 1e-9)
    leans = lean[(coherence > 0.3) & (ndimage.uniform_filter(ink, 9) > 0.15)]
    out["leanFromVertical"] = {
        "p10": round(float(np.percentile(leans, 10)), 1),
        "median": round(float(np.median(leans)), 1),
        "p90": round(float(np.percentile(leans, 90)), 1),
        "absMedian": round(float(np.median(np.abs(leans))), 1),
        "absP90": round(float(np.percentile(np.abs(leans), 90)), 1),
    }
    print(json.dumps(out))


if __name__ == "__main__":
    main()
