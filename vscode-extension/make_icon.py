#!/usr/bin/env python3
"""Generate the coderef extension icon (128x128 PNG)."""
from PIL import Image, ImageDraw, ImageFont

SIZE = 128
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Background: rounded square, dark slate
radius = 22
bg = (30, 35, 48, 255)
fg = (99, 179, 237, 255)   # blue text
accent = (246, 173, 85, 255)  # amber arrow

def rounded_rect(draw, xy, r, fill):
    x0, y0, x1, y1 = xy
    draw.rectangle([x0 + r, y0, x1 - r, y1], fill=fill)
    draw.rectangle([x0, y0 + r, x1, y1 - r], fill=fill)
    draw.ellipse([x0, y0, x0 + 2*r, y0 + 2*r], fill=fill)
    draw.ellipse([x1 - 2*r, y0, x1, y0 + 2*r], fill=fill)
    draw.ellipse([x0, y1 - 2*r, x0 + 2*r, y1], fill=fill)
    draw.ellipse([x1 - 2*r, y1 - 2*r, x1, y1], fill=fill)

rounded_rect(draw, (0, 0, SIZE-1, SIZE-1), radius, bg)

# Draw "CR" using large bold text
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 52)
    small_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
except OSError:
    font = ImageFont.load_default()
    small_font = font

# "CR" centered
text = "CR"
bbox = draw.textbbox((0, 0), text, font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
draw.text(((SIZE - tw) / 2 - bbox[0], 22 - bbox[1]), text, fill=fg, font=font)

# Small "ref:" label below
label = "ref:"
lbbox = draw.textbbox((0, 0), label, font=small_font)
lw = lbbox[2] - lbbox[0]
draw.text(((SIZE - lw) / 2 - lbbox[0], 84 - lbbox[1]), label, fill=accent, font=small_font)

# Underline accent bar
draw.rectangle([20, 108, SIZE - 20, 112], fill=accent)

img.save("icon.png")
print("icon.png written")
