# Try-in-Codespaces demo video

`assets/demo/try-codespaces.mp4`, `try-codespaces.gif` (English) and `try-codespaces.ko.mp4` (Korean captions) show the
Codespaces part of [Try it on GitHub](https://twin-fang.github.io/project-auto-wizard/start/try-it/): opening
[the example repository](https://github.com/Twin-Fang/project-auto-wizard-example) in a Codespace, `npm run try:install`,
then `npm run try:release` in a copy of the template.

| File | Role |
|---|---|
| `shots/NN-<step>.png` | Screenshots of each step from a real Codespace, 1280x800. The file name order is the slide order |
| `captions.<lang>.json` | Title card, one caption per `<step>`, end card, `step_seconds` per slide |
| `../compose.py` | Builds the slides and joins them with crossfades (shared with `try-it/`) |

## Rebuild

```bash
python3 assets/demo/compose.py try-codespaces en   # assets/demo/try-codespaces.mp4 and .gif
python3 assets/demo/compose.py try-codespaces ko   # assets/demo/try-codespaces.ko.mp4 (and a GIF, not committed)
```

## Update the screenshots

Follow the guide in a real Codespace at a 1280x800 browser window and replace the files in `shots/` (keep the
`NN-<step>` names; a new step needs a caption in every `captions.<lang>.json`).
