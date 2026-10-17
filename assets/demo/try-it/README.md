# Try-it demo video

`assets/demo/try-it.mp4`, `try-it.gif` (English) and `try-it.ko.mp4` (Korean captions) show the browser-only flow of
[Run it on GitHub, no install](https://twin-fang.github.io/project-auto-wizard/start/try-it/) (the "No terminal? Clicks only" part): copying
[the example repository](https://github.com/Twin-Fang/project-auto-wizard-example) and releasing from GitHub's web UI.

| File | Role |
|---|---|
| `shots/NN-<step>.png` | Screenshots of each step, 1280x800, taken from a real run. The file name order is the slide order |
| `captions.<lang>.json` | Title card, one caption per `<step>`, end card |
| `../compose.py` | Builds the slides and joins them with crossfades (shared with `try-codespaces/`) |

## Rebuild

Needs Python with Pillow and ffmpeg.

```bash
python3 assets/demo/compose.py try-it en   # assets/demo/try-it.mp4 and try-it.gif
python3 assets/demo/compose.py try-it ko   # assets/demo/try-it.ko.mp4 (and a GIF, not committed)
```

The default font is Apple SD Gothic Neo (macOS). On another system set `DEMO_FONT` to a font file that covers the
caption language.

## Update the screenshots

Follow the guide on a fresh copy of the example repository at a 1280x800 browser window and replace the files in
`shots/` (keep the `NN-<step>` names; a new step needs a caption in every `captions.<lang>.json`). Add a language with
a new `captions.<lang>.json`.
