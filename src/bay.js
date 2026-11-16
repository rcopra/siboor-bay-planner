// The bay's geometry: panel, keep-outs, part placement and clash checks. No DOM here.
//
// Panel coordinates: millimetres from the bottom panel's front-left corner as installed,
// X to the right, Y to the back, Z up from the panel's top face. A placed part's (x, y)
// is the front-left corner of its footprint after its rotation, so a tape measure on the
// real panel reads the same numbers.

// Siboor Trident June bottom panel (Siboor's 300 and 350 panel drawings, panel "f"):
// a square of side build + 137 with 19.5 mm round corners and four 5.4 mm frame holes
// 12 mm in from the sides and 14 mm in from the front and back. 250 follows the same rule.
export const SIZES = [250, 300, 350];
export const PANEL_THICKNESS = 4;
export const BAY_HEIGHT = 78;      // panel top to the deck's underside (Siboor model)
export const CORNER_R = 19.5;

// How a part is held decides its panel hole, as on Siboor's drawings (blue: through, green: M3
// tap, red: M4 tap). "tap": the screw comes down through the part (standoffs, ducts, printed
// mounts) into a thread in the panel, drilled at the tap size. "through": the screw goes up
// through the panel into the part's own thread (PSU, SSR heatsink), drilled at the part's
// clearance size `d`.
export const TAP_DRILL = { M3: 2.5, M4: 3.3, M5: 4.2 };

export function drillSize(hole) {
  return hole.fix === "tap" ? TAP_DRILL[hole.thread] : hole.d;
}

export function holeLabel(hole) {
  return hole.fix === "tap" ? `${hole.thread} tap Ø${drillSize(hole)}` : `Ø${hole.d} through`;
}

export function panelSide(size) {
  return size + 137;
}

export function frameHoles(size) {
  const s = panelSide(size);
  return [[12, 14], [s - 12, 14], [12, s - 14], [s - 12, s - 14]].map(([x, y]) => ({ x, y, d: 5.4, thread: "M5", fix: "through", frame: true }));
}

// What of the frame and skirts reaches into the bay, measured on Siboor's 300 model.
// Edge bands and corner feet keep their distance to the edges at every size; the stock
// IEC inlet keeps its distance to the rear-left corner.
export function keepouts(size, { iec = true } = {}) {
  const s = panelSide(size);
  const out = [
    { name: "Skirt / frame (front)", x: 0, y: 0, w: s, d: 8.5, z0: 0, z1: BAY_HEIGHT },
    { name: "Skirt / frame (rear)", x: 0, y: s - 8.5, w: s, d: 8.5, z0: 0, z1: BAY_HEIGHT },
    { name: "Skirt / frame (left)", x: 0, y: 0, w: 8.5, d: s, z0: 0, z1: BAY_HEIGHT },
    { name: "Skirt / frame (right)", x: s - 8.5, y: 0, w: 8.5, d: s, z0: 0, z1: BAY_HEIGHT },
    { name: "Deck seal (front)", x: 0, y: 0, w: s, d: 12.5, z0: 63.6, z1: BAY_HEIGHT },
    { name: "Deck seal (rear)", x: 0, y: s - 12.5, w: s, d: 12.5, z0: 63.6, z1: BAY_HEIGHT },
    { name: "Deck seal (left)", x: 0, y: 0, w: 12.5, d: s, z0: 63.6, z1: BAY_HEIGHT },
    { name: "Deck seal (right)", x: s - 12.5, y: 0, w: 12.5, d: s, z0: 63.6, z1: BAY_HEIGHT },
    { name: "Foot (front left)", x: 0, y: 0, w: 34.5, d: 33.5, z0: 0, z1: 63 },
    { name: "Foot (front right)", x: s - 34.5, y: 0, w: 34.5, d: 33.5, z0: 0, z1: 63 },
    { name: "Foot (rear left)", x: 0, y: s - 33.5, w: 34.5, d: 33.5, z0: 0, z1: 63 },
    { name: "Foot (rear right)", x: s - 34.5, y: s - 33.5, w: 34.5, d: 33.5, z0: 0, z1: 63 },
  ];
  if (iec) out.push({ name: "Stock IEC inlet + switch", x: 42.9, y: s - 50.7, w: 57.2, d: 49.1, z0: 5, z1: 53 });
  // The three NEMA17 Z motors hang from the deck into the bay (Siboor's 300 model, bed/Z group).
  // Only the motor bodies and the lower part of the rear mount reach below the deck; the front
  // mounts sit entirely above it. The rear mount box is its measured section below the deck.
  // The front two keep their distance to their corners; the rear one and its mount stay centred
  // and keep their distance to the rear edge. `screw`: the lead screw's centre.
  const c = s / 2;
  out.push(
    { name: "Z motor (front left)", kind: "z", x: 9.5, y: 9.4, w: 42.2, d: 42.6, z0: 40.3, z1: BAY_HEIGHT, screw: [30.7, 30.5] },
    { name: "Z motor (front right)", kind: "z", x: s - 51.7, y: 9.6, w: 42.6, d: 42.2, z0: 40.3, z1: BAY_HEIGHT, screw: [s - 30.4, 30.5] },
    { name: "Z motor (rear)", kind: "z", x: c - 21.0, y: s - 59.5, w: 42.2, d: 42.6, z0: 39.3, z1: BAY_HEIGHT, screw: [c + 0.3, s - 38.4] },
    { name: "Z motor mount (rear)", kind: "z", x: c - 36.8, y: s - 59.3, w: 73.8, d: 50.9, z0: 62, z1: BAY_HEIGHT },
  );
  return out;
}

// --- placement -------------------------------------------------------------------------

// A point (px, py) in the part's own frame -> panel coordinates, for a part w x d placed
// with its turned footprint's front-left corner at (x, y), turned rot degrees (0/90/180/270).
export function toPanel(item, w, d, px, py) {
  const r = ((item.rot % 360) + 360) % 360;
  let qx, qy;
  if (r === 0) [qx, qy] = [px, py];
  else if (r === 90) [qx, qy] = [d - py, px];
  else if (r === 180) [qx, qy] = [w - px, d - py];
  else [qx, qy] = [py, w - px];
  return [item.x + qx, item.y + qy];
}

export function footprint(item, part) {
  const [w, d] = partSize(item, part);
  const turned = item.rot % 180 !== 0;
  return { x0: item.x, y0: item.y, x1: item.x + (turned ? d : w), y1: item.y + (turned ? w : d) };
}

// A part's size [w, d, h], with a parametric part's params applied.
export function partSize(item, part) {
  if (part.kind === "duct") return [item.params?.length ?? 300, 25, 24.5];
  if (part.kind === "box") return [item.params?.w ?? 50, item.params?.d ?? 50, item.params?.h ?? 30];
  return part.size;
}

// A part's holes and cut-outs in its own frame, with a parametric part's params applied.
export function partHoles(item, part) {
  if (part.kind === "duct") {
    const L = item.params?.length ?? 300, out = [];
    // Siboor's 25 x 25 duct: holes on its centre line every 102 mm from its middle.
    for (let k = -10; k <= 10; k++) {
      const x = L / 2 + k * 102;
      if (x >= 15 && x <= L - 15) out.push({ x, y: 12.5, d: 3.6, thread: "M4", fix: "tap" });
    }
    return out;
  }
  return part.holes ?? [];
}

export function placedHoles(item, part) {
  const [w, d] = partSize(item, part);
  return partHoles(item, part).map(h => {
    const [x, y] = toPanel(item, w, d, h.x, h.y);
    return { ...h, x, y, drill: drillSize(h), owner: item.uid };
  });
}

export function placedCutouts(item, part) {
  const [w, d] = partSize(item, part);
  return (part.cutouts ?? []).map(c => {
    const a = toPanel(item, w, d, c.x, c.y), b = toPanel(item, w, d, c.x + c.w, c.y + c.h);
    return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]), r: c.r ?? 0, owner: item.uid };
  });
}

// --- checks ----------------------------------------------------------------------------

const EPS = 0.2;   // Siboor's own model has its ducts touching with 0.1 mm overlap
function overlaps(a, b) {
  return a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.y0 < b.y1 - EPS && b.y0 < a.y1 - EPS;
}

// Problems for every item: { uid: [message, ...] }.
export function problems(items, partOf, size, opts) {
  const s = panelSide(size);
  const kos = keepouts(size, opts).map(k => ({ ...k, r: { x0: k.x, y0: k.y, x1: k.x + k.w, y1: k.y + k.d } }));
  const placed = items.map(it => {
    const part = partOf(it);
    const h = partSize(it, part)[2];
    return { it, part, r: footprint(it, part), z0: 0, z1: h };
  });
  const out = {};
  for (const a of placed) {
    const msgs = [];
    const { r } = a;
    if (r.x0 < -EPS || r.y0 < -EPS || r.x1 > s + EPS || r.y1 > s + EPS) msgs.push("off the panel");
    if (a.z1 > BAY_HEIGHT) msgs.push(`${a.z1.toFixed(1)} mm tall: above the deck (${BAY_HEIGHT} mm)`);
    for (const b of placed) {
      if (b !== a && overlaps(r, b.r)) msgs.push(`overlaps ${b.it.label || b.part.name}`);
    }
    for (const k of kos) {
      if (overlaps(r, k.r) && a.z1 > k.z0 + EPS) msgs.push(`hits ${k.name}`);
    }
    for (const c of placedCutouts(a.it, a.part)) {
      if (c.x < 8.5 || c.y < 8.5 || c.x + c.w > s - 8.5 || c.y + c.h > s - 8.5) msgs.push("panel cut-out too close to the edge");
    }
    out[a.it.uid] = [...new Set(msgs)];
  }
  // Holes too close to another part's hole (both would be drilled): under 2 mm of material.
  const holes = placed.flatMap(p => placedHoles(p.it, p.part));
  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      const a = holes[i], b = holes[j];
      if (a.owner === b.owner) continue;
      const gap = Math.hypot(a.x - b.x, a.y - b.y) - (a.drill + b.drill) / 2;
      if (gap < 2) out[a.owner].push(`a mounting hole is ${gap.toFixed(1)} mm from another part's hole`);
    }
  }
  // On the stock panel, a new hole that would cut into one already there.
  for (const h of holes) {
    if (!opts?.stock || existingHole(h, opts.stock)) continue;
    for (const e of opts.stock.holes) {
      const gap = Math.hypot(h.x - e.x, h.y - e.y) - (h.drill + e.drill) / 2;
      if (gap < 2) out[h.owner].push(`a new hole is ${Math.max(gap, 0).toFixed(1)} mm from an existing hole: line it up or move it`);
    }
  }
  for (const k in out) out[k] = [...new Set(out[k])];
  return out;
}

// --- Siboor's stock layout -------------------------------------------------------------

// Positions from Siboor's 300 model, relative to the panel centre, checked against the holes
// their 300 and 350 panel drawings drill (stockPanel). Siboor's model has the middle duct 3.1 mm
// in front of its drilled holes; it sits on the holes here. (Siboor keeps the parts
// centred at 350: the M8P and duct holes sit at the same offsets on both drawings).
const STOCK = [
  ["lrs-350", "Power supply", -127.0, 6.0, 0],
  ["ssr-delixi", "Bed SSR", 100.1, -117.3, 0],
  ["manta-m8p", "Manta M8P", -126.8, -137.9, 0],
  ["siboor-breakout", "Cable distribution box", 98.6, 42.5, 0],
  ["duct", "Rear duct", -157.6, 126.1, 0, { length: 315 }],
  ["duct", "Middle duct", -157.3, -23.9, 0, { length: 314.3 }],   // the drawing's holes, 3.1 mm behind the model's duct
  ["duct", "Front duct", -157.6, -173.9, 0, { length: 315 }],
  ["duct", "Left duct", -182.5, -173.9, 90, { length: 325 }],
  ["duct", "Right duct", 157.5, -173.9, 90, { length: 325 }],
];

// `turned`: on a stock panel turned 180° (its holes turned with it), every part turns 180° about
// the panel centre; that needs `partOf` for the parts' footprints.
export function stockLayout(size, { turned = false, partOf } = {}) {
  const s = panelSide(size), c = s / 2;
  const items = STOCK.map(([part, label, x, y, rot, params], i) => ({
    uid: `stock-${i}`, part, label, x: round1(x + c), y: round1(y + c), rot, params: params ? { ...params } : undefined,
  }));
  return turned ? items.map(it => turn180(it, partOf(it), size)) : items;
}

// `item` turned 180° about the panel centre, as it moves when the panel it's on is turned. The
// stock duct names follow where they end up ("Front duct" becomes "Rear duct").
const OPPOSITE = { Front: "Rear", Rear: "Front", Left: "Right", Right: "Left" };
export function turn180(item, part, size) {
  const s = panelSide(size), r = footprint(item, part);
  const label = item.label?.replace(/^(Front|Rear|Left|Right) duct$/, (_, w) => `${OPPOSITE[w]} duct`);
  return { ...item, label, x: round1(s - r.x1), y: round1(s - r.y1), rot: (item.rot + 180) % 360 };
}

// Where a placed part goes back to in Siboor's stock layout: the stock item it came from, else
// the nearest stock spot for the same part. Null for a part Siboor doesn't use.
export function stockSpot(item, size, opts) {
  const spots = stockLayout(size, opts).filter(s => s.part === item.part);
  if (!spots.length) return null;
  const own = spots.find(s => s.uid === item.uid);
  if (own) return own;
  const d = s => Math.hypot(s.x - item.x, s.y - item.y) + (s.rot === item.rot ? 0 : 1000);
  return spots.reduce((a, b) => (d(b) < d(a) ? b : a));
}

// --- the stock panel: what Siboor's bottom panel comes with --------------------------------

// The SSR's heatsink cut-out, relative to the panel centre (Siboor's 300 and 350 drawings).
const STOCK_CUTOUT = { x: 101.8, y: -103.5, w: 42, h: 32, r: 1 };
export const REUSE_TOL = 0.5;   // a part hole this close to an existing hole uses it

// `holesBySize`: public/parts/stock-panel.json (tools/stock_holes.py). Null where Siboor has no
// drawing (250). `turned`: the panel fitted turned 180°, which its frame holes allow (12 mm in from
// the sides, 14 from front and back: a 90° turn would put them 2.8 mm off).
export function stockPanel(holesBySize, size, { turned = false } = {}) {
  const holes = holesBySize[size];
  if (!holes) return null;
  const s = panelSide(size), c = s / 2;
  const cut = { ...STOCK_CUTOUT, x: STOCK_CUTOUT.x + c, y: STOCK_CUTOUT.y + c, existing: true };
  const t = turned ? (x, y) => [round2(s - x), round2(s - y)] : (x, y) => [x, y];
  return {
    holes: holes.map(h => { const [x, y] = t(h.x, h.y); return { ...h, x, y, drill: h.d, existing: true }; }),
    cutouts: [turned ? { ...cut, x: s - cut.x - cut.w, y: s - cut.y - cut.h } : cut],
    turned,
  };
}

const round2 = v => Math.round(v * 100) / 100;

export function existingHole(hole, stock) {
  return stock?.holes.find(s => Math.hypot(s.x - hole.x, s.y - hole.y) <= REUSE_TOL) ?? null;
}

export function existingCutout(cut, stock) {
  return stock?.cutouts.find(s => Math.abs(s.x - cut.x) <= REUSE_TOL && Math.abs(s.y - cut.y) <= REUSE_TOL && Math.abs(s.w - cut.w) <= REUSE_TOL && Math.abs(s.h - cut.h) <= REUSE_TOL) ?? null;
}

export function round1(v) {
  return Math.round(v * 10) / 10;
}
