import sys
from collections import Counter
import build123d as bd
from cad import xbf

root = xbf.read(sys.argv[1])
def find(n, label, outer=bd.Location()):
    if n.label == label:
        return n.moved(outer)
    for c in n.children:
        r = find(c, label, outer * n.location)
        if r is not None:
            return r
plate = find(root, "Black base")
holes = []
for f in plate.faces():
    if f.geom_type == bd.GeomType.CYLINDER:
        c = f.center(bd.CenterOf.BOUNDING_BOX)
        bb = f.bounding_box()
        d = round(max(bb.size.X, bb.size.Y), 2)
        holes.append((round(c.X, 2), round(c.Y, 2), d))
holes = sorted(set(holes))
print(len(holes), Counter(h[2] for h in holes))
for h in holes: print(h)
# non-circular cutouts: inner wires of top face
top = plate.faces().sort_by(bd.Axis.Z)[-1]
for w in top.inner_wires():
    bb = w.bounding_box()
    if max(bb.size.X, bb.size.Y) > 12:
        print("cutout", round(bb.min.X,1), round(bb.min.Y,1), round(bb.size.X,1), round(bb.size.Y,1), len(w.edges()))
