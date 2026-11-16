// The drill template: the bottom panel at 1:1, tiled over A4 or Letter pages, with an overview
// page and a table of every hole. Seen from above (the panel's top face), front at the bottom.
import { jsPDF } from "jspdf";
import { BAY_HEIGHT } from "./bay.js";

const PAPER = { A4: [210, 297], Letter: [215.9, 279.4] };
const INK = { THROUGH: [30, 90, 220], M3_TAP: [20, 140, 50], M4_TAP: [210, 30, 30], M5_TAP: [160, 40, 160] };
const M = 10, HEAD = 18;   // page margin and header strip, mm

// Draw the panel with `map` (panel mm -> page mm) at `k` page mm per panel mm.
function drawPanel(doc, d, map, k, full) {
  doc.setLineDashPattern([], 0);
  doc.setDrawColor(170); doc.setLineWidth(0.2); doc.setTextColor(150); doc.setFontSize(full ? 9 : 5);
  for (const p of d.parts) {
    const [x, y] = map(p.x0, p.y1);
    doc.rect(x, y, (p.x1 - p.x0) * k, (p.y1 - p.y0) * k);
    // the name in the part's front-left corner, clear of the holes' labels
    if (full) {
      const vertical = p.y1 - p.y0 > 1.5 * (p.x1 - p.x0);
      doc.text(p.name, x + (vertical ? 4 : 1.5), y + (p.y1 - p.y0) * k - 1.5, { angle: vertical ? 90 : 0 });
    }
  }
  doc.setDrawColor(0); doc.setLineWidth(full ? 0.35 : 0.25);
  const [px, py] = map(0, d.s);
  doc.roundedRect(px, py, d.s * k, d.s * k, d.r * k, d.r * k);
  doc.setLineDashPattern([2, 1], 0);
  for (const c of d.cutouts) {
    const [x, y] = map(c.x, c.y + c.h);
    doc.roundedRect(x, y, c.w * k, c.h * k, c.r * k, c.r * k);
    if (full) {
      doc.setTextColor(0); doc.setFontSize(7);
      doc.text(`Cut-out ${c.w} × ${c.h} r${c.r}`, x + 1.5, y + 3.5);
      doc.text(`corner X ${c.x.toFixed(1)}  Y ${c.y.toFixed(1)}`, x + 1.5, y + 6.5);
    }
  }
  doc.setLineDashPattern([], 0);
  for (const h of d.holes) {
    const [x, y] = map(h.x, h.y), ink = INK[h.layer] ?? [0, 0, 0];
    doc.setDrawColor(...ink); doc.setTextColor(...ink);
    const r = (h.drill / 2) * k;
    if (!full) { doc.setFillColor(...ink); doc.circle(x, y, Math.max(r, 0.7), "F"); continue; }
    doc.setLineWidth(0.25);
    doc.circle(x, y, r);
    doc.setLineWidth(0.15);
    doc.line(x - r - 3, y, x + r + 3, y); doc.line(x, y - r - 3, x, y + r + 3);
    doc.setFontSize(6.5);
    doc.text(h.label, x + r + 1.2, y - 1.2);
    doc.setFontSize(5.5);
    doc.text(`X ${h.x.toFixed(1)}  Y ${h.y.toFixed(1)}`, x + r + 1.2, y + 2.6);
  }
  doc.setDrawColor(0); doc.setTextColor(0);
}

function scaleBar(doc, x, y) {
  doc.setLineWidth(0.3); doc.setDrawColor(0);
  doc.line(x, y, x + 100, y);
  for (let i = 0; i <= 10; i++) doc.line(x + i * 10, y, x + i * 10, y - (i % 5 ? 1.5 : 3));
  doc.setFontSize(7);
  doc.text("100 mm: measure this before drilling", x + 102, y);
}

function regMark(doc, x, y) {
  doc.setLineWidth(0.15); doc.setDrawColor(0);
  doc.circle(x, y, 2.5);
  doc.line(x - 5, y, x + 5, y); doc.line(x, y - 5, x, y + 5);
}

export function drillTemplate(d, { paper = "A4", size, iec }) {
  const [pw, ph] = PAPER[paper];
  const doc = new jsPDF({ unit: "mm", format: [pw, ph] });
  // tile pages portrait or landscape, whichever takes fewer sheets
  const fit = ([w, h]) => {
    const tw = w - 2 * M, th = h - 2 * M - HEAD;
    return { w, h, tw, th, cols: Math.ceil(d.s / tw), rows: Math.ceil(d.s / th) };
  };
  const [por, lan] = [fit([pw, ph]), fit([ph, pw])];
  const T = lan.cols * lan.rows < por.cols * por.rows ? lan : por;
  const { tw, th, cols, rows } = T;
  // the tiles are centred on the panel
  const X0 = (d.s - cols * tw) / 2, YTOP = d.s + (rows * th - d.s) / 2;
  const tiles = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tiles.push({ r, c, x0: X0 + c * tw, y1: YTOP - r * th });
  const pages = 2 + tiles.length;

  // --- page 1: overview ---
  doc.setFontSize(14);
  doc.text(`Trident ${size} bottom panel: drill template`, M, M + 5);
  doc.setFontSize(8);
  const lines = [
    `Panel ${d.s} × ${d.s} mm, seen from above (its top face), front edge at the bottom. X, Y: mm from the front-left corner.`,
    `${d.holes.length} holes, ${d.cutouts.length} cut-out(s). Pages 3 to ${pages} are the panel at 1:1.`,
    "1. Print at 100% (\"Actual size\", not \"Fit to page\"). Check the 100 mm bar on every page.",
    "2. Trim each page along its border where it meets another page; overlap and tape them so the crosses line up.",
    "3. Lay the sheet on the panel with its four frame holes over the existing ones; tape it down.",
    "4. Centre-punch every crosshair. Through holes: drill the size shown. Tapped holes: drill the size shown, then tap.",
  ];
  lines.forEach((t, i) => doc.text(t, M, M + 12 + i * 4.2));
  let ly = M + 12 + lines.length * 4.2 + 3;
  for (const [layer, label] of [["THROUGH", "through hole"], ["M3_TAP", "M3 tap (drill 2.5)"], ["M4_TAP", "M4 tap (drill 3.3)"]]) {
    doc.setFillColor(...INK[layer]); doc.circle(M + 2, ly - 1, 1.3, "F");
    doc.text(label, M + 5, ly);
    ly += 4.2;
  }
  if (iec) { doc.text(`Stock IEC inlet assumed (rear left). Bay height ${BAY_HEIGHT} mm.`, M, ly); ly += 4.2; }
  const avail = Math.min(pw - 2 * M, ph - M - ly - 6), k = avail / d.s;
  const ox = (pw - d.s * k) / 2, oy = ly + 2;
  const omap = (x, y) => [ox + x * k, oy + (d.s - y) * k];
  drawPanel(doc, d, omap, k, false);
  // where each 1:1 page falls, drawn inside the panel only
  doc.setDrawColor(120); doc.setLineWidth(0.2); doc.setLineDashPattern([1, 1], 0); doc.setTextColor(120); doc.setFontSize(8);
  doc.saveGraphicsState();
  doc.rect(ox, oy, d.s * k, d.s * k, null); doc.clip(); doc.discardPath();
  tiles.forEach((t, i) => {
    const [x, y] = omap(t.x0, t.y1);
    doc.rect(x, y, tw * k, th * k);
    const [lx, ly] = omap(Math.max(t.x0, 0), Math.min(t.y1, d.s));
    doc.text(`p${i + 3}`, lx + 1.5, ly + 4);
  });
  doc.restoreGraphicsState();
  doc.setLineDashPattern([], 0); doc.setTextColor(0);
  doc.text("FRONT", pw / 2, oy + d.s * k + 4.5, { align: "center" });

  // --- page 2: hole table ---
  doc.addPage();
  doc.setFontSize(12);
  doc.text("Holes and cut-outs", M, M + 5);
  doc.setFontSize(8);
  const cx = [M, M + 10, M + 30, M + 50, M + 105];
  let y = M + 13;
  const row = cells => { cells.forEach((t, i) => doc.text(String(t), cx[i], y)); y += 4.4; };
  row(["#", "X", "Y", "Hole", "Part"]);
  doc.line(M, y - 3.2, pw - M, y - 3.2);
  const sorted = [...d.holes].sort((a, b) => a.part.localeCompare(b.part) || a.y - b.y || a.x - b.x);
  sorted.forEach((h, i) => {
    if (y > ph - M) { doc.addPage(); y = M + 5; }
    doc.setTextColor(...(INK[h.layer] ?? [0, 0, 0]));
    row([i + 1, h.x.toFixed(1), h.y.toFixed(1), h.label, h.part]);
  });
  doc.setTextColor(0);
  for (const c of d.cutouts) row(["", c.x.toFixed(1), c.y.toFixed(1), `cut-out ${c.w} × ${c.h} r${c.r} (X, Y: its corner)`, c.part]);

  // --- tiles at 1:1 ---
  tiles.forEach((t, i) => {
    doc.addPage([T.w, T.h], T.w > T.h ? "l" : "p");
    const top = M + HEAD, map = (x, y) => [M + (x - t.x0), top + (t.y1 - y)];
    doc.setFontSize(9);
    doc.text(`Trident ${size} bottom panel, 1:1. Page ${i + 3} of ${pages}: row ${t.r + 1} of ${rows} (1 = back), column ${t.c + 1} of ${cols} (1 = left)`, M, M + 3);
    scaleBar(doc, M, M + 12);
    doc.saveGraphicsState();
    doc.rect(M, top, tw, th, null); doc.clip(); doc.discardPath();
    // 10 mm ticks in panel coordinates along the tile's bottom and left edges
    doc.setDrawColor(150); doc.setLineWidth(0.15); doc.setFontSize(5); doc.setTextColor(150);
    for (let v = Math.ceil(t.x0 / 10) * 10; v <= t.x0 + tw; v += 10) {
      const [x] = map(v, 0), big = v % 50 === 0;
      doc.line(x, top + th, x, top + th - (big ? 4 : 2));
      if (big) doc.text(`X ${v}`, x + 0.6, top + th - 3);
    }
    for (let v = Math.ceil((t.y1 - th) / 10) * 10; v <= t.y1; v += 10) {
      const [, y] = map(0, v), big = v % 50 === 0;
      doc.line(M, y, M + (big ? 4 : 2), y);
      if (big) doc.text(`Y ${v}`, M + 4.6, y + 0.6);
    }
    drawPanel(doc, d, map, 1, true);
    doc.restoreGraphicsState();
    doc.setDrawColor(0); doc.setLineWidth(0.15);
    doc.rect(M, top, tw, th);
    for (const [x, y] of [[M, top], [M + tw, top], [M, top + th], [M + tw, top + th]]) regMark(doc, x, y);
  });
  return doc;
}
