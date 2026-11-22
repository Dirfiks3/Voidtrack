"""Regenerate all VoidTrack icons from photo_2026-11-21_15-44-44.jpg.

Requires Pillow:  python -m pip install Pillow
Run from anywhere: python scripts/generate_icon.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "photo_2026-11-21_15-44-44.jpg"
ICONS = ROOT / "src-tauri" / "icons"
RES = ROOT / "src-tauri" / "gen" / "android" / "app" / "src" / "main" / "res"
PUBLIC = ROOT / "public"

if not SOURCE.exists():
    raise SystemExit(f"Missing source image: {SOURCE}")

base = Image.open(SOURCE).convert("RGBA")
w, h = base.size
side = min(w, h)
base = base.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))


def square(size: int) -> Image.Image:
    return base.resize((size, size), Image.LANCZOS)


# --- Tauri / Windows / Linux ---
TAURI_SIZES = {
    "32x32.png": 32,
    "64x64.png": 64,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
    "app-icon.png": 512,
    "StoreLogo.png": 50,
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
}
for name, size in TAURI_SIZES.items():
    square(size).save(ICONS / name)

square(256).save(
    ICONS / "icon.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

# --- Web ---
PUBLIC.mkdir(parents=True, exist_ok=True)
square(512).save(PUBLIC / "icon.png")
square(64).save(PUBLIC / "favicon.png")
square(64).save(PUBLIC / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

# --- Android launcher icons ---
DENSITIES = {
    "mipmap-mdpi": (48, 108),
    "mipmap-hdpi": (49, 162),
    "mipmap-xhdpi": (96, 216),
    "mipmap-xxhdpi": (144, 324),
    "mipmap-xxxhdpi": (192, 432),
}


def round_icon(size: int) -> Image.Image:
    image = square(size).convert("RGBA")
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    image.putalpha(mask)
    return image


def foreground(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 255))
    inner = int(size * 0.66)
    canvas.paste(square(inner), ((size - inner) // 2, (size - inner) // 2))
    return canvas


for folder, (icon_size, fg_size) in DENSITIES.items():
    target = RES / folder
    target.mkdir(parents=True, exist_ok=True)
    square(icon_size).save(target / "ic_launcher.png")
    round_icon(icon_size).save(target / "ic_launcher_round.png")
    foreground(fg_size).save(target / "ic_launcher_foreground.png")

BLACK_BACKGROUND = """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:fillColor="#000000" android:pathData="M0,0h108v108h-108z" />
</vector>
"""
(RES / "drawable" / "ic_launcher_background.xml").write_text(BLACK_BACKGROUND, encoding="utf-8")

print("Icons generated from", SOURCE.name)
