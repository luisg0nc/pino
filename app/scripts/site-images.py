#!/usr/bin/env python3
"""Makes the landing page's pictures from the captures of the `site` group of `e2e/shots.spec.ts`.

    uv run --with pillow python app/scripts/site-images.py <raw captures> docs/images

Each capture is the whole window at 1600 × 1000 with a `.json` beside it holding the boxes of the window's regions.
The crops are made here (docs/images/README.md says which), every PNG is quantized to keep it small, and the link
preview (1200 × 1200: the mark in the middle, the name and a line) is drawn here. It needs `resvg` on PATH, and
`pnpm install` done, for the faces.
"""

import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

raw, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
repo = Path(__file__).resolve().parents[2]


def box_of(name: str, *regions: str) -> tuple[int, int, int, int]:
    boxes = json.loads((raw / f"{name}.json").read_text())
    xs = [boxes[r]["x"] for r in regions] + [boxes[r]["x"] + boxes[r]["width"] for r in regions]
    ys = [boxes[r]["y"] for r in regions] + [boxes[r]["y"] + boxes[r]["height"] for r in regions]
    return round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))


def save(image: Image.Image, name: str, width: int | None = None) -> None:
    if width and image.width > width:
        image = image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)
    image.convert("RGB").quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(out / name, optimize=True)
    print(f"{name}: {image.width} × {image.height}, {(out / name).stat().st_size // 1024} KB")


# The hero is the view alone, from its top to just under the board: the rest of it is bare ground.
HERO_HEIGHT = 712
for shot in ("hero", "hero-dark"):
    left, top, right, _ = box_of(f"site-{shot}", "viewport")
    save(Image.open(raw / f"site-{shot}.png").crop((left, top, right, top + HERO_HEIGHT)), f"{shot}.png")
# A tab's picture is the whole window: the checks at the left and the session at the right are part of what it shows.
for shot in ("brief", "schematic", "board", "3d"):
    save(Image.open(raw / f"site-{shot}.png").crop(box_of(f"site-{shot}", "window")), f"{shot}.png")

# The link preview: square, on the paper ground, the mark in the middle, so that a chat app that crops it to a
# thumbnail keeps the mark.
W = H = 1200
social = Image.new("RGB", (W, H), (241, 239, 234))
logo_png = raw / "logo-480.png"
subprocess.run(["resvg", "-w", "480", "-h", "480", str(repo / "site/assets/pino.svg"), str(logo_png)], check=True)
logo = Image.open(logo_png).convert("RGBA")
LIFT = 130  # the mark, the name and the line stand in the middle as one
social.paste(logo, ((W - logo.width) // 2, (H - logo.height) // 2 - LIFT), logo)
draw = ImageDraw.Draw(social)


def font(size: int, weight: int) -> ImageFont.FreeTypeFont:
    """The page's own face, as `pnpm install` leaves it; a Pillow that cannot read it fails here, with no other face."""
    face = repo / f"app/node_modules/@fontsource/instrument-sans/files/instrument-sans-latin-{weight}-normal.woff2"
    return ImageFont.truetype(str(face), size)


draw.text((W // 2, 920 - LIFT), "pino", fill=(32, 36, 43), font=font(112, 600), anchor="mm")
draw.text((W // 2, 1030 - LIFT), "Circuit boards with Claude Code", fill=(98, 102, 109), font=font(44, 400), anchor="mm")
save(social, "social-preview.png")
