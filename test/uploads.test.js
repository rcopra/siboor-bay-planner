import { test } from "node:test";
import assert from "node:assert/strict";
import { orient, guessUp, toPart } from "../src/uploads.js";

// a 10 x 20 x 30 box's corners, drawn somewhere off the origin
const box = (w, d, h, at = [5, -7, 100]) => {
  const p = [];
  for (const x of [0, w]) for (const y of [0, d]) for (const z of [0, h]) p.push(x + at[0], y + at[1], z + at[2]);
  return [{ position: new Float32Array(p), normal: null, index: new Uint32Array([0, 1, 2]) }];
};

test("orient turns the chosen axis up and stands the part on the origin", () => {
  const m = box(10, 20, 30);
  assert.deepEqual(orient(m, "+Z").size, [10, 20, 30]);
  assert.deepEqual(orient(m, "-Z").size, [10, 20, 30]);
  assert.deepEqual(orient(m, "+Y").size, [10, 30, 20]);
  assert.deepEqual(orient(m, "-X").size, [30, 20, 10]);
  for (const up of ["+Z", "-Z", "+Y", "-Y", "+X", "-X"]) {
    const p = orient(m, up).meshes[0].position;
    for (let k = 0; k < 3; k++) assert.equal(Math.min(...p.filter((_, i) => i % 3 === k)), 0, `${up} axis ${k}`);
  }
});

test("guessUp picks the thinnest direction; toPart gives the planner's part", () => {
  assert.equal(guessUp(box(215, 115, 30)), "+Z");
  assert.equal(guessUp(box(100, 2, 60)), "+Y");
  const part = toPart({ id: "u-1", name: "Thing", up: "+Y", holes: [], meshes: box(100, 2, 60) });
  assert.deepEqual([part.kind, part.size], ["upload", [100, 60, 2]]);
});
