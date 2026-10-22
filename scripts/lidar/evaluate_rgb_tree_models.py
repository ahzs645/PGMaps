#!/usr/bin/env python3
"""CPU smoke tests of pinned RGB crown weights; requires real RGB imagery.

Uses the published DeepForest RetinaNet architecture and CanopyRS Mask R-CNN
Detectron2 config directly, without either project's tiling/training pipeline.
Do not supply a coloured height model. Outputs pixel coordinates, not trees
georeferenced to the PGMaps LiDAR tile. See docs/research/hf-tree-model-tests.md.
"""

import argparse
import csv
import hashlib
import io
import json
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image


def sha(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def truth_boxes(path):
    # Some upstream CSV fixtures contain literal escaped line endings.
    text = Path(path).read_text().replace("\\r\\n", "\n")
    return [
        [float(row[k]) for k in ("xmin", "ymin", "xmax", "ymax")]
        for row in csv.DictReader(io.StringIO(text))
    ]


def box_metrics(boxes, scores, truth, threshold):
    """Confidence-ordered, one-to-one box matches at IoU >= 0.5 (not AP)."""
    used = set()
    accepted = sorted(
        (i for i, s in enumerate(scores) if s >= threshold), key=lambda i: -scores[i]
    )
    for i in accepted:
        a = boxes[i]
        best, best_iou = None, -1
        for j, b in enumerate(truth):
            if j in used:
                continue
            intersection = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(
                0, min(a[3], b[3]) - max(a[1], b[1])
            )
            union = (
                (a[2] - a[0]) * (a[3] - a[1])
                + (b[2] - b[0]) * (b[3] - b[1])
                - intersection
            )
            overlap = intersection / union if union > 0 else 0
            if overlap > best_iou:
                best, best_iou = j, overlap
        if best is not None and best_iou >= 0.5:
            used.add(best)
    tp, n = len(used), len(accepted)
    return {
        "score_threshold": threshold,
        "iou_threshold": 0.5,
        "predictions": n,
        "true_positives": tp,
        "false_positives": n - tp,
        "missed": len(truth) - tp,
        "precision": tp / n if n else None,
        "recall": tp / len(truth) if truth else None,
    }


def deepforest_model(weights):
    from safetensors.torch import load_file
    from torchvision.models import resnet50
    from torchvision.models.detection.backbone_utils import _resnet_fpn_extractor
    from torchvision.models.detection.retinanet import RetinaNet
    from torchvision.ops import FrozenBatchNorm2d
    from torchvision.ops.feature_pyramid_network import LastLevelP6P7

    backbone = _resnet_fpn_extractor(
        resnet50(weights=None, norm_layer=FrozenBatchNorm2d),
        3,
        returned_layers=[2, 3, 4],
        extra_blocks=LastLevelP6P7(256, 256),
    )
    model = RetinaNet(backbone, num_classes=1, score_thresh=0.05, nms_thresh=0.05)
    state = {k.removeprefix("model."): v for k, v in load_file(weights).items()}
    model.load_state_dict(state, strict=True)
    return model.eval()


def canopy_model(weights):
    from detectron2 import model_zoo
    from detectron2.config import get_cfg
    from detectron2.modeling import build_model

    cfg = get_cfg()
    cfg.merge_from_file(
        model_zoo.get_config_file(
            "COCO-InstanceSegmentation/mask_rcnn_R_50_FPN_3x.yaml"
        )
    )
    cfg.MODEL.DEVICE = "cpu"
    cfg.MODEL.ROI_HEADS.NUM_CLASSES = 1
    cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST = 0.05
    cfg.MODEL.ROI_HEADS.NMS_THRESH_TEST = 0.5
    cfg.TEST.DETECTIONS_PER_IMAGE = 500
    model = build_model(cfg)
    state = torch.load(weights, map_location="cpu", weights_only=True)
    model.load_state_dict(state["model"], strict=True)
    return model.eval()


def predict(model_name, model, image):
    width, height = image.size
    rgb = np.asarray(image.convert("RGB"))
    if model_name == "deepforest":
        tensor = torch.from_numpy(rgb.copy()).permute(2, 0, 1).float() / 255
        with torch.inference_mode():
            p = model([tensor])[0]
        return p["boxes"].tolist(), p["scores"].tolist(), None
    from detectron2.data.transforms import ResizeTransform

    # CanopyRS DeterministicResizeWithinRange(1024, 1777), BGR Detectron2 input.
    short, long = min(height, width), max(height, width)
    scale = min(1024 / short, 1777 / long) if short < 1024 else min(1, 1777 / long)
    resized = ResizeTransform(
        height, width, round(height * scale), round(width * scale)
    ).apply_image(rgb[:, :, ::-1])
    tensor = torch.from_numpy(resized.copy()).permute(2, 0, 1).float()
    with torch.inference_mode():
        p = model([{"image": tensor, "height": height, "width": width}])[0][
            "instances"
        ].to("cpu")
    return p.pred_boxes.tensor.tolist(), p.scores.tolist(), p.pred_masks.numpy()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model", choices=["deepforest", "canopy-maskrcnn"], required=True
    )
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--sample", type=Path, required=True)
    parser.add_argument("--truth", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(2)
    if args.sample.suffix.lower() not in {".png", ".tif", ".tiff", ".jpg", ".jpeg"}:
        parser.error(
            "Supply real RGB imagery, not a point cloud or a CHM colour rendering."
        )
    image = Image.open(args.sample)
    if image.mode != "RGB":
        parser.error(f"Expected three-channel RGB sample; got {image.mode}.")
    start = time.monotonic()
    model = (
        deepforest_model(str(args.weights))
        if args.model == "deepforest"
        else canopy_model(str(args.weights))
    )
    load_seconds = time.monotonic() - start
    start = time.monotonic()
    boxes, scores, masks = predict(args.model, model, image)
    seconds = time.monotonic() - start
    assert len(boxes) == len(scores)
    assert np.isfinite(np.asarray(boxes)).all() and np.isfinite(scores).all()
    assert all(0 <= s <= 1 for s in scores)
    truth = truth_boxes(args.truth)
    result = {
        "model": args.model,
        "status": "inference_completed",
        "device": "cpu",
        "scope": "public RGB fixture; not the user LiDAR tile; not an independent accuracy benchmark",
        "weights_sha256": sha(args.weights),
        "sample": args.sample.name,
        "sample_sha256": sha(args.sample),
        "truth_sha256": sha(args.truth),
        "image_size": list(image.size),
        "truth_count": len(truth),
        "load_seconds": load_seconds,
        "inference_seconds": seconds,
        "torch_version": torch.__version__,
        "strict_state_dict": True,
        "metrics": [box_metrics(boxes, scores, truth, t) for t in [0.05, 0.25, 0.5]],
        "predictions": [{"box": b, "score": s} for b, s in zip(boxes, scores)],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if masks is not None:
        mask_path = args.output.with_suffix(".masks.npz")
        np.savez_compressed(mask_path, masks=masks, scores=np.asarray(scores))
        result["mask_count"] = len(masks)
        result["masks_sha256"] = sha(mask_path)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k != "predictions"}, indent=2))


if __name__ == "__main__":
    main()
