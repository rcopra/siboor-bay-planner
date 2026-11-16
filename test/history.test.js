import { test } from "node:test";
import assert from "node:assert/strict";
import { History } from "../src/history.js";

test("undo and redo step through recorded changes", () => {
  const h = new History("a");
  assert.equal(h.record("a"), false);   // no change
  h.record("b"); h.record("c");
  assert.equal(h.undo(), "b");
  assert.equal(h.undo(), "a");
  assert.equal(h.undo(), null);
  assert.equal(h.redo(), "b");
  assert.equal(h.redo(), "c");
  assert.equal(h.redo(), null);
});

test("a new change after undo drops the redo steps", () => {
  const h = new History("a");
  h.record("b"); h.undo();
  h.record("x");
  assert.equal(h.redo(), null);
  assert.equal(h.undo(), "a");
});

test("keeps at most `limit` steps", () => {
  const h = new History("0", 3);
  for (const s of ["1", "2", "3", "4", "5"]) h.record(s);
  assert.equal(h.undo(), "4"); assert.equal(h.undo(), "3"); assert.equal(h.undo(), "2");
  assert.equal(h.undo(), null);
});
