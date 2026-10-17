"""Builds a demo video from the screenshots in assets/demo/<demo>/shots/ and a caption file.

    python3 assets/demo/compose.py try-it en           # -> assets/demo/try-it.mp4, try-it.gif
    python3 assets/demo/compose.py try-it ko           # -> assets/demo/try-it.ko.mp4, try-it.ko.gif
    python3 assets/demo/compose.py try-codespaces en   # -> assets/demo/try-codespaces.mp4, try-codespaces.gif

Each shots/NN-<step>.png becomes one captioned slide (caption from captions.<lang>.json, key <step>), between a
title card and an end card, joined with crossfades. Needs Pillow and ffmpeg. The font must cover the caption
language; set DEMO_FONT to override the default (Apple SD Gothic Neo on macOS).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# Videos land next to the demo folders: assets/demo/<demo>.mp4
OUT_DIR = Path(__file__).resolve().parent

W, H = 1600, 1000  # video frame
SHOT_W, SHOT_MAX_H, SHOT_TOP = 1280, 760, 200  # screenshot placement
TITLE_SECONDS, STEP_SECONDS, END_SECONDS, FADE_SECONDS = 3.0, 3.2, 4.0, 0.5
BG_TOP, BG_BOTTOM, ACCENT, WHITE, MUTED = (13, 17, 33), (32, 24, 66), (46, 160, 67), (255, 255, 255), (190, 200, 230)
FONT = os.environ.get("DEMO_FONT", "/System/Library/Fonts/AppleSDGothicNeo.ttc")
FONT_REGULAR, FONT_BOLD = 0, 6  # face indexes in AppleSDGothicNeo.ttc


def font(size, bold=False):
    try:
        return ImageFont.truetype(FONT, size, index=FONT_BOLD if bold else FONT_REGULAR)
    except OSError:
        return ImageFont.truetype(FONT, size)


def background():
    img = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)
    for y in range(H):
        t = y / (H - 1)
        draw.line([(0, y), (W, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM)))
    return img


def centered(draw, y, text, f, fill):
    draw.text(((W - draw.textlength(text, font=f)) / 2, y), text, font=f, fill=fill)


def card(title, lines):
    img = background()
    draw = ImageDraw.Draw(img)
    centered(draw, H / 2 - 110, title, font(64, bold=True), WHITE)
    for i, line in enumerate(lines):
        centered(draw, H / 2 + 10 + i * 56, line, font(34), MUTED)
    return img


def step(shot_path, number, total, caption):
    img = background().convert("RGBA")
    shot = Image.open(shot_path).convert("RGB")
    shot = shot.resize((SHOT_W, int(shot.height * SHOT_W / shot.width)))
    shot = shot.crop((0, 0, SHOT_W, min(shot.height, SHOT_MAX_H)))
    mask = Image.new("L", shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, shot.width - 1, shot.height - 1], 18, fill=255)
    x = (W - SHOT_W) // 2
    # Soft drop shadow under the screenshot
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([x + 8, SHOT_TOP + 16, x + SHOT_W + 8, SHOT_TOP + shot.height + 16], 18, fill=(0, 0, 0, 150))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(18)))
    img.paste(shot, (x, SHOT_TOP), mask)
    draw = ImageDraw.Draw(img)
    # Step badge "n / total", then the caption
    badge, badge_font = f"{number} / {total}", font(30, bold=True)
    badge_w = draw.textlength(badge, font=badge_font) + 36
    draw.rounded_rectangle([x, 70, x + badge_w, 120], 25, fill=ACCENT)
    draw.text((x + 18, 76), badge, font=badge_font, fill=WHITE)
    draw.text((x + badge_w + 24, 70), caption, font=font(40, bold=True), fill=WHITE)
    return img.convert("RGB")


def build(demo, lang):
    demo_dir = OUT_DIR / demo
    captions = json.loads((demo_dir / f"captions.{lang}.json").read_text(encoding="utf-8"))
    shots = sorted((demo_dir / "shots").glob("*.png"))
    # Optional "step_seconds" in the caption file: longer slides for dense screens such as terminals
    step_seconds = captions.get("step_seconds", STEP_SECONDS)
    slides = [(card(captions["title"], [captions["subtitle"]]), TITLE_SECONDS)]
    for number, shot in enumerate(shots, start=1):
        key = shot.stem
        if key not in captions["steps"]:
            raise SystemExit(f"captions.{lang}.json has no caption for {key}")
        slides.append((step(shot, number, len(shots), captions["steps"][key]), step_seconds))
    slides.append((card(captions["end_title"], captions["end_lines"]), END_SECONDS))

    frames = demo_dir / ".frames" / lang
    frames.mkdir(parents=True, exist_ok=True)
    inputs, offset, chain, prev = [], 0.0, [], "[0:v]"
    for i, (img, seconds) in enumerate(slides):
        path = frames / f"{i:02d}.png"
        img.save(path)
        inputs += ["-loop", "1", "-t", str(seconds + FADE_SECONDS), "-i", str(path)]
        if i:
            chain.append(f"{prev}[{i}:v]xfade=transition=fade:duration={FADE_SECONDS}:offset={offset:.2f}[v{i}]")
            prev = f"[v{i}]"
        offset += seconds
    chain.append(f"{prev}fps=30,format=yuv420p[out]")

    suffix = "" if lang == "en" else f".{lang}"
    mp4, gif = OUT_DIR / f"{demo}{suffix}.mp4", OUT_DIR / f"{demo}{suffix}.gif"
    run = lambda *args: subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)
    run(*inputs, "-filter_complex", ";".join(chain), "-map", "[out]", "-c:v", "libx264", "-crf", "22", "-movflags", "+faststart", str(mp4))
    # GIF for places that cannot play video (README): fewer frames and colors keep it small
    run("-i", str(mp4), "-vf", "fps=6,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", str(gif))
    print(f"{mp4.name} {mp4.stat().st_size // 1024} KB, {gif.name} {gif.stat().st_size // 1024} KB")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("usage: compose.py <demo folder, e.g. try-it> [lang]")
    build(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "en")
