// The 2D plan: a top view of the bottom panel to scale, front at the bottom.
import { panelSide, CORNER_R, BAY_HEIGHT, frameHoles, keepouts, footprint, partSize, placedHoles, placedCutouts, holeLabel } from "./bay.js";

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

export function roundedRectPath(x, y, w, h, r) {
  return `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h}` +
    ` H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;
}

export class Plan2D {
  constructor(svg, app) {
    this.svg = svg;
    this.app = app;   // { state, partOf, colourOf, select(uid), move(uid, x, y), problems }
    this.view = null; // viewBox [x, y, w, h] in mm (SVG y down: -panel y)
    this.drag = null;
    svg.addEventListener("wheel", e => this.zoom(e), { passive: false });
    svg.addEventListener("pointerdown", e => this.down(e));
    svg.addEventListener("pointermove", e => this.moveDrag(e));
    svg.addEventListener("pointerup", e => this.up(e));
    new ResizeObserver(() => this.fit(false)).observe(svg);
  }

  // Panel mm -> SVG user units: x stays, y flips (panel front at the bottom).
  fit(force = true) {
    const s = panelSide(this.app.state.size), m = 30;
    const W = this.svg.clientWidth || 800, H = this.svg.clientHeight || 600;
    if (!this.view || force) {
      const span = s + 2 * m, k = Math.max(span / W, span / H);
      this.view = [s / 2 - (W * k) / 2, -s / 2 - (H * k) / 2, W * k, H * k];
    } else {
      // keep the scale, follow the element's aspect
      const k = this.view[2] / (this._w || W);
      const cx = this.view[0] + this.view[2] / 2, cy = this.view[1] + this.view[3] / 2;
      this.view = [cx - (W * k) / 2, cy - (H * k) / 2, W * k, H * k];
    }
    this._w = W;
    this.svg.setAttribute("viewBox", this.view.join(" "));
  }

  toMM(e) {
    const p = this.svg.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(this.svg.getScreenCTM().inverse());
    return [q.x, -q.y];
  }

  zoom(e) {
    e.preventDefault();
    const [mx, my] = this.toMM(e), f = Math.exp(e.deltaY * 0.0015);
    const [x, y, w, h] = this.view, sy = -my;
    this.view = [mx - (mx - x) * f, sy - (sy - y) * f, w * f, h * f];
    this.svg.setAttribute("viewBox", this.view.join(" "));
  }

  down(e) {
    const g = e.target.closest(".item");
    const [mx, my] = this.toMM(e);
    if (g) {
      const it = this.app.state.items.find(i => i.uid === g.dataset.uid);
      this.app.select(it.uid);
      this.drag = { uid: it.uid, dx: mx - it.x, dy: my - it.y };
    } else {
      this.app.select(null);
      this.drag = { pan: true, x: e.clientX, y: e.clientY, view: [...this.view] };
    }
    this.svg.setPointerCapture(e.pointerId);
  }

  moveDrag(e) {
    if (!this.drag) return;
    if (this.drag.pan) {
      const k = this.view[2] / this.svg.clientWidth;
      const [x, y, w, h] = this.drag.view;
      this.view = [x - (e.clientX - this.drag.x) * k, y - (e.clientY - this.drag.y) * k, w, h];
      this.svg.setAttribute("viewBox", this.view.join(" "));
      return;
    }
    const [mx, my] = this.toMM(e);
    const snap = e.altKey ? 0.1 : 1;
    const q = v => Math.round(v / snap) * snap;
    this.app.move(this.drag.uid, q(mx - this.drag.dx), q(my - this.drag.dy));
  }

  up() {
    if (this.drag && !this.drag.pan) this.app.commit();
    this.drag = null;
  }

  render() {
    const { state, partOf, colourOf, problems } = this.app;
    const s = panelSide(state.size);
    if (!this.view) this.fit();
    this.svg.innerHTML = "";
    const root = el("g", { transform: "scale(1,-1)" }, this.svg);
    const text = (x, y, str, attrs = {}) => {
      const t = el("text", { x, y: -y, transform: "scale(1,-1)", ...attrs }, root);
      t.textContent = str;
      return t;
    };

    el("path", { d: roundedRectPath(0, 0, s, s, CORNER_R), class: "panel" }, root);
    for (let v = 50; v < s; v += 50) {
      el("line", { x1: v, y1: 0, x2: v, y2: s, class: "grid" }, root);
      el("line", { x1: 0, y1: v, x2: s, y2: v, class: "grid" }, root);
    }
    for (const k of keepouts(state.size, { iec: state.iec })) {
      el("rect", { x: k.x, y: k.y, width: k.w, height: k.d, class: "keepout" + (k.z0 > 40 ? " high" : "") }, root)
        .appendChild(Object.assign(document.createElementNS(NS, "title"), { textContent: `${k.name}: ${k.z0}–${k.z1} mm above the panel` }));
    }
    for (const h of frameHoles(state.size)) el("circle", { cx: h.x, cy: h.y, r: h.d / 2, class: "fhole" }, root);

    const order = [...state.items].sort((a, b) => (a.uid === state.selected) - (b.uid === state.selected));
    for (const it of order) {
      const part = partOf(it);
      if (!part) continue;
      const r = footprint(it, part);
      const bad = problems[it.uid]?.length;
      const g = el("g", { class: "item" + (it.uid === state.selected ? " sel" : "") + (bad ? " bad" : ""), "data-uid": it.uid }, root);
      el("rect", { x: r.x0, y: r.y0, width: r.x1 - r.x0, height: r.y1 - r.y0, fill: colourOf(part, it), class: "body" }, g);
      for (const c of placedCutouts(it, part)) el("path", { d: roundedRectPath(c.x, c.y, c.w, c.h, c.r), class: "cutout" }, g);
      for (const h of placedHoles(it, part)) {
        el("circle", { cx: h.x, cy: h.y, r: Math.max(h.drill / 2, 1), class: "hole " + (h.fix === "tap" ? h.thread : "through") }, g)
          .appendChild(Object.assign(document.createElementNS(NS, "title"), { textContent: holeLabel(h) }));
      }
      const label = it.label || part.name;
      const w = r.x1 - r.x0, hgt = r.y1 - r.y0, vertical = hgt > w * 1.5 && w < 40;
      // a duct has a hole in its middle: put its name halfway to the next hole
      const off = part.kind === "duct" && Math.max(w, hgt) > 140 ? 51 : 0;
      const cx = (r.x0 + r.x1) / 2 - (vertical ? 0 : off), cy = -(r.y0 + r.y1) / 2 - (vertical ? off : 0);
      const t = el("text", {
        x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "middle",
        transform: vertical ? `scale(1,-1) rotate(-90 ${cx} ${cy})` : "scale(1,-1)",
      }, g);
      t.textContent = label;
      t.style.fontSize = Math.min(8, ((vertical ? hgt : w) / Math.max(label.length, 4)) * 1.7) + "px";
      const h = partSize(it, part)[2];
      if (h > BAY_HEIGHT) t.textContent += " ⚠";
    }

    text(s / 2, -14, "FRONT", { class: "dim", "text-anchor": "middle" });
  }
}
