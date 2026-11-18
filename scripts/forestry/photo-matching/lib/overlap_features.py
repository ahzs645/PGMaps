"""Match upright working frames or measure overlap for every pair in a set."""

import argparse
import itertools
import json
from pathlib import Path
import time

import cv2 as cv
import numpy as np

METHODS = ("sift", "rootsift", "contrast-rootsift", "multiscale-rootsift", "orb")
SCALES = (1, 0.67, 1.4)
SCALE_PAIRS = ((0, 0), (0, 1), (1, 0), (0, 2), (2, 0))


def make_extractor(method):
    multiscale = method == "multiscale-rootsift"
    if method == "orb":
        detector = cv.ORB_create(nfeatures=4500)
    elif multiscale:
        detector = cv.SIFT_create(nfeatures=6500, contrastThreshold=0.025)
    else:
        detector = cv.SIFT_create(nfeatures=3500)
    contrast = (
        cv.createCLAHE(clipLimit=2.5 if multiscale else 2, tileGridSize=(8, 8))
        if method in ("contrast-rootsift", "multiscale-rootsift") else None
    )

    def describe(frame, scale):
        resized = frame if scale == 1 else cv.resize(
            frame, None, fx=scale, fy=scale, interpolation=cv.INTER_AREA if scale < 1 else cv.INTER_LINEAR
        )
        keys, descriptors = detector.detectAndCompute(contrast.apply(resized) if contrast else resized, None)
        if descriptors is not None and method.endswith("rootsift"):
            lengths = np.maximum(descriptors.sum(axis=1, keepdims=True), 1e-9)
            descriptors = np.sqrt(descriptors / lengths)
        points = np.asarray([key.pt for key in keys], dtype=np.float32) / scale
        return points, descriptors, frame.size

    def extract(path):
        frame = cv.imread(path, cv.IMREAD_GRAYSCALE)
        if frame is None:
            raise ValueError(f"Could not read working frame {path}")
        return [describe(frame, scale) for scale in SCALES] if multiscale else describe(frame, 1)

    return extract


def reciprocal_matches(a, b, matcher, ratio):
    points_a, desc_a, _ = a
    points_b, desc_b, _ = b
    if desc_a is None or desc_b is None or min(len(desc_a), len(desc_b)) < 2:
        return []

    def ratio_matches(first, second):
        return {
            near.queryIdx: (near.trainIdx, near.distance / far.distance)
            for near, far in matcher.knnMatch(first, second, k=2)
            if near.distance < ratio * far.distance
        }

    forward = ratio_matches(desc_a, desc_b)
    backward = ratio_matches(desc_b, desc_a)
    ranked = sorted(
        (max(ratio, backward[j][1]), i, j)
        for i, (j, ratio) in forward.items()
        if j in backward and backward[j][0] == i
    )
    return [[points_a[i], points_b[j]] for _, i, j in ranked]


def match_strength(result):
    return len(result["matches"]) * (result["hullShare"] or 0) ** 0.35


def check_overlap(first, second, matcher, multiscale=False):
    minimum, fraction, ratio = (25, 0.3, 0.86) if multiscale else (20, 0.6, 0.76)
    cv.setRNGSeed(1337)
    points = np.asarray(reciprocal_matches(first, second, matcher, ratio), dtype=np.float32)
    result = {"reciprocal": len(points), "matches": [], "hullShare": None}
    if len(points) < minimum:
        return result

    # Epipolar geometry allows parallax over hills. A homography can support
    # an overlap where the cameras rotated around nearly the same position.
    a, b = np.ascontiguousarray(points[:, 0]), np.ascontiguousarray(points[:, 1])
    _, fundamental = cv.findFundamentalMat(a, b, cv.USAC_MAGSAC, 2.0, 0.999, 12000)
    _, homography = cv.findHomography(a, b, cv.USAC_MAGSAC, 3.0)
    options = []
    for mask in (fundamental, homography):
        if mask is None:
            continue
        valid = mask.ravel().astype(bool)
        if np.count_nonzero(valid) < max(minimum, fraction * len(points)):
            continue
        coverage = min(
            cv.contourArea(cv.convexHull(a[valid])) / first[2],
            cv.contourArea(cv.convexHull(b[valid])) / second[2],
        )
        if multiscale and coverage < 0.045:
            continue
        options.append({**result, "matches": points[valid].tolist(), "hullShare": coverage})
    score = match_strength if multiscale else lambda row: len(row["matches"])
    return max(options, key=score, default=result)


def check_scales(first, second, matcher):
    options = [check_overlap(first[i], second[j], matcher, multiscale=True) for i, j in SCALE_PAIRS]
    return max(options, key=lambda row: (match_strength(row), row["reciprocal"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--method", choices=METHODS, default="sift")
    parser.add_argument("--all-pairs", action="store_true")
    parser.add_argument("frames", nargs="+")
    args = parser.parse_args()
    if len(args.frames) < 2 or (not args.all_pairs and len(args.frames) != 2):
        parser.error("Provide two working frames or use --all-pairs for a larger set.")

    cv.setNumThreads(2)
    extractor = make_extractor(args.method)
    start = time.perf_counter()
    frames = [extractor(path) for path in args.frames]
    extraction_seconds = time.perf_counter() - start
    matcher = cv.BFMatcher(cv.NORM_HAMMING if args.method == "orb" else cv.NORM_L2)
    check = check_scales if args.method == "multiscale-rootsift" else check_overlap
    if not args.all_pairs:
        print(json.dumps(check(*frames, matcher)))
        return
    stats = []
    for i, j in itertools.combinations(range(len(frames)), 2):
        start = time.perf_counter()
        result = check(frames[i], frames[j], matcher)
        stats.append({
            "pair": [Path(args.frames[i]).name, Path(args.frames[j]).name],
            "seconds": time.perf_counter() - start,
            **result,
        })
    print(json.dumps({"method": args.method, "extractionSeconds": extraction_seconds, "pairs": stats}))


if __name__ == "__main__":
    main()
