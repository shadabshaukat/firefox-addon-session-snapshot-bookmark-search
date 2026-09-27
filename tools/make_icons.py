#!/usr/bin/env python3
"""Generate the monochrome SS brand and Firefox icons using only Python stdlib.

Outputs:
- assets/icons/icon-{16,32,48,96,128}.png for Firefox manifest usage.
- assets/brand/session-snapshots-icon.svg for scalable brand usage.
- assets/brand/session-snapshots-icon-{512,1024}.png for listings and websites.
"""
from __future__ import annotations

import math
import struct
import zlib
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "assets" / "icons"
BRAND_DIR = ROOT / "assets" / "brand"
EXTENSION_SIZES = (16, 32, 48, 96, 128)
BRAND_SIZES = (512, 1024)

Color = tuple[int, int, int, int]

# A restrained one-hue palette with an off-white mark. The indigo remains
# distinct on both Firefox's light and dark toolbar themes without glare.
TILE_RGB = (67, 72, 124)       # #43487C
BORDER_RGB = (103, 109, 166)   # #676DA6
MARK_RGB = (248, 248, 252)     # #F8F8FC

# Two continuous geometric S strokes. Keeping the shape this simple is what
# makes the monogram survive downsampling to a 16px browser-action icon.
LEFT_S = (
    (0.430, 0.300),
    (0.360, 0.270),
    (0.270, 0.280),
    (0.210, 0.330),
    (0.210, 0.390),
    (0.250, 0.430),
    (0.340, 0.470),
    (0.400, 0.510),
    (0.430, 0.560),
    (0.420, 0.630),
    (0.370, 0.690),
    (0.280, 0.720),
    (0.190, 0.690),
)
RIGHT_S = tuple((x + 0.380, y) for x, y in LEFT_S)
MONOGRAM_PATHS = (LEFT_S, RIGHT_S)


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def clamp255(value: float) -> int:
    return max(0, min(255, int(round(value))))


def over(dst: Color, src_rgb: tuple[int, int, int], alpha: float) -> Color:
    alpha = clamp01(alpha)
    if alpha <= 0:
        return dst
    sr, sg, sb = src_rgb
    dr, dg, db, da = dst
    dst_alpha = da / 255.0
    out_alpha = alpha + dst_alpha * (1 - alpha)
    if out_alpha <= 0:
        return 0, 0, 0, 0
    out_r = (sr * alpha + dr * dst_alpha * (1 - alpha)) / out_alpha
    out_g = (sg * alpha + dg * dst_alpha * (1 - alpha)) / out_alpha
    out_b = (sb * alpha + db * dst_alpha * (1 - alpha)) / out_alpha
    return clamp255(out_r), clamp255(out_g), clamp255(out_b), clamp255(out_alpha * 255)


def smooth_alpha(distance_px: float, feather_px: float = 1.0) -> float:
    # Signed distance: negative is inside. This gives antialiased edges.
    return clamp01(0.5 - distance_px / max(0.01, feather_px))


def rounded_box_sdf(x: float, y: float, cx: float, cy: float, width: float, height: float, radius: float) -> float:
    qx = abs(x - cx) - width / 2 + radius
    qy = abs(y - cy) - height / 2 + radius
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - radius


def distance_to_segment(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    vx = bx - ax
    vy = by - ay
    wx = px - ax
    wy = py - ay
    length_sq = vx * vx + vy * vy
    if length_sq <= 0:
        return math.hypot(px - ax, py - ay)
    amount = clamp01((wx * vx + wy * vy) / length_sq)
    closest_x = ax + amount * vx
    closest_y = ay + amount * vy
    return math.hypot(px - closest_x, py - closest_y)


@lru_cache(maxsize=None)
def scaled_monogram_segments(size: int) -> tuple[tuple[float, float, float, float], ...]:
    segments = []
    for path in MONOGRAM_PATHS:
        scaled = [(x * size, y * size) for x, y in path]
        segments.extend((ax, ay, bx, by) for (ax, ay), (bx, by) in zip(scaled, scaled[1:]))
    return tuple(segments)


def paint_icon_pixel(size: int, x: int, y: int) -> Color:
    px = x + 0.5
    py = y + 0.5
    color: Color = (0, 0, 0, 0)

    tile_sdf = rounded_box_sdf(px, py, size / 2, size / 2, size * 0.90, size * 0.90, size * 0.205)
    tile_alpha = smooth_alpha(tile_sdf, max(0.8, size * 0.0022))
    if tile_alpha <= 0:
        return color

    color = over(color, TILE_RGB, tile_alpha)

    border_width = max(0.7, size * 0.012)
    border_alpha = smooth_alpha(abs(tile_sdf) - border_width / 2, max(0.7, size * 0.0018)) * tile_alpha
    color = over(color, BORDER_RGB, 0.82 * border_alpha)

    distance = min(
        distance_to_segment(px, py, ax, ay, bx, by)
        for ax, ay, bx, by in scaled_monogram_segments(size)
    )
    mark_width = size * 0.080
    mark_alpha = smooth_alpha(distance - mark_width / 2, max(0.7, size * 0.0018)) * tile_alpha
    color = over(color, MARK_RGB, mark_alpha)
    return color


def png_chunk(name: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data) & 0xFFFFFFFF)


def write_png(path: Path, size: int) -> None:
    raw_rows = []
    for y in range(size):
        row = bytearray([0])  # PNG filter type 0.
        for x in range(size):
            row.extend(paint_icon_pixel(size, x, y))
        raw_rows.append(bytes(row))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", zlib.compress(b"".join(raw_rows), 9))
        + png_chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def write_svg(path: Path) -> None:
    path.write_text(
        """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-labelledby="title desc">
  <title id="title">Session Snapshots SS monogram</title>
  <desc id="desc">A calm monochrome indigo app tile with two bold off-white geometric S letters.</desc>
  <rect x="51" y="51" width="922" height="922" rx="210" fill="#43487C"/>
  <rect x="62" y="62" width="900" height="900" rx="199" fill="none" stroke="#676DA6" stroke-width="14"/>
  <g fill="none" stroke="#F8F8FC" stroke-width="82" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="440,307 369,276 276,287 215,338 215,399 256,440 348,481 410,522 440,573 430,645 379,707 287,737 195,707"/>
    <polyline points="829,307 758,276 665,287 604,338 604,399 645,440 737,481 799,522 829,573 819,645 768,707 676,737 584,707"/>
  </g>
</svg>
""",
        encoding="utf-8",
    )


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    BRAND_DIR.mkdir(parents=True, exist_ok=True)

    write_svg(BRAND_DIR / "session-snapshots-icon.svg")
    print("generated assets/brand/session-snapshots-icon.svg")

    for size in EXTENSION_SIZES:
        write_png(ICON_DIR / f"icon-{size}.png", size)
        print(f"generated assets/icons/icon-{size}.png")

    for size in BRAND_SIZES:
        write_png(BRAND_DIR / f"session-snapshots-icon-{size}.png", size)
        print(f"generated assets/brand/session-snapshots-icon-{size}.png")


if __name__ == "__main__":
    main()
