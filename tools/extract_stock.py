"""Write the planner's stock part library: public/parts/<id>.step, <id>.glb and library.json.

Each part is moved into its own frame: X right, Y to the back (the printer's front is -Y),
its footprint's front-left corner at the origin and the bottom panel's top face at Z = 0.
Mounting holes come from Siboor's pre-drilled base plate (the 300 model), taken from the
holes that fall under each part's footprint.

Run: cad run tools/extract_stock.py <trident cad repo>
     (needs <repo>/cache/siboor-deck_electronics.xbf)
"""
import json
import sys
from pathlib import Path

import build123d as bd
from cad import model, xbf

CAD = Path(sys.argv[1]).resolve()
OUT = Path(__file__).resolve().parent.parent / "public" / "parts"
OUT.mkdir(parents=True, exist_ok=True)
PANEL_TOP = -62.0   # Siboor frame: the bottom panel's top face


def find(node, label, outer=bd.Location()):
    """(node, its parent's world location) for the one node labelled `label`."""
    hits = []

    def walk(n, o):
        if n.label == label:
            hits.append((n, o))
        for c in n.children:
            walk(c, o * n.location)

    walk(node, outer)
    assert len(hits) == 1, (label, len(hits))
    return hits[0]


def world(node, outer):
    return node.moved(outer)


def plate_holes(plate):
    """Round holes in Siboor's base plate: (x, y, d) in the Siboor frame."""
    out = set()
    for f in plate.faces():
        if f.geom_type == bd.GeomType.CYLINDER:
            bb = f.bounding_box()
            d = round(max(bb.size.X, bb.size.Y), 2)
            if d < 12 and d > 2:   # skip the 1 mm corner arcs and the 19.5 mm panel corners
                c = f.center(bd.CenterOf.BOUNDING_BOX)
                out.add((round(c.X, 2), round(c.Y, 2), d))
    return sorted(out)


THREAD = {3.2: "M3", 3.6: "M3", 4.2: "M4"}   # Siboor's clearance hole -> screw


def normalise(shape, label, colour, footprint=None):
    """`shape` moved into the part frame. `footprint` (a bbox) sets X/Y; default its own."""
    fb = footprint or shape.bounding_box()
    moved = shape.moved(bd.Pos(-fb.min.X, -fb.min.Y, -PANEL_TOP))
    moved.label = label
    if colour:
        moved.color = colour
    return moved, (fb.min.X, fb.min.Y)


def emit(pid, shape, meta, step_shape=None):
    """Write <pid>.glb (display) from `shape` and <pid>.step from `step_shape` (default the same)."""
    if step_shape is None:
        model(shape, name=pid).export(str(OUT / f"{pid}.step"), str(OUT / f"{pid}.glb"))
    else:
        model(shape, name=pid).export(str(OUT / f"{pid}.glb"))
        model(step_shape, name=f"{pid}-step").export(str(OUT / f"{pid}.step"))
    bb = shape.bounding_box()
    meta.update(id=pid, step=f"parts/{pid}.step", glb=f"parts/{pid}.glb",
                size=[round(bb.max.X, 1), round(bb.max.Y, 1), round(bb.max.Z, 1)],
                below=round(-min(bb.min.Z, 0), 1))
    return meta


def holes_under(holes, origin, size, margin=3):
    ox, oy = origin
    out = []
    for x, y, d in holes:
        lx, ly = x - ox, y - oy
        if -margin <= lx <= size[0] + margin and -margin <= ly <= size[1] + margin:
            out.append(dict(x=round(lx, 2), y=round(ly, 2), d=d, thread=THREAD.get(d)))
    return out


root = xbf.read(CAD / "cache/siboor-deck_electronics.xbf")
bay, bay_outer = find(root, "Electrical compartment-assembly")
plate = world(*find(root, "Black base"))
HOLES = plate_holes(plate)
library = []
SIBOOR_SRC = "Siboor Trident June CAD (github.com/Lzhikai/SIBOOR-Voron-Trident-June)"


def slim(shape, min_size):
    """`shape` without the solids smaller than `min_size` mm every way (SMD parts)."""
    keep = [s for s in shape.solids() if max(tuple(s.bounding_box().size)) >= min_size]
    return bd.Compound(children=[bd.Solid(s.wrapped) for s in keep], label=shape.label)


def light(shape, max_faces=5000, box_faces=300, board=1.6):
    """`shape` with every solid of more than `max_faces` faces (a board fused with all its
    connectors) swapped for its outline: its lowest large flat face without its holes,
    `board` mm thick; and every solid of more than `box_faces` faces swapped for its box."""
    kids = []
    for s in shape.solids():
        if len(s.faces()) > max_faces:
            flat = [f for f in s.faces() if f.geom_type == bd.GeomType.PLANE and abs(f.normal_at().Z) > 0.99]
            low = min(f.center().Z for f in flat if f.area > 1000)
            face = max((f for f in flat if abs(f.center().Z - low) < 0.01), key=lambda f: f.area)
            face = bd.Face(face.outer_wire())
            s = bd.Solid.extrude(face, bd.Vector(0, 0, board if face.normal_at().Z > 0 else -board))
            if s.bounding_box().min.Z < low - 0.01:
                s = s.moved(bd.Pos(0, 0, board))
        elif len(s.faces()) > box_faces:
            b = s.bounding_box()
            s = bd.Solid.make_box(*b.size).moved(bd.Pos(*b.min))
        kids.append(bd.Solid(s.wrapped))
    out = bd.Compound(children=kids, label=shape.label)
    out.color = shape.color
    return out


def siboor(pid, label, name, category, colour=None, extra=(), notes="", min_size=None, lighten=False, drop=()):
    """`drop`: labels of the node's children to leave out."""
    node, outer = find(bay, label, bay_outer)
    if drop:
        kids = [c for c in node.children if c.label not in drop]
        assert len(kids) == len(node.children) - len(drop), [c.label for c in node.children]
        first = [world(c, outer * node.location) for c in kids]
    else:
        first = [world(node, outer)]
    parts = first + [world(*find(bay, e, bay_outer)) for e in extra]
    if min_size:
        parts = [slim(p, min_size) for p in parts]
    shape = bd.Compound(children=parts, label=name) if len(parts) > 1 else parts[0]
    shape, origin = normalise(shape, name, colour)
    meta = dict(name=name, category=category, source=SIBOOR_SRC, notes=notes)
    bb = shape.bounding_box()
    meta["holes"] = holes_under(HOLES, origin, (bb.max.X, bb.max.Y))
    return emit(pid, shape, meta, light(shape) if lighten else None), origin


m, _ = siboor("lrs-350", "MW LRS power supply", "Power supply (Mean Well LRS-350)", "Power",
              notes="The same case for the 24 V and 48 V versions.")
library.append(m)

m, origin = siboor("ssr-delixi", "Delixi SSR", "Bed solid state relay", "Power",
                   notes="Siboor's Delixi SSR. Its heatsink sits in a 42 × 32 cut-out through the panel.")
# Siboor's heatsink cut-out (300 and 350 panel drawings): 42 x 32, 1 mm corner radius.
m["cutouts"] = [dict(x=round(101.8 - origin[0], 2), y=round(-103.5 - origin[1], 2), w=42.0, h=32.0, r=1.0)]
library.append(m)

m, _ = siboor("manta-m8p", "Mainboard-Assembly", "BTT Manta M8P 2.0", "Electronics",
              drop=("Motherboard driver cooling module",),
              notes="On M3 × 10 standoffs, without Siboor's driver fan module. The STEP has the "
                    "board outline only (no connectors) to keep it small.", min_size=4, lighten=True)
library.append(m)

m, _ = siboor("siboor-breakout", "Cable breakout module", "Cable distribution box", "Electronics")
library.append(m)


# How each part is held, so how its panel holes are made (see bay.js drillSize). Siboor's 350
# drawing: PSU through (blue), SSR M4 tap (red), distribution box M3 tap (green). The M8P is
# drawn through (blue) but is tapped here for its standoffs, as the user asked.
FIX = {"lrs-350": ("through", None), "ssr-delixi": ("tap", "M4"), "manta-m8p": ("tap", "M3"),
       "siboor-breakout": ("tap", "M3")}
for m in library:
    fix, thread = FIX[m["id"]]
    for h in m["holes"]:
        h["fix"] = fix
        if thread:
            h["thread"] = thread

# Screw terminals (part frame), measured on the parts above: the PSU's 9-way block along its left
# end, 9.5 mm pitch, in the LRS-350's order (L, N, PE, -V x3, +V x3; +V by the voltage pot at the
# back); the SSR's four corner terminals as labelled on its model.
PSU_Y = [11.0, 20.5, 30.0, 39.5, 49.0, 58.5, 68.0, 77.5, 87.0]
PSU_T = [("L", "L"), ("N", "N"), ("PE", "PE"), ("-V1", "−V"), ("-V2", "−V"), ("-V3", "−V"), ("+V1", "+V"), ("+V2", "+V"), ("+V3", "+V")]
TERMINALS = {
    "lrs-350": [dict(id=i, name=n, x=7.0, y=y, kind="mains" if k < 3 else "dc") for k, ((i, n), y) in enumerate(zip(PSU_T, PSU_Y))],
    "ssr-delixi": [dict(id="L1", name="L1", x=9.3, y=54.0, kind="mains"), dict(id="T1", name="T1", x=36.3, y=54.0, kind="mains"),
                   dict(id="A2-", name="A2−", x=9.3, y=6.5, kind="dc"), dict(id="A1+", name="A1+", x=36.3, y=6.5, kind="dc")],
}
for m in library:
    if m["id"] in TERMINALS:
        m["terminals"] = TERMINALS[m["id"]]

(OUT / "library.json").write_text(json.dumps(library, indent=1))
for m in library:
    print(f"{m['id']:22s} {m['size']}  below {m['below']}  holes {len(m['holes'])}  {[(h['x'], h['y'], h['d']) for h in m['holes']]}")
