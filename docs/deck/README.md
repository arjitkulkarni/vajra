# SIH 2026 idea deck

Generates `VAJRA - SIH2026 Idea Submission.pptx` (6 slides, 16:9) on the Desktop.

```bash
pip install python-pptx pillow
python deck2.py
```

Built on the official SIH 2026 template chrome, sampled from the provided PDF:
white ground, `#006FC0` footer bar, `#8063A1` team oval, black Times New Roman
titles, Arial body. One accent (the template blue) carries every diagram.

- `kit.py`   — palette, shape primitives, monoline icons, native PowerPoint chart
               helpers, and a font-metric engine that measures with the real
               Windows TTFs (so blocks are laid out at their true wrapped height
               and nothing can overlap).
- `deck.py`  — page chrome, the vajra seal, slides 1-3.
- `deck2.py` — slides 4-6 and the build entry point.
- `logos/`   — the official SIH 2026 and DSU lockups, alpha flattened onto white.

The trust chart on slide 5 is a real, editable PowerPoint line chart driven by the
trust-engine deltas in `ARCHITECTURE.md` §4.3, with the step-up gate (65) from the
trust-gate table drawn as a threshold line.

Export to PDF for the portal: open in PowerPoint, Save As -> PDF.
