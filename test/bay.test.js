import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as bay from "../src/bay.js";

const LIB = JSON.parse(readFileSync(new URL("../public/parts/library.json", import.meta.url)));
const BUILTIN = { duct: { id: "duct", kind: "duct", name: "Duct" }, box: { id: "box", kind: "box", name: "Box" } };
const partOf = it => BUILTIN[it.part] ?? LIB.find(p => p.id === it.part);

test("panel matches Siboor's drawings", () => {
  assert.equal(bay.panelSide(300), 437);
  assert.equal(bay.panelSide(350), 487);
  // 350 drawing: frame holes at +-231.5 / +-229.5 from the centre
  assert.deepEqual(bay.frameHoles(350).map(h => [h.x - 243.5, h.y - 243.5]), [[-231.5, -229.5], [231.5, -229.5], [-231.5, 229.5], [231.5, 229.5]]);
});

for (const size of [300, 350]) {   // 250 has no Siboor drawing: its stock layout is the 300 one re-centred and does not fit
  test(`stock layout is clean at ${size}`, () => {
    const p = bay.problems(bay.stockLayout(size), partOf, size, { iec: true });
    for (const [uid, msgs] of Object.entries(p)) assert.deepEqual(msgs, [], uid);
  });
}

test("stock M8P holes land on Siboor's drilled holes (300)", () => {
  const m8p = bay.stockLayout(300).find(i => i.part === "manta-m8p");
  const got = bay.placedHoles(m8p, partOf(m8p)).map(h => [+(h.x - 218.5).toFixed(1), +(h.y - 218.5).toFixed(1)]).sort();
  assert.deepEqual(got, [[-121.8, -129.6], [-121.8, -39.6], [28.2, -39.6], [38.7, -132.6]].sort());
});

test("rotation keeps holes inside the turned footprint", () => {
  const part = partOf({ part: "lrs-350" });
  for (const rot of [0, 90, 180, 270]) {
    const it = { uid: "a", part: "lrs-350", x: 100, y: 50, rot };
    const r = bay.footprint(it, part);
    for (const h of bay.placedHoles(it, part)) {
      assert.ok(h.x > r.x0 && h.x < r.x1 && h.y > r.y0 && h.y < r.y1, `rot ${rot}: ${h.x},${h.y}`);
    }
  }
});

test("a planted overlap, a part on the feet and a too-tall part are flagged", () => {
  const items = [
    { uid: "a", part: "lrs-350", x: 100, y: 100, rot: 0 },
    { uid: "b", part: "lrs-350", x: 150, y: 150, rot: 0 },
    { uid: "c", part: "ssr-delixi", x: 2, y: 2, rot: 0 },
    { uid: "d", part: "box", x: 200, y: 300, rot: 0, params: { w: 20, d: 20, h: 90 } },
  ];
  const p = bay.problems(items, partOf, 350, {});
  assert.ok(p.a.some(m => m.startsWith("overlaps")));
  assert.ok(p.c.some(m => m.includes("Foot (front left)")));
  assert.ok(p.d.some(m => m.includes("above the deck")));
});

test("Z motors: placed as in Siboor's 300 model, and only tall parts under them clash", () => {
  const z = bay.keepouts(300).filter(k => k.kind === "z"), c = 218.5;
  // lead screws relative to the panel centre (Siboor model): front ones near the corners, rear one centred
  assert.deepEqual(z.filter(k => k.screw).map(k => k.screw.map(v => +(v - c).toFixed(1))), [[-187.8, -188], [188.1, -188], [0.3, 180.1]]);
  // at 350 the front motors keep their corner distance; the rear one stays centred
  const z350 = bay.keepouts(350).filter(k => k.screw);
  assert.deepEqual(z350.map(k => k.screw), [[30.7, 30.5], [487 - 30.4, 30.5], [243.5 + 0.3, 487 - 38.4]]);
  const items = [
    { uid: "low", part: "box", x: 20, y: 20, rot: 0, params: { w: 30, d: 30, h: 35 } },
    { uid: "tall", part: "box", x: 230, y: 430, rot: 0, params: { w: 30, d: 20, h: 45 } },
  ];
  const p = bay.problems(items, partOf, 350, { iec: false });
  assert.ok(!p.low.some(m => m.includes("Z motor")), p.low.join());
  assert.ok(p.tall.some(m => m.includes("Z motor (rear)")), p.tall.join());
});
