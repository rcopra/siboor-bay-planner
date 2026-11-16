// The wiring view: terminals and wires drawn over the plan, drawing and editing wires, and the
// right-hand panel (problems, the selected wire or part, the wiring diagram).
import { round1, partSize, fromPanel } from "./bay.js";
import { el } from "./plan2d.js";
import { COLOURS, GAUGES, PRINTER, allTerminals, findTerminal, defaultColour, wireName } from "./wires.js";

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const id = () => Math.random().toString(36).slice(2, 9);
const snap = v => round1(Math.round(v));

export class Wiring {
  constructor(app) {
    this.app = app;          // app.state.wires, app.routed (wires.routeWires), app.update(), app.commit()
    this.drawing = null;     // { a: port, pts } while a wire is being drawn
    this.dragBend = null;    // index of the bend being dragged on the selected wire
    this.placing = null;     // uid of the part a new terminal is being placed on
    this.preview = null;
  }

  get st() { return this.app.state; }
  terms() { return allTerminals(this.st, this.app.partOf); }
  wire(wid = this.st.wireSel) { return this.st.wires.find(w => w.id === wid); }
  routedOf(wid) { return this.app.routed.wires.find(r => r.wire.id === wid); }

  // --- drawing on the plan -------------------------------------------------------------------

  draw(root, text) {
    const { routed } = this.app;
    for (const r of routed.wires) {
      if (!r.pts) continue;
      const d = "M" + r.pts.map(p => p.join(",")).join(" L");
      const g = el("g", { class: "wire" + (r.wire.id === this.st.wireSel ? " sel" : "") + (routed.problems[r.wire.id] ? " bad" : ""), "data-wire": r.wire.id }, root);
      el("path", { d, class: "hit" }, g);
      if (r.kind === "mains") el("path", { d, class: "mainsglow" }, g);
      el("path", { d, class: "core", stroke: COLOURS[r.wire.colour] ?? "#d62f2f" }, g)
        .appendChild(Object.assign(document.createElementNS("http://www.w3.org/2000/svg", "title"), { textContent: `${wireName(r)} · ${Math.round(r.length)} mm` }));
    }
    const sel = this.routedOf(this.st.wireSel);
    if (sel?.pts) sel.pts.slice(1, -1).forEach((p, i) => el("circle", { cx: p[0], cy: p[1], r: 2.6, class: "bend", "data-i": i }, root));
    const terms = this.terms();
    // A label that would run into the next terminal along its row is written upwards instead, or
    // downwards if that would run into another label. Boxes are [x0, y0, x1, y1], mm.
    const len = t => t.name.length * 2.2;
    const crowded = t => terms.some(o => o.owner === t.owner && o !== t && Math.abs(o.y - t.y) < 3 && o.x > t.x && o.x - t.x < 4 + len(t));
    const flat = terms.filter(t => !crowded(t)).map(t => [t.x + 4, t.y - 1.4, t.x + 4 + len(t), t.y + 2.2]);
    const hits = b => flat.some(f => b[0] < f[2] && f[0] < b[2] && b[1] < f[3] && f[1] < b[3]);
    for (const t of terms) {
      const g = el("g", { class: `term ${t.kind}${t.custom ? " custom" : ""}`, "data-term": `${t.owner}|${t.id}` }, root);
      el("circle", { cx: t.x, cy: t.y, r: 2.8 }, g)
        .appendChild(Object.assign(document.createElementNS("http://www.w3.org/2000/svg", "title"), { textContent: `${t.partName} ${t.name} (${t.kind === "mains" ? "mains" : "low voltage"})` }));
      if (!crowded(t)) text(t.x + 4, t.y - 1.4, t.name, { class: "tlabel" });
      else if (!hits([t.x - 1.6, t.y + 3.2, t.x + 1.4, t.y + 3.2 + len(t) + 1.5])) text(t.x + 1.4, t.y + 3.2, t.name, { class: "tlabel", transform: `scale(1,-1) rotate(-90 ${t.x + 1.4} ${-(t.y + 3.2)})` });
      else text(t.x - 1.4, t.y - 3.2, t.name, { class: "tlabel", transform: `scale(1,-1) rotate(90 ${t.x - 1.4} ${-(t.y - 3.2)})` });
    }
    this.preview = el("path", { class: "preview", d: "" }, root);
    this.showPreview();
  }

  showPreview() {
    if (!this.preview) return;
    const a = this.drawing && findTerminal(this.drawing.a, this.terms());
    if (!a || !this.cursor) { this.preview.setAttribute("d", ""); return; }
    const pts = [[a.x, a.y], ...this.drawing.pts, this.cursor];
    this.preview.setAttribute("d", "M" + pts.map(p => p.join(",")).join(" L"));
  }

  // --- pointer ---------------------------------------------------------------------------------

  // true when the click was used (else the plan pans)
  down(e, [mx, my]) {
    const t = e.target.closest("[data-term]"), bend = e.target.closest(".bend");
    const w = e.target.closest("[data-wire]"), item = e.target.closest(".item");
    if (this.placing && item?.dataset.uid === this.placing) {
      this.addTerminal(this.placing, mx, my);
      this.placing = null;
      return true;
    }
    if (t) {
      const [uid, tid] = t.dataset.term.split("|");
      if (this.drawing) this.finish({ uid, t: tid });
      else this.start({ uid, t: tid });
      return true;
    }
    if (this.drawing) {
      this.drawing.pts.push([snap(mx), snap(my)]);
      this.showPreview();
      return true;
    }
    if (bend) {
      this.own(this.wire());
      this.dragBend = +bend.dataset.i;
      return true;
    }
    if (w) {
      if (w.dataset.wire === this.st.wireSel) {
        // a click on the selected wire adds a bend there, ready to drag
        const wire = this.wire(), pts = this.own(wire), r = this.routedOf(wire.id).pts;
        let best = 0, bestD = Infinity;
        for (let i = 1; i < r.length; i++) {
          const d = segDist([mx, my], r[i - 1], r[i]);
          if (d < bestD) { bestD = d; best = i - 1; }
        }
        pts.splice(best, 0, [snap(mx), snap(my)]);
        this.dragBend = best;
        this.app.update(false);
      } else this.select(w.dataset.wire);
      return true;
    }
    if (item) {
      this.st.wireSel = null; this.st.wirePart = item.dataset.uid;
      this.app.update(false);
      return true;
    }
    if (this.st.wireSel || this.st.wirePart) { this.st.wireSel = null; this.st.wirePart = null; this.app.update(false); }
    return false;
  }

  move(e, [mx, my]) {
    this.cursor = [mx, my];
    if (this.dragBend !== null) {
      this.wire().pts[this.dragBend] = [snap(mx), snap(my)];
      this.app.update(false);
      return true;
    }
    this.showPreview();
    return !!this.drawing;
  }

  up() {
    if (this.dragBend !== null) { this.dragBend = null; this.app.commit(); }
  }

  dblclick(e, [mx, my]) {
    // the plan captures the pointer, so e.target is the plan itself: look under the pointer
    const under = document.elementFromPoint(e.clientX, e.clientY) ?? e.target;
    const bend = under.closest(".bend"), item = under.closest(".item");
    if (bend) {
      this.wire().pts.splice(+bend.dataset.i, 1);
      this.app.update();
      return;
    }
    if (item && !under.closest("[data-term]")) {
      // the two clicks of a double-click added bends while drawing: take them back
      if (this.drawing) this.drawing.pts = this.drawing.pts.filter(p => Math.hypot(p[0] - mx, p[1] - my) > 3);
      const t = this.addTerminal(item.dataset.uid, mx, my);
      if (this.drawing) this.finish({ uid: item.dataset.uid, t: t.id });
    }
  }

  // The wire's bends as its own (an auto-routed wire keeps the route it has now).
  own(wire) {
    if (wire.auto) { wire.pts = this.routedOf(wire.id).pts.slice(1, -1).map(p => [...p]); wire.auto = false; }
    return (wire.pts ??= []);
  }

  start(port) {
    this.drawing = { a: port, pts: [] };
    this.st.wireSel = null; this.st.wirePart = null;
    this.app.update(false);
  }

  finish(port) {
    const { a, pts } = this.drawing;
    this.drawing = null;
    if (a.uid === port.uid && a.t === port.t) { this.app.update(false); return; }
    const terms = this.terms(), ta = findTerminal(a, terms), tb = findTerminal(port, terms);
    const colour = defaultColour(ta.kind === "mains" || tb.kind !== "mains" ? ta : tb);
    const wire = { id: id(), a, b: port, auto: !!this.st.autoRoute, pts: this.st.autoRoute ? [] : pts, colour, gauge: "", label: "" };
    this.st.wires.push(wire);
    this.select(wire.id);
  }

  select(wid) {
    this.st.wireSel = wid; this.st.wirePart = null;
    this.app.update();
  }

  addTerminal(uid, mx, my) {
    const item = this.st.items.find(i => i.uid === uid), part = this.app.partOf(item);
    const [w, d] = partSize(item, part), [x, y] = fromPanel(item, w, d, mx, my);
    const n = (item.terminals?.length ?? 0) + 1;
    const t = { id: "c" + id(), name: `T${n}`, x: round1(x), y: round1(y), kind: "dc" };
    (item.terminals ??= []).push(t);
    this.st.wirePart = uid; this.st.wireSel = null;
    this.app.update();
    return t;
  }

  deleteWire(wid) {
    this.st.wires = this.st.wires.filter(w => w.id !== wid);
    if (this.st.wireSel === wid) this.st.wireSel = null;
    this.app.update();
  }

  // true when the key was used
  keys(e) {
    if (e.key === "Escape") {
      if (this.drawing) this.drawing = null; else if (this.placing) this.placing = null; else { this.st.wireSel = null; this.st.wirePart = null; }
      this.app.update(false);
      return true;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      if (this.drawing) { this.drawing.pts.pop(); this.showPreview(); return true; }
      if (this.st.wireSel) { this.deleteWire(this.st.wireSel); return true; }
    }
    return false;
  }

  // --- right-hand panel ----------------------------------------------------------------------

  renderStatus(box) {
    const { wires, problems } = this.app.routed;
    const bad = wires.filter(r => problems[r.wire.id]);
    box.className = bad.length ? "bad" : "ok";
    if (!bad.length) {
      const mains = wires.filter(r => r.kind === "mains").length;
      box.textContent = wires.length ? `✓ ${wires.length} wire${wires.length > 1 ? "s" : ""}, no problems (${mains} mains, ${wires.length - mains} low voltage)` : "No wires yet";
      return;
    }
    box.innerHTML = `⚠ ${bad.length} wire${bad.length > 1 ? "s" : ""} need${bad.length > 1 ? "" : "s"} a look<ul>` +
      bad.map(r => `<li><a href="#" data-wire="${r.wire.id}">${esc(wireName(r))}</a>: ${problems[r.wire.id].map(esc).join("; ")}</li>`).join("") + "</ul>";
    box.querySelectorAll("a").forEach(a => a.onclick = e => { e.preventDefault(); this.select(a.dataset.wire); });
  }

  renderSelected(box) {
    if (this.drawing) {
      const a = findTerminal(this.drawing.a, this.terms());
      box.innerHTML = `<p><b>Drawing a wire</b> from ${esc(a.partName)} ${esc(a.name)}.</p><p class="muted">Click to add bends · click a terminal to finish · double-click a part to finish on a new terminal there · <b>Backspace</b> removes the last bend · <b>Esc</b> cancels.${this.st.autoRoute ? "<br>Auto-route is on: the bends are replaced by a route through the ducts." : ""}</p>`;
      return;
    }
    const wire = this.wire();
    if (wire) return this.renderWire(box, wire);
    const item = this.st.wirePart && this.st.items.find(i => i.uid === this.st.wirePart);
    if (item) return this.renderTerminals(box, item);
    box.innerHTML = `<p class="muted">Click a terminal to start a wire, then click to add bends and click another terminal to finish.<br><br>Parts without terminals (or with others you need): double-click the part where its connector is to add one, or click the part to list and rename its terminals.</p>`;
  }

  renderWire(box, wire) {
    const r = this.routedOf(wire.id);
    const end = t => (t ? `${esc(t.partName)} · <b>${esc(t.name)}</b>` : `<span class="muted">(gone)</span>`);
    const opts = (list, cur, label = v => v) => list.map(v => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(label(v))}</option>`).join("");
    box.innerHTML = `<input type="text" class="name" data-k="label" value="${esc(wire.label)}" placeholder="${esc(wireName(r))}" title="Name this wire">
      <div class="row"><label>From</label><span>${end(r.a)}</span></div>
      <div class="row"><label>To</label><span>${end(r.b)}</span></div>
      <div class="row"><label>Circuit</label><span class="pill ${r.kind}">${r.kind === "mains" ? "Mains (AC)" : r.kind ? "Low voltage (DC)" : "?"}</span></div>
      <div class="row"><label>Colour</label><span class="swatch" style="background:${COLOURS[wire.colour]}"></span><select data-k="colour">${opts(Object.keys(COLOURS), wire.colour)}</select></div>
      <div class="row"><label>Size</label><select data-k="gauge">${opts(GAUGES, wire.gauge, v => v || "—")}</select></div>
      <p class="info">${wire.auto ? "Auto-routed through the ducts" : `${wire.pts?.length ?? 0} bend${wire.pts?.length === 1 ? "" : "s"}, placed by hand`} · ${Math.round(r.length)} mm along its route<br>Click the wire to add a bend · drag a bend · double-click a bend to remove it.</p>
      ${wire.auto ? "" : `<button id="wauto" class="wide">Auto-route through the ducts</button>`}
      <div class="actions"><button id="wstraight">Straight line</button><button id="wdel">Delete</button></div>`;
    box.querySelectorAll("[data-k]").forEach(e => e.onchange = () => { wire[e.dataset.k] = e.value.trim(); this.app.update(); });
    if (!wire.auto) box.querySelector("#wauto").onclick = () => { wire.auto = true; wire.pts = []; this.app.update(); };
    box.querySelector("#wstraight").onclick = () => { wire.auto = false; wire.pts = []; this.app.update(); };
    box.querySelector("#wdel").onclick = () => this.deleteWire(wire.id);
  }

  renderTerminals(box, item) {
    const part = this.app.partOf(item);
    const kinds = k => `<select data-kind><option value="dc" ${k === "dc" ? "selected" : ""}>low voltage</option><option value="mains" ${k === "mains" ? "selected" : ""}>mains</option></select>`;
    const rows = [
      ...(part.terminals ?? []).map(t => `<tr><td>${esc(t.name)}</td><td class="muted">${t.kind === "mains" ? "mains" : "low voltage"}</td><td></td></tr>`),
      ...(item.terminals ?? []).map(t => `<tr data-t="${t.id}"><td><input type="text" data-name value="${esc(t.name)}"></td><td>${kinds(t.kind)}</td><td><button data-del title="Remove this terminal and its wires">×</button></td></tr>`),
    ];
    box.innerHTML = `<p><b>${esc(item.label || part.name)}</b>: terminals</p>
      ${rows.length ? `<table class="terms">${rows.join("")}</table>` : `<p class="muted">None yet.</p>`}
      <button id="tadd" class="wide">${this.placing === item.uid ? "Now click on the part…" : "Add a terminal"}</button>
      <p class="muted">${part.terminals?.length ? "Terminals from the part's model can't be edited. " : ""}Tip: double-click on a part to add a terminal right there.</p>`;
    box.querySelector("#tadd").onclick = () => { this.placing = item.uid; this.renderSelected(box); };
    box.querySelectorAll("tr[data-t]").forEach(tr => {
      const t = item.terminals.find(x => x.id === tr.dataset.t);
      tr.querySelector("[data-name]").onchange = e => { t.name = e.target.value.trim() || t.name; this.app.update(); };
      tr.querySelector("[data-kind]").onchange = e => { t.kind = e.target.value; this.app.update(); };
      tr.querySelector("[data-del]").onclick = () => {
        item.terminals = item.terminals.filter(x => x !== t);
        this.st.wires = this.st.wires.filter(w => !(w.a.uid === item.uid && w.a.t === t.id) && !(w.b.uid === item.uid && w.b.t === t.id));
        this.app.update();
      };
    });
  }

  // Every terminal with a wire on it, by part: what lands where.
  renderDiagram(box) {
    const { wires } = this.app.routed, groups = new Map();
    for (const r of wires) {
      for (const [t, other] of [[r.a, r.b], [r.b, r.a]]) {
        if (!t) continue;
        const key = t.owner === PRINTER ? "Power inlet" : t.partName;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ t, other, r });
      }
    }
    box.innerHTML = groups.size ? [...groups].map(([name, rows]) => `<div class="dg"><b>${esc(name)}</b>` +
      rows.sort((p, q) => p.t.name.localeCompare(q.t.name)).map(({ t, other, r }) =>
        `<a href="#" data-wire="${r.wire.id}" class="dgrow"><span class="term-name">${esc(t.name)}</span> → ${other ? `${esc(other.partName)} ${esc(other.name)}` : "?"}` +
        ` <span class="swatch" style="background:${COLOURS[r.wire.colour]}"></span>${r.wire.gauge ? ` <span class="muted">${esc(r.wire.gauge)}</span>` : ""}${r.wire.label ? ` <span class="muted">(${esc(r.wire.label)})</span>` : ""}</a>`).join("") +
      "</div>").join("") : `<p class="muted">Connections show here as you draw wires.</p>`;
    box.querySelectorAll("a[data-wire]").forEach(a => a.onclick = e => { e.preventDefault(); this.select(a.dataset.wire); });
  }
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
