"""Builds the repository's social preview image (Settings > General > Social preview).

    python3 assets/social/compose.py      # -> assets/social/social-preview.png (1280x640)

Same look as the demo videos (assets/demo/compose.py). Needs Pillow. The font must cover Latin text; set
DEMO_FONT to override the default (Apple SD Gothic Neo on macOS).
"""
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent / "social-preview.png"
W, H = 1280, 640
BG_TOP, BG_BOTTOM, ACCENT, WHITE, MUTED, CHIP = (13, 17, 33), (32, 24, 66), (46, 160, 67), (255, 255, 255), (190, 200, 230), (44, 52, 86)
FONT = os.environ.get("DEMO_FONT", "/System/Library/Fonts/AppleSDGothicNeo.ttc")
FONT_REGULAR, FONT_BOLD = 0, 6  # face indexes in AppleSDGothicNeo.ttc
MONO = "/System/Library/Fonts/Menlo.ttc"

TITLE = "project-auto-wizard"
TAGLINE = "One command sets up versioning, CHANGELOG,"
TAGLINE_2 = "GitHub Releases and CI/CD in your repo"
COMMAND = "npx project-auto-wizard"
# The release flow, left to right
FLOW = ["feat: commit", "release PR", "vX.Y.Z tag", "GitHub Release", "CHANGELOG"]
FOOTNOTE = "Plain GitHub Actions in your repository  ·  No API keys  ·  Spring · Flutter · React · Python · Go · Node"


def font(size, bold=False, path=FONT):
    try:
        return ImageFont.truetype(path, size, index=FONT_BOLD if bold and path == FONT else 0)
    except OSError:
        return ImageFont.truetype(path, size)


def main():
    img = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)
    for y in range(H):
        t = y / (H - 1)
        draw.line([(0, y), (W, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM)))

    x = 80
    draw.text((x, 70), TITLE, font=font(76, bold=True), fill=WHITE)
    draw.text((x, 180), TAGLINE, font=font(38), fill=MUTED)
    draw.text((x, 228), TAGLINE_2, font=font(38), fill=MUTED)

    # Command chip
    cmd_font = font(34, path=MONO)
    cmd_w = draw.textlength(f"$ {COMMAND}", font=cmd_font)
    draw.rounded_rectangle([x, 310, x + cmd_w + 56, 378], 16, fill=CHIP)
    draw.text((x + 28, 324), "$ ", font=cmd_font, fill=ACCENT)
    draw.text((x + 28 + draw.textlength("$ ", font=cmd_font), 324), COMMAND, font=cmd_font, fill=WHITE)

    # Release flow: pills joined by arrows
    pill_font, cx, y = font(26, bold=True), x, 440
    for i, label in enumerate(FLOW):
        w = draw.textlength(label, font=pill_font) + 40
        draw.rounded_rectangle([cx, y, cx + w, y + 52], 26, fill=ACCENT if i == 0 else CHIP)
        draw.text((cx + 20, y + 10), label, font=pill_font, fill=WHITE)
        cx += w
        if i < len(FLOW) - 1:
            draw.text((cx + 12, y + 6), "→", font=font(32, bold=True), fill=MUTED)
            cx += 56

    draw.text((x, 548), FOOTNOTE, font=font(24), fill=MUTED)
    img.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
