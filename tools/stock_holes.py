"""The holes Siboor's stock bottom panel ("f") comes with, from their 300 and 350 panel drawings.

Writes public/parts/stock-panel.json: {size: [{x, y, d, fix, thread}]}, in panel coordinates
(mm from the front-left corner). Colours on the drawings: 5 blue through, 3 green M3 tap, 1 red M4 tap.
Some circles are drawn with a flipped extrusion (0, 0, -1): their centres are converted to world
coordinates. The panel is found by its four 5.4 mm frame holes, 12 mm in from the sides and 14 from
the front and back.

Run: uv run --with ezdxf python -I tools/stock_holes.py <300.dxf> <350.dxf>
"""
import json
import sys
from pathlib import Path

import ezdxf

OUT = Path(__file__).resolve().parent.parent / "public" / "parts" / "stock-panel.json"
FIX = {5: ("through", None), 3: ("tap", "M3"), 1: ("tap", "M4")}
result = {}
for size, path in zip((300, 350), sys.argv[1:3]):
    doc = ezdxf.readfile(path)
    layers = {l.dxf.name: l.dxf.color for l in doc.layers}
    circles = []
    for e in doc.modelspace().query("CIRCLE"):
        c = e.ocs().to_wcs(e.dxf.center)
        colour = e.dxf.color if e.dxf.color not in (0, 256) else layers.get(e.dxf.layer)
        circles.append((c.x, c.y, round(e.dxf.radius * 2, 2), colour))
    s = size + 137
    frame = [c for c in circles if c[2] == 5.4]
    # the four frame holes 413 x 409 apart (at 350: s - 24 by s - 28)
    corner = None
    xs = sorted({round(c[0], 1) for c in frame}); ys = sorted({round(c[1], 1) for c in frame})
    for x0 in xs:
        for y0 in ys:
            want = [(x0, y0), (x0 + s - 24, y0), (x0, y0 + s - 28), (x0 + s - 24, y0 + s - 28)]
            if all(any(abs(c[0] - wx) < .2 and abs(c[1] - wy) < .2 for c in frame) for wx, wy in want):
                corner = (x0 - 12, y0 - 14)
    assert corner, f"no {size} panel found"
    holes = []
    for x, y, d, colour in circles:
        px, py = x - corner[0], y - corner[1]
        if 0 < px < s and 0 < py < s and d != 5.4:
            fix, thread = FIX[colour]
            h = dict(x=round(px, 2), y=round(py, 2), d=d, fix=fix)
            if thread:
                h["thread"] = thread
            holes.append(h)
    holes.sort(key=lambda h: (h["y"], h["x"]))
    result[size] = holes
    print(size, "panel corner", [round(v, 1) for v in corner], len(holes), "holes:",
          {k: sum(1 for h in holes if (h["d"], h["fix"]) == k) for k in {(h["d"], h["fix"]) for h in holes}})
OUT.write_text(json.dumps(result, indent=1))
