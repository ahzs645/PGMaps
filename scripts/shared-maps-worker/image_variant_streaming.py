"""Bounded display decoding for large, verified flat-image sources.

The disposable tiled TIFF is a rendering cache, never an archival original or
a geographic raster. Its four bands contain premultiplied RGBA samples without
an alpha mask, so overview averaging includes transparent partial edge cells.
"""

from __future__ import annotations

import math
from pathlib import Path
import shutil
import warnings

import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import ColorInterp, Resampling
from rasterio.errors import NotGeoreferencedWarning
from rasterio.windows import Window

GDAL_CACHE_BYTES = 64 * 1024 * 1024
STRIPE_BYTES = 32 * 1024 * 1024
MAX_DECODE_BLOCK_BYTES = 64 * 1024 * 1024


class StreamedImage:
    """Render through a tiled lossless disk cache, with bounded stripe reads."""

    def __init__(self, source: Path, cache_dir: Path, info: dict, max_zoom: int):
        if info["sourceMode"] == "CMYK":
            raise ValueError("CMYK sources above the in-memory pixel budget need separately documented bounded colour conversion")
        if info.get("progressiveJpeg"):
            raise ValueError("Streaming preparation requires a baseline JPEG or a separately verified lossless tiled source; progressive JPEG decoding may buffer the whole image")
        if info["format"] == "PNG":
            with source.open("rb") as handle:
                png_header = handle.read(29)
            if len(png_header) < 29 or png_header[28] != 0:
                raise ValueError("Streaming preparation requires a non-interlaced PNG or a separately verified lossless tiled source")
        self.width, self.height = info["width"], info["height"]
        self.max_zoom = max_zoom
        factor = 1 << max_zoom
        self.padded_width = math.ceil(self.width / factor) * factor
        self.padded_height = math.ceil(self.height / factor) * factor
        # Allow room for all four-band levels, codec scratch, and the PMTiles.
        required_disk = self.padded_width * self.padded_height * 6 + 256 * 1024 * 1024
        if shutil.disk_usage(cache_dir).free < required_disk:
            raise ValueError(f"Streaming preparation needs at least {required_disk:,} free temporary bytes")
        self.path = cache_dir / "display-cache.tif"
        self.dataset = None
        self.environment = rasterio.Env(GDAL_CACHEMAX=GDAL_CACHE_BYTES, GDAL_NUM_THREADS="1")
        self.environment.__enter__()
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", NotGeoreferencedWarning)
                self._build_cache(source, info)
                self.dataset = rasterio.open(self.path)
        except BaseException:
            self.close()
            raise
        self.recipe = {
            "decoder": "rasterio/GDAL; sequential source stripes into a temporary lossless tiled cache",
            "rasterioVersion": rasterio.__version__,
            "gdalVersion": rasterio.__gdal_version__,
            "gdalCacheMaxBytes": GDAL_CACHE_BYTES,
            "sourceStripeMaxBytes": STRIPE_BYTES,
            "sourceStripeRows": self.stripe_rows,
            "maxSourceDecodeBlockBytes": MAX_DECODE_BLOCK_BYTES,
            "displayMode": "RGBA",
            "resampling": "Area average of premultiplied RGBA; exact power-of-two grid with transparent partial edge cells; native level is not resampled",
            "temporaryCache": "DEFLATE tiled uint8 TIFF; premultiplied RGBA without an alpha mask; removed after preparation",
        }

    def _build_cache(self, source: Path, info: dict) -> None:
        with rasterio.open(source) as input_image:
            if (input_image.width, input_image.height) != (self.width, self.height):
                raise ValueError("GDAL source dimensions differ from the verified image header")
            if any(dtype != "uint8" for dtype in input_image.dtypes):
                raise ValueError("Streaming display decoding requires byte imagery, without an implicit numeric stretch")
            if input_image.count not in (1, 2, 3, 4):
                raise ValueError("Unexpected channel count in the source image")
            if any(rows * columns * input_image.count > MAX_DECODE_BLOCK_BYTES for rows, columns in input_image.block_shapes):
                raise ValueError("Source has a decode block larger than 64 MiB; first prepare a verified lossless tiled or short-strip wrapper")
            self.stripe_rows = max(1, min(512, STRIPE_BYTES // (self.padded_width * max(input_image.count, 4))))
            palette = None
            if input_image.count == 1 and input_image.colorinterp[0] == ColorInterp.palette:
                colour_map = input_image.colormap(1)
                palette = np.zeros((256, 4), dtype="uint8")
                for index, colour in colour_map.items():
                    if index < len(palette):
                        palette[index] = colour
            # PNG transparency may be absent from GDAL's colour table. Obtain
            # the palette/transparency from headers, without decoding pixels.
            if info["sourceMode"] == "P":
                previous_limit = Image.MAX_IMAGE_PIXELS
                Image.MAX_IMAGE_PIXELS = 1_000_000_000
                try:
                    with Image.open(source) as image:
                        palette_image = Image.new("P", (256, 1))
                        try:
                            palette_image.putpalette(image.getpalette("RGBA"), rawmode="RGBA")
                            palette_image.putdata(range(256))
                            if "transparency" in image.info:
                                palette_image.info["transparency"] = image.info["transparency"]
                            palette = np.asarray(palette_image.convert("RGBA")).reshape(256, 4).copy()
                        finally:
                            palette_image.close()
                finally:
                    Image.MAX_IMAGE_PIXELS = previous_limit
            with rasterio.open(
                self.path, "w", driver="GTiff", width=self.padded_width, height=self.padded_height,
                count=4, dtype="uint8", tiled=True, blockxsize=512, blockysize=512,
                compress="DEFLATE", predictor=2, BIGTIFF="IF_SAFER", NUM_THREADS="1",
                photometric="MINISBLACK", ALPHA="UNSPECIFIED",
            ) as cache:
                # Declaring alpha here causes GDAL to discard zero-alpha cells
                # while averaging alpha itself, incorrectly making edges opaque.
                cache.colorinterp = (ColorInterp.undefined,) * 4
                for top in range(0, self.padded_height, self.stripe_rows):
                    rows = min(self.stripe_rows, self.padded_height - top)
                    rgba = np.zeros((4, rows, self.padded_width), dtype="uint8")
                    source_rows = min(rows, max(0, self.height - top))
                    if source_rows:
                        pixels = input_image.read(window=Window(0, top, self.width, source_rows))
                        area = rgba[:, :source_rows, :self.width]
                        if palette is not None:
                            area[:] = np.moveaxis(palette[pixels[0]], -1, 0)
                        elif input_image.count in (1, 2):
                            grey = pixels[0]
                            if info["sourceMode"] == "1":
                                # NBITS=1 GDAL samples are 0/1, not Pillow's 0/255.
                                grey = grey * 255
                            area[:3] = grey
                            area[3] = pixels[1] if input_image.count == 2 else 255
                        else:
                            area[:3] = pixels[:3]
                            area[3] = pixels[3] if input_image.count == 4 else 255
                        transparency = info.get("transparency")
                        if info["sourceMode"] == "RGB" and isinstance(transparency, tuple):
                            area[3][np.all(pixels[:3] == np.array(transparency, dtype="uint8")[:, None, None], axis=0)] = 0
                        elif info["sourceMode"] == "L" and isinstance(transparency, int):
                            area[3][pixels[0] == transparency] = 0
                        del pixels
                        if info["displayMode"] == "RGBA" or palette is not None:
                            alpha = area[3].astype("uint16")
                            for channel in range(3):
                                area[channel] = (area[channel].astype("uint16") * alpha + 127) // 255
                            del alpha
                    cache.write(rgba, window=Window(0, top, self.padded_width, rows))
                    del rgba
                if self.max_zoom:
                    cache.build_overviews([1 << n for n in range(1, self.max_zoom + 1)], Resampling.average)

    @staticmethod
    def _display(premultiplied: np.ndarray) -> Image.Image:
        alpha = premultiplied[3].astype("uint16")
        denominator = np.maximum(alpha, 1)
        for channel in range(3):
            premultiplied[channel] = np.minimum(
                255, (premultiplied[channel].astype("uint16") * 255 + alpha // 2) // denominator,
            ).astype("uint8")
        return Image.fromarray(np.moveaxis(premultiplied, 0, -1), "RGBA")

    def preview(self, size: tuple[int, int]) -> Image.Image:
        data = self.dataset.read(window=Window(0, 0, self.width, self.height),
                                 out_shape=(4, size[1], size[0]), resampling=Resampling.average)
        return self._display(data)

    def tile(self, zoom: int, x: int, y: int, tile_size: int) -> Image.Image:
        factor = 1 << (self.max_zoom - zoom)
        level_width, level_height = math.ceil(self.width / factor), math.ceil(self.height / factor)
        width = min(tile_size, level_width - x * tile_size)
        height = min(tile_size, level_height - y * tile_size)
        if width <= 0 or height <= 0:
            raise ValueError("Requested tile falls outside the image")
        data = self.dataset.read(
            window=Window(x * tile_size * factor, y * tile_size * factor, width * factor, height * factor),
            out_shape=(4, height, width), resampling=Resampling.nearest,
        )
        return self._display(data)

    def close(self) -> None:
        if self.dataset is not None:
            self.dataset.close()
            self.dataset = None
        if self.environment is not None:
            self.environment.__exit__(None, None, None)
            self.environment = None
