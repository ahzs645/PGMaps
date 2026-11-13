"""Optional local compression experiment. Requires PyMuPDF and Pillow; never used by the app.

python3 scripts/forestry/pdf-jpeg-calibration.py /local/Maps /tmp/pdf-calibration [slope=Slope.pdf canopy=Canopy.pdf]
Finds one lossless RGB tile and one JPEG tile in each supplied class map, then
re-encodes the clean tile with the JPEG tile's actual quantization and subsampling. Writes the
re-encoded JPEG too, so the coefficient decoder can be scored against the clean tile's classes.
"""
import io
import json
import pathlib
import sys

import pymupdf as fitz
from PIL import Image, JpegImagePlugin

maps, output = map(pathlib.Path, sys.argv[1:3])
output.mkdir(parents=True, exist_ok=True)
# Optional kind=file pairs name each class map; the defaults are the Canfor file names.
named = dict(arg.split("=", 1) for arg in sys.argv[3:])
metadata = []
for kind, pattern in [("slope", "*Slope_Map*.pdf"), ("canopy", "*Canopy_Height*.pdf")]:
    if kind in named:
        source = maps / named[kind]
    else:
        found = [p for p in sorted(maps.glob(pattern)) if "Copy" not in p.name]
        if not found:
            continue
        source = found[0]
    pdf = fitz.open(source)
    images = [i for i in pdf[0].get_images(full=True) if i[2] > 1000 and i[5] == "DeviceRGB"]
    clean = next(i for i in images if pdf.extract_image(i[0])["ext"] == "png")
    jpeg = next(i for i in images if pdf.extract_image(i[0])["ext"] in ("jpeg", "jpg"))
    original = Image.open(io.BytesIO(pdf.extract_image(clean[0])["image"])).convert("RGB")
    example = Image.open(io.BytesIO(pdf.extract_image(jpeg[0])["image"]))
    tables, subsampling = example.quantization, JpegImagePlugin.get_sampling(example)
    encoded = io.BytesIO()
    original.save(encoded, format="JPEG", qtables=tables, subsampling=subsampling)
    compressed = Image.open(io.BytesIO(encoded.getvalue())).convert("RGB")
    alpha = fitz.Pixmap(pdf, clean[1]).samples
    (output / f"{kind}-original.rgb").write_bytes(original.tobytes())
    (output / f"{kind}-lossy.rgb").write_bytes(compressed.tobytes())
    (output / f"{kind}-lossy.jpg").write_bytes(encoded.getvalue())
    (output / f"{kind}.alpha").write_bytes(alpha)
    metadata.append(dict(kind=kind, source=source.name, cleanReference=clean[0], jpegReference=jpeg[0],
                         width=original.width, height=original.height, subsampling=subsampling, quantization=tables))
(output / "source.json").write_text(json.dumps(metadata, indent=2))
print(f"Prepared {len(metadata)} local compression experiments in {output}")
