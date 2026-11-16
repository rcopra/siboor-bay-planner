import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as bay from "../src/bay.js";
import { panelDrawing, panelDXF } from "../src/panel.js";
import { drillTemplate } from "../src/pdf.js";

const LIB = JSON.parse(readFileSync(new URL("../public/parts/library.json", import.meta.url)));
const BUILTIN = { duct: { id: "duct", kind: "duct", name: "Duct" }, box: { id: "box", kind: "box", name: "Box" } };
const partOf = it => BUILTIN[it.part] ?? LIB.find(p => p.id === it.part);
const stock = size => panelDrawing({ size, iec: true, items: bay.stockLayout(size) }, partOf);
const near = (a, b, tol = 0.15) => Math.abs(a - b) <= tol;

test("stock 350 holes land on Siboor's 350 drawing (panel f), relative to its centre", () => {
  const d = stock(350), c = d.s / 2;
  const at = (x, y) => d.holes.find(h => near(h.x - c, x) && near(h.y - c, y));
  // M8P (drawn blue there; tapped M3 here for its standoffs)
  for (const [x, y] of [[-121.8, -129.6], [38.7, -132.6], [28.2, -39.6], [-121.8, -39.6]]) assert.equal(at(x, y)?.layer, "M3_TAP", `${x},${y}`);
  // rear duct: red, M4 tap
  for (const x of [-102, 0, 102]) assert.equal(at(x, 138.6)?.layer, "M4_TAP", `duct ${x}`);
  // frame holes: blue, through
  for (const [x, y] of [[-231.5, -229.5], [231.5, 229.5]]) assert.equal(at(x, y)?.layer, "THROUGH");
  // SSR cut-out
  assert.equal(d.cutouts.length, 1);
  assert.ok(near(d.cutouts[0].x - c, 101.8) && near(d.cutouts[0].y - c, -103.5), JSON.stringify(d.cutouts[0]));
});

test("drill sizes follow how the part is held", () => {
  const d = stock(350), by = p => d.holes.filter(h => h.part.includes(p)).map(h => h.drill);
  assert.deepEqual([...new Set(by("Power supply"))], [4.2]);
  assert.deepEqual([...new Set(by("Bed SSR"))], [3.3]);
  assert.deepEqual([...new Set(by("Manta"))], [2.5]);
  assert.deepEqual([...new Set(by("duct"))], [3.3]);
});

test("DXF has one circle per hole and a closed outline", () => {
  const d = stock(350), dxf = panelDXF(d);
  assert.equal(dxf.match(/\nCIRCLE\n/g).length, d.holes.length);
  assert.equal(dxf.match(/\nARC\n8\nOUTLINE\n/g).length, 4);
  assert.ok(dxf.endsWith("EOF\n"));
});

test("drill template tiles cover the panel", () => {
  // 487 mm panel: 3 x 2 tiles on A4 portrait (190 x 259) and on Letter landscape (259 x 178 -> 2 x 3)
  for (const paper of ["A4", "Letter"]) {
    const doc = drillTemplate(stock(350), { paper, size: 350, iec: true });
    assert.equal(doc.getNumberOfPages(), 2 + 6, paper);
  }
});

const STOCK_HOLES = JSON.parse(readFileSync(new URL("../public/parts/stock-panel.json", import.meta.url)));

for (const size of [300, 350]) {
  test(`stock layout on the stock panel (${size}): every hole and the cut-out already there`, () => {
    const stock = bay.stockPanel(STOCK_HOLES, size);
    const d = panelDrawing({ size, iec: true, items: bay.stockLayout(size) }, partOf, stock);
    assert.deepEqual(d.holes.filter(h => !h.existing && !h.frame).map(h => `${h.part} ${h.x},${h.y}`), []);
    assert.equal(d.holes.filter(h => h.part === "Stock panel (unused)").length, 0);
    assert.deepEqual(d.cutouts.map(c => c.existing), [true]);
    const p = bay.problems(bay.stockLayout(size), partOf, size, { iec: true, stock });
    for (const [uid, msgs] of Object.entries(p)) assert.deepEqual(msgs, [], uid);
  });
}

test("a part moved off its holes: new holes, unused stock holes, and back to stock", () => {
  const size = 350, stock = bay.stockPanel(STOCK_HOLES, size);
  const items = bay.stockLayout(size);
  const psu = items.find(i => i.part === "lrs-350"), home = { x: psu.x, y: psu.y };
  psu.y += 2;   // 2 mm back: every new hole cuts into the old ones
  const d = panelDrawing({ size, items }, partOf, stock);
  assert.equal(d.holes.filter(h => h.part === "Power supply" && !h.existing).length, 4);
  assert.equal(d.holes.filter(h => h.part === "Stock panel (unused)").length, 4);
  assert.ok(bay.problems(items, partOf, size, { stock })[psu.uid].some(m => m.includes("from an existing hole")));
  const spot = bay.stockSpot(psu, size);
  assert.deepEqual([spot.x, spot.y, spot.rot], [home.x, home.y, 0]);
});

test("a new duct goes back to the nearest stock duct spot, with its length", () => {
  const duct = { uid: "new", part: "duct", x: 90, y: 400, rot: 0, params: { length: 200 } };
  const spot = bay.stockSpot(duct, 350);
  assert.equal(spot.label, "Rear duct");
  assert.equal(spot.params.length, 315);
  assert.equal(bay.stockSpot({ uid: "b", part: "box", x: 0, y: 0, rot: 0 }, 350), null);
  assert.equal(bay.stockPanel(STOCK_HOLES, 250), null);
});
