"""Generates the icons of the installable app (icons/*.png). Usage: python tools/make_icons.py"""
import math
import pathlib

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
NAVY = (16, 35, 59)
ACCENT = (90, 160, 240)
FONT = "C:/Windows/Fonts/segoeuib.ttf"


def draw(size, maskable=False):
    s = size * 4  # drawing large and then shrinking: cleaner edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, s, s], fill=NAVY)  # full page: the system crops the shape
        scale = 0.72  # content inside the safe zone
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=NAVY)
        scale = 0.9
    font = ImageFont.truetype(FONT, int(s * 0.34 * scale))
    text = "SM$"
    box = d.textbbox((0, 0), text, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    x = (s - w) / 2 - box[0]
    y = s * 0.44 - h / 2 - box[1]
    d.text((x, y), text, font=font, fill="white")
    # wave under the lettering
    wy = s * 0.70
    ww = s * 0.46 * scale
    n = 120
    pts = [(s / 2 - ww + i * (2 * ww / n), wy + s * 0.03 * scale * math.sin(i / n * 4 * math.pi)) for i in range(n + 1)]
    d.line(pts, fill=ACCENT, width=int(s * 0.03), joint="curve")
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    draw(192).save(OUT / "icon-192.png")
    draw(512).save(OUT / "icon-512.png")
    draw(512, maskable=True).save(OUT / "icon-maskable-512.png")
    draw(180).save(OUT / "apple-touch-icon.png")
    draw(32).save(OUT / "favicon-32.png")
    print("icons written to", OUT)
