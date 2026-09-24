"""Joins the demo frames into docs/screenshots/demo.gif.

    npm run screenshots:demo                        # writes frame-*.png under test-results/
    python scripts/make-demo-gif.py <frames-dir>    # needs Pillow: pip install pillow

The GIF is built from screenshots (not from a screen recording), so it needs only Pillow,
not ffmpeg. Each frame is shown for a fixed time and the animation loops.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

WIDTH = 900
# How long each frame stays up, in milliseconds. The last frame (the history) is left longest.
HOLD_MS = {"1-queue": 1600, "2-create": 2200, "3-created": 1800, "4-assigned": 1800, "5-resolved": 1800, "6-timeline": 3200}


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    folder = Path(sys.argv[1])
    frames, durations = [], []
    for name, hold in HOLD_MS.items():
        matches = sorted(folder.rglob(f"frame-{name}.png"))
        if not matches:
            print(f"Missing frame-{name}.png under {folder}")
            return 1
        image = Image.open(matches[0]).convert("RGB")
        height = round(image.height * WIDTH / image.width)
        image = image.resize((WIDTH, height), Image.LANCZOS)
        # One shared palette keeps the colours steady between frames and the file small.
        frames.append(image.quantize(colors=128, method=Image.MEDIANCUT, dither=Image.NONE))
        durations.append(hold)

    out = Path(__file__).resolve().parent.parent / "docs" / "screenshots" / "demo.gif"
    frames[0].save(
        out,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=1,
    )
    print(f"Wrote {out} ({out.stat().st_size / 1024:.0f} KB, {len(frames)} frames)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
