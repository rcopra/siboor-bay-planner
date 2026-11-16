// The bottom panel as something to make: every hole and cut-out, and the panel DXF. No DOM here.
import { panelSide, CORNER_R, frameHoles, footprint, placedHoles, placedCutouts, holeLabel, drillSize, existingHole, existingCutout } from "./bay.js";

// DXF layers and colours, as on Siboor's drawings (ACI 5 blue: through, 3 green: M3 tap, 1 red: M4 tap).
export const LAYERS = { OUTLINE: 7, THROUGH: 5, M3_TAP: 3, M4_TAP: 1, M5_TAP: 6, CUTOUT: 7 };
export const layerOf = h => (h.fix === "tap" ? `${h.thread}_TAP` : "THROUGH");

// Everything drawn on the panel, in panel mm (front-left corner at 0, 0). With `stock` (the
// stock panel, bay.js stockPanel), holes and cut-outs already in it are marked `existing`: a part
// hole on one takes the existing hole's size and type, and unused ones are listed too.
export function panelDrawing(state, partOf, stock = null) {
  const s = panelSide(state.size);
  const items = state.items.map(it => ({ it, part: partOf(it) })).filter(p => p.part);
  const name = ({ it, part }) => it.label || part.name;
  const holes = [
    ...frameHoles(state.size).map(h => ({ ...h, drill: drillSize(h), part: "Frame (already drilled)" })),
    ...items.flatMap(p => placedHoles(p.it, p.part).map(h => {
      const e = existingHole(h, stock);
      return e ? { ...h, ...e, part: name(p) } : { ...h, part: name(p) };
    })),
  ];
  if (stock) for (const e of stock.holes) if (!holes.some(h => h.existing && h.x === e.x && h.y === e.y)) holes.push({ ...e, part: "Stock panel (unused)" });
  for (const h of holes) {
    const label = h.existing ? `existing ${h.fix === "tap" ? h.thread + " tapped" : `Ø${h.d} through`}` : holeLabel(h);
    Object.assign(h, { label, layer: layerOf(h) });
  }
  const cutouts = items.flatMap(p => placedCutouts(p.it, p.part).map(c => ({ ...c, existing: !!existingCutout(c, stock), part: name(p) })));
  if (stock) for (const e of stock.cutouts) if (!cutouts.some(c => c.existing && existingCutout(c, { cutouts: [e] }))) cutouts.push({ ...e, part: "Stock panel (unused)" });
  const parts = items.map(p => ({ ...footprint(p.it, p.part), name: name(p) }));
  return { s, r: CORNER_R, holes, cutouts, parts, stock: !!stock, turned: !!stock?.turned };
}

// --- DXF (R12: lines, arcs and circles, which every laser and CAM program reads) -----------

const f = v => (Math.round(v * 1e4) / 1e4).toString();

function roundedRect(out, layer, x, y, w, h, r) {
  const line = (x1, y1, x2, y2) => out.push(`0\nLINE\n8\n${layer}\n10\n${f(x1)}\n20\n${f(y1)}\n11\n${f(x2)}\n21\n${f(y2)}`);
  const arc = (cx, cy, a0, a1) => out.push(`0\nARC\n8\n${layer}\n10\n${f(cx)}\n20\n${f(cy)}\n40\n${f(r)}\n50\n${a0}\n51\n${a1}`);
  line(x + r, y, x + w - r, y);
  line(x + w, y + r, x + w, y + h - r);
  line(x + w - r, y + h, x + r, y + h);
  line(x, y + h - r, x, y + r);
  if (r > 0) {
    arc(x + w - r, y + r, 270, 360);
    arc(x + w - r, y + h - r, 0, 90);
    arc(x + r, y + h - r, 90, 180);
    arc(x + r, y + r, 180, 270);
  }
}

export function panelDXF(drawing) {
  const { s, r, holes, cutouts } = drawing;
  const ents = [];
  roundedRect(ents, "OUTLINE", 0, 0, s, s, r);
  for (const c of cutouts) roundedRect(ents, "CUTOUT", c.x, c.y, c.w, c.h, c.r);
  for (const h of holes) ents.push(`0\nCIRCLE\n8\n${h.layer}\n10\n${f(h.x)}\n20\n${f(h.y)}\n40\n${f(h.drill / 2)}`);
  const layers = Object.entries(LAYERS).map(([n, c]) => `0\nLAYER\n2\n${n}\n70\n0\n62\n${c}\n6\nCONTINUOUS`);
  return [
    "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSUNITS\n70\n4\n9\n$MEASUREMENT\n70\n1",
    `9\n$EXTMIN\n10\n0\n20\n0\n9\n$EXTMAX\n10\n${f(s)}\n20\n${f(s)}\n0\nENDSEC`,
    `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n${layers.length}`, ...layers, "0\nENDTAB\n0\nENDSEC",
    "0\nSECTION\n2\nENTITIES", ...ents, "0\nENDSEC\n0\nEOF", "",
  ].join("\n");
}
