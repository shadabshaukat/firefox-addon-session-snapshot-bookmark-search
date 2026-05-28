#!/usr/bin/env python3
"""Generate professional brand and extension icons using only Python stdlib.

Outputs:
- assets/icons/icon-{16,32,48,96,128}.png for Firefox manifest usage.
- assets/brand/session-snapshots-icon.svg for website/listing usage.
- assets/brand/session-snapshots-icon-{512,1024}.png for website/listing usage.
"""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "assets" / "icons"
BRAND_DIR = ROOT / "assets" / "brand"
EXTENSION_SIZES = (16, 32, 48, 96, 128)
BRAND_SIZES = (512, 1024)

Color = tuple[int, int, int, int]


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def clamp255(value: float) -> int:
    return max(0, min(255, int(round(value))))


def mix(a: tuple[int, int, int], b: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    amount = clamp01(amount)
    return tuple(clamp255(a[i] * (1 - amount) + b[i] * amount) for i in range(3))


def over(dst: Color, src_rgb: tuple[int, int, int], alpha: float) -> Color:
    alpha = clamp01(alpha)
    if alpha <= 0:
        return dst
    sr, sg, sb = src_rgb
    dr, dg, db, da = dst
    src_a = alpha
    dst_a = da / 255.0
    out_a = src_a + dst_a * (1 - src_a)
    if out_a <= 0:
        return 0, 0, 0, 0
    out_r = (sr * src_a + dr * dst_a * (1 - src_a)) / out_a
    out_g = (sg * src_a + dg * dst_a * (1 - src_a)) / out_a
    out_b = (sb * src_a + db * dst_a * (1 - src_a)) / out_a
    return clamp255(out_r), clamp255(out_g), clamp255(out_b), clamp255(out_a * 255)


def smooth_alpha(distance_px: float, feather_px: float = 1.15) -> float:
    # Signed distance: negative is inside. This gives antialiased edges.
    return clamp01(0.5 - distance_px / max(0.01, feather_px))


def rounded_box_sdf(x: float, y: float, cx: float, cy: float, width: float, height: float, radius: float) -> float:
    qx = abs(x - cx) - width / 2 + radius
    qy = abs(y - cy) - height / 2 + radius
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - radius


def circle_alpha(x: float, y: float, cx: float, cy: float, radius: float, feather: float = 1.2) -> float:
    return smooth_alpha(math.hypot(x - cx, y - cy) - radius, feather)


def distance_to_segment(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    vx = bx - ax
    vy = by - ay
    wx = px - ax
    wy = py - ay
    length_sq = vx * vx + vy * vy
    if length_sq <= 0:
        return math.hypot(px - ax, py - ay)
    t = clamp01((wx * vx + wy * vy) / length_sq)
    cx = ax + t * vx
    cy = ay + t * vy
    return math.hypot(px - cx, py - cy)


def paint_card(color: Color, x: float, y: float, size: int, rect: tuple[float, float, float, float], stripe_rgb: tuple[int, int, int]) -> Color:
    left, top, right, bottom = [value * size for value in rect]
    width = right - left
    height = bottom - top
    radius = 0.055 * size
    cx = (left + right) / 2
    cy = (top + bottom) / 2

    shadow_sdf = rounded_box_sdf(x, y, cx + 0.012 * size, cy + 0.022 * size, width, height, radius)
    color = over(color, (9, 18, 40), 0.20 * smooth_alpha(shadow_sdf - 4.8, 8.5))

    card_sdf = rounded_box_sdf(x, y, cx, cy, width, height, radius)
    card_alpha = smooth_alpha(card_sdf, 1.15)
    color = over(color, (245, 249, 255), 0.88 * card_alpha)

    # Glass highlight.
    top_highlight = clamp01((bottom - y) / max(1, height))
    color = over(color, (255, 255, 255), 0.14 * card_alpha * top_highlight)

    # Colored tab strip.
    strip_bottom = top + height * 0.18
    strip_alpha = card_alpha if top <= y <= strip_bottom else 0.0
    color = over(color, stripe_rgb, 0.68 * strip_alpha)

    # Small content lines that scale out at tiny icon sizes.
    if size >= 48:
        line_y1 = top + height * 0.40
        line_y2 = top + height * 0.56
        line_x1 = left + width * 0.17
        line_x2 = right - width * 0.16
        for line_y, line_scale, alpha in ((line_y1, 1.0, 0.42), (line_y2, 0.72, 0.30)):
            d = distance_to_segment(x, y, line_x1, line_y, line_x1 + (line_x2 - line_x1) * line_scale, line_y)
            color = over(color, (69, 92, 151), alpha * smooth_alpha(d - max(1.0, size * 0.007), 0.9) * card_alpha)

    # Thin glass border.
    border_alpha = clamp01(1.0 - abs(card_sdf) / max(1.0, size * 0.014))
    color = over(color, (255, 255, 255), 0.30 * border_alpha)
    return color


def paint_icon_pixel(size: int, x: int, y: int) -> Color:
    px = x + 0.5
    py = y + 0.5
    nx = px / size
    ny = py / size
    color: Color = (0, 0, 0, 0)

    # Main app-tile silhouette.
    tile_sdf = rounded_box_sdf(px, py, size / 2, size / 2, size * 0.90, size * 0.90, size * 0.205)
    tile_alpha = smooth_alpha(tile_sdf, 1.4)
    if tile_alpha <= 0:
        return color

    gradient = mix((93, 74, 255), (20, 132, 255), nx * 0.72 + ny * 0.16)
    gradient = mix(gradient, (61, 220, 151), max(0.0, 1.0 - math.hypot(nx - 0.80, ny - 0.78) / 0.55) * 0.55)
    gradient = mix(gradient, (160, 114, 255), max(0.0, 1.0 - math.hypot(nx - 0.20, ny - 0.18) / 0.48) * 0.28)
    color = over(color, gradient, tile_alpha)

    # Subtle diagonal shine and border.
    diagonal = clamp01(1.0 - abs((ny - nx * 0.72) - 0.07) / 0.12)
    color = over(color, (255, 255, 255), 0.075 * diagonal * tile_alpha)
    border_alpha = clamp01(1.0 - abs(tile_sdf) / max(1.0, size * 0.014))
    color = over(color, (255, 255, 255), 0.30 * border_alpha)
    color = over(color, (11, 24, 56), 0.13 * clamp01(tile_sdf / max(1.0, size * 0.035) + 0.55) * tile_alpha)

    # Snapshot stack.
    cards = [
        ((0.26, 0.215, 0.77, 0.505), (137, 111, 255)),
        ((0.18, 0.335, 0.70, 0.630), (84, 161, 255)),
        ((0.31, 0.455, 0.83, 0.760), (61, 220, 151)),
    ]
    for rect, stripe in cards:
        color = paint_card(color, px, py, size, rect, stripe)

    # Pinned-tab marker.
    pin_alpha = circle_alpha(px, py, size * 0.342, size * 0.500, size * 0.058, 1.1)
    color = over(color, (104, 73, 255), 0.95 * pin_alpha)
    if size >= 32:
        stem_d = distance_to_segment(px, py, size * 0.342, size * 0.548, size * 0.342, size * 0.632)
        color = over(color, (104, 73, 255), 0.88 * smooth_alpha(stem_d - max(1.0, size * 0.011), 0.9))
        point_d = distance_to_segment(px, py, size * 0.315, size * 0.620, size * 0.370, size * 0.620)
        color = over(color, (104, 73, 255), 0.65 * smooth_alpha(point_d - max(1.0, size * 0.010), 0.9))

    # Time-series link dots in lower-left.
    if size >= 48:
        points = [(0.235, 0.785), (0.345, 0.740), (0.465, 0.812)]
        for (ax, ay), (bx, by) in zip(points, points[1:]):
            d = distance_to_segment(px, py, ax * size, ay * size, bx * size, by * size)
            color = over(color, (214, 255, 241), 0.64 * smooth_alpha(d - max(1.0, size * 0.008), 0.8))
        for index, (cx, cy) in enumerate(points):
            dot_alpha = circle_alpha(px, py, cx * size, cy * size, size * 0.023, 0.9)
            dot_color = (255, 255, 255) if index == 1 else (61, 220, 151)
            color = over(color, dot_color, 0.92 * dot_alpha)

    # Bookmark search lens.
    lens_cx = size * 0.655
    lens_cy = size * 0.615
    outer = size * 0.132
    inner = size * 0.082
    dist = math.hypot(px - lens_cx, py - lens_cy)
    ring_alpha = smooth_alpha(dist - outer, 1.1) * (1.0 - smooth_alpha(dist - inner, 1.1))
    color = over(color, (12, 22, 48), 0.88 * ring_alpha)
    color = over(color, (255, 255, 255), 0.28 * ring_alpha * clamp01((lens_cy - py) / max(1, outer) + 0.65))
    handle_d = distance_to_segment(px, py, lens_cx + outer * 0.58, lens_cy + outer * 0.58, lens_cx + outer * 1.32, lens_cy + outer * 1.32)
    color = over(color, (12, 22, 48), 0.90 * smooth_alpha(handle_d - max(1.0, size * 0.026), 1.0))
    color = over(color, (255, 255, 255), 0.14 * smooth_alpha(handle_d - max(0.8, size * 0.011), 0.8))

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

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # RGBA.
    png = (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", zlib.compress(b"".join(raw_rows), 9))
        + png_chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def write_svg(path: Path) -> None:
    path.write_text(
        '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-labelledby="title desc">
  <title id="title">Session Snapshots &amp; Bookmark Search icon</title>
  <desc id="desc">A polished Firefox add-on icon showing stacked session tabs, a pinned tab marker, timeline dots, and a bookmark search lens.</desc>
  <defs>
    <linearGradient id="bg" x1="128" y1="96" x2="896" y2="928" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#7C5CFF"/>
      <stop offset="0.52" stop-color="#1E90FF"/>
      <stop offset="1" stop-color="#3DDC97"/>
    </linearGradient>
    <radialGradient id="glowTop" cx="22%" cy="18%" r="54%">
      <stop offset="0" stop-color="#C3A7FF" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#C3A7FF" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowBottom" cx="82%" cy="78%" r="52%">
      <stop offset="0" stop-color="#3DDC97" stop-opacity="0.58"/>
      <stop offset="1" stop-color="#3DDC97" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="card" x1="250" y1="210" x2="760" y2="760" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#EAF1FF"/>
    </linearGradient>
    <filter id="tileShadow" x="-18%" y="-18%" width="136%" height="142%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="30" stdDeviation="36" flood-color="#091228" flood-opacity="0.28"/>
    </filter>
    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="150%" color-interpolation-filters="sRGB">
      <feDropShadow dx="14" dy="22" stdDeviation="18" flood-color="#091228" flood-opacity="0.22"/>
    </filter>
  </defs>

  <rect x="72" y="72" width="880" height="880" rx="206" fill="url(#bg)" filter="url(#tileShadow)"/>
  <rect x="72" y="72" width="880" height="880" rx="206" fill="url(#glowTop)"/>
  <rect x="72" y="72" width="880" height="880" rx="206" fill="url(#glowBottom)"/>
  <path d="M196 172c150 122 282 220 632 336" fill="none" stroke="#FFFFFF" stroke-opacity="0.10" stroke-width="82" stroke-linecap="round"/>
  <rect x="78" y="78" width="868" height="868" rx="200" fill="none" stroke="#FFFFFF" stroke-opacity="0.34" stroke-width="12"/>

  <g filter="url(#cardShadow)">
    <g transform="translate(266 220)">
      <rect width="520" height="296" rx="58" fill="url(#card)" opacity="0.76"/>
      <path d="M58 0h404c32 0 58 26 58 58v8H0v-8C0 26 26 0 58 0Z" fill="#8B6FFF" opacity="0.78"/>
      <path d="M92 128h318M92 182h224" stroke="#425A96" stroke-opacity="0.34" stroke-width="18" stroke-linecap="round"/>
    </g>
    <g transform="translate(184 342)">
      <rect width="532" height="302" rx="60" fill="url(#card)" opacity="0.92"/>
      <path d="M60 0h412c33 0 60 27 60 60v8H0v-8C0 27 27 0 60 0Z" fill="#4FA1FF" opacity="0.78"/>
      <path d="M94 130h326M94 186h236" stroke="#425A96" stroke-opacity="0.35" stroke-width="18" stroke-linecap="round"/>
    </g>
    <g transform="translate(318 462)">
      <rect width="530" height="312" rx="60" fill="url(#card)" opacity="0.86"/>
      <path d="M60 0h410c33 0 60 27 60 60v8H0v-8C0 27 27 0 60 0Z" fill="#3DDC97" opacity="0.78"/>
      <path d="M94 134h320M94 194h232" stroke="#425A96" stroke-opacity="0.32" stroke-width="18" stroke-linecap="round"/>
    </g>
  </g>

  <g aria-label="Pinned tab marker">
    <circle cx="350" cy="512" r="58" fill="#6B49FF"/>
    <path d="M350 565v84M322 638h56" stroke="#6B49FF" stroke-width="24" stroke-linecap="round"/>
    <circle cx="350" cy="512" r="20" fill="#FFFFFF" opacity="0.52"/>
  </g>

  <g aria-label="Snapshot timeline" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M240 804l112-46 122 74" stroke="#D6FFF1" stroke-width="14" opacity="0.68"/>
    <circle cx="240" cy="804" r="24" fill="#3DDC97" stroke="#FFFFFF" stroke-opacity="0.55" stroke-width="8"/>
    <circle cx="352" cy="758" r="24" fill="#FFFFFF" opacity="0.95"/>
    <circle cx="474" cy="832" r="24" fill="#3DDC97" stroke="#FFFFFF" stroke-opacity="0.55" stroke-width="8"/>
  </g>

  <g aria-label="Bookmark search lens">
    <circle cx="672" cy="630" r="122" fill="none" stroke="#0C1630" stroke-width="54"/>
    <path d="M762 720l132 132" stroke="#0C1630" stroke-width="64" stroke-linecap="round"/>
    <path d="M612 560c28-30 78-42 122-24" fill="none" stroke="#FFFFFF" stroke-opacity="0.28" stroke-width="22" stroke-linecap="round"/>
  </g>
</svg>
''',
        encoding="utf-8"
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
