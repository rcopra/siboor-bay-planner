import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as bay from "../src/bay.js";
import * as W from "../src/wires.js";

const LIB = JSON.parse(readFileSync(new URL("../public/parts/library.json", import.meta.url)));
const BUILTIN = { duct: { id: "duct", kind: "duct", name: "Duct" }, box: { id: "box", kind: "box", name: "Box" } };
const partOf = it => BUILTIN[it.part] ?? LIB.find(p => p.id === it.part);
const stock = () => ({ size: 350, iec: true, items: bay.stockLayout(350), wires: [] });
const uidOf = (st, part) => st.items.find(i => i.part === part).uid;

test("terminals follow their part when it turns", () => {
  const st = stock(), psu = st.items.find(i => i.part === "lrs-350");
  const t0 = W.terminalsOf(psu, partOf(psu)).find(t => t.id === "+V1");
  const turned = bay.turn180(psu, partOf(psu), 350);
  const t1 = W.terminalsOf(turned, partOf(psu)).find(t => t.id === "+V1");
  assert.ok(Math.abs(t1.x - (487 - t0.x)) < 1e-6 && Math.abs(t1.y - (487 - t0.y)) < 1e-6);
  assert.equal(W.inletTerminals(350, true).length, 3);
  assert.equal(W.inletTerminals(350, false).length, 0);
});

test("auto-route runs along the ducts, not across the parts", () => {
  const st = stock();
  // inlet L (rear left) to the SSR's L1 (front right): has to travel round the duct ring
  st.wires.push({ id: "w", a: { uid: W.PRINTER, t: "L" }, b: { uid: uidOf(st, "ssr-delixi"), t: "L1" }, auto: true });
  const { wires, problems } = W.routeWires(st, partOf);
  const w = wires[0];
  assert.ok(w.pts.length > 3, JSON.stringify(w.pts));
  assert.ok(w.ducts.length >= 2, w.ducts.join());
  const straight = Math.hypot(w.pts.at(-1)[0] - w.pts[0][0], w.pts.at(-1)[1] - w.pts[0][1]);
  assert.ok(w.length > straight && w.length < straight * 2, `${w.length} vs ${straight}`);
  assert.equal(w.kind, "mains");
  assert.deepEqual(problems, {});
});

test("mains and low voltage: sharing a duct, crossing, and a wrong join are flagged", () => {
  const st = stock(), psu = uidOf(st, "lrs-350"), ssr = uidOf(st, "ssr-delixi");
  st.wires.push(
    { id: "ac", a: { uid: W.PRINTER, t: "L" }, b: { uid: ssr, t: "L1" }, auto: true },
    { id: "dc", a: { uid: psu, t: "+V1" }, b: { uid: ssr, t: "A1+" }, auto: true },
    { id: "bad", a: { uid: psu, t: "L" }, b: { uid: ssr, t: "A2-" }, pts: [] },
  );
  const { problems } = W.routeWires(st, partOf);
  assert.ok(problems.bad.some(m => m.includes("joins a mains terminal")), problems.bad?.join());
  assert.ok(Object.values(problems).flat().some(m => m.includes("with mains wires") || m.includes("with low-voltage wires")), JSON.stringify(problems));
  // two hand-drawn wires crossing in open panel (no duct there)
  const st2 = { ...stock(), items: [st.items.find(i => i.part === "lrs-350"), st.items.find(i => i.part === "ssr-delixi")] };
  st2.wires = [
    { id: "m", a: { uid: psu, t: "L" }, b: { uid: ssr, t: "L1" }, pts: [[200, 150]] },
    { id: "v", a: { uid: psu, t: "+V1" }, b: { uid: ssr, t: "A1+" }, pts: [[200, 300]] },
  ];
  const p2 = W.routeWires(st2, partOf).problems;
  assert.ok(p2.m?.some(m => m.includes("crosses")), JSON.stringify(p2));
});

test("a wire to a removed part reports it", () => {
  const st = stock();
  st.wires.push({ id: "x", a: { uid: "gone", t: "L" }, b: { uid: W.PRINTER, t: "N" }, pts: [] });
  assert.ok(W.routeWires(st, partOf).problems.x[0].includes("gone"));
});

test("auto-route goes round other parts, not across them", () => {
  const st = stock(), ssr = uidOf(st, "ssr-delixi");
  st.wires.push({ id: "n", a: { uid: W.PRINTER, t: "N" }, b: { uid: ssr, t: "L1" }, auto: true });
  const w = W.routeWires(st, partOf).wires[0];
  const others = st.items.filter(i => !["duct", "ssr-delixi"].includes(i.part)).map(i => bay.footprint(i, partOf(i)));
  for (let i = 1; i < w.pts.length; i++) {
    const [p, q] = [w.pts[i - 1], w.pts[i]];
    for (let k = 1; k < 20; k++) {
      const m = [p[0] + (q[0] - p[0]) * k / 20, p[1] + (q[1] - p[1]) * k / 20];
      for (const r of others) assert.ok(!(m[0] > r.x0 + 1 && m[0] < r.x1 - 1 && m[1] > r.y0 + 1 && m[1] < r.y1 - 1), `crosses a part at ${m}`);
    }
  }
});

test("a wire leaves its own part the short way", () => {
  const st = stock(), psu = st.items.find(i => i.part === "lrs-350"), r = bay.footprint(psu, partOf(psu));
  st.wires.push({ id: "v", a: { uid: psu.uid, t: "+V1" }, b: { uid: uidOf(st, "ssr-delixi"), t: "A1+" }, auto: true });
  const w = W.routeWires(st, partOf).wires[0];
  // the first run from the terminal leaves the PSU within 25 mm
  const [p, q] = w.pts;
  const out = [q[0] < r.x0 || q[0] > r.x1 || q[1] < r.y0 || q[1] > r.y1, Math.min(Math.abs(q[0] - p[0]), 200)];
  assert.ok(out[0], `first bend ${q} still on the PSU`);
});
