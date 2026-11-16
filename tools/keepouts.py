"""What of the frame and skirts sits inside the bay (panel outline, panel top to deck underside)."""
import sys
import build123d as bd
from cad import xbf
H, TOP, DECK = 218.5, -62.0, 16.0
for path in sys.argv[1:]:
    root = xbf.read(path)
    def walk(n, outer, name):
        here = outer * n.location
        if not n.children:
            for s in n.moved(outer).solids():
                b = s.bounding_box()
                x0, x1 = max(b.min.X, -H), min(b.max.X, H)
                y0, y1 = max(b.min.Y, -H), min(b.max.Y, H)
                z0, z1 = max(b.min.Z, TOP), min(b.max.Z, DECK)
                if x1 - x0 > 1 and y1 - y0 > 1 and z1 - z0 > 0.5:
                    print(f"{name[-60:]:60s} x {x0:7.1f}..{x1:7.1f} y {y0:7.1f}..{y1:7.1f} z {z0 - TOP:5.1f}..{z1 - TOP:5.1f}")
        for c in n.children:
            walk(c, here, name + "/" + (c.label or ""))
    walk(root, bd.Location(), root.label or "")
