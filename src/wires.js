// Wires in the bay: terminals, routes (bends placed by hand, or auto-routed through the ducts)
// and the mains / low-voltage checks. No DOM here.
//
// A wire runs between two ports, { uid, t }: a placed part's uid (or PRINTER for the printer's own
// terminals) and a terminal id. Its bends are panel coordinates; an auto-routed wire has none
// stored and is routed again whenever the layout changes.
import { toPanel, partSize, footprint, panelSide, round1 } from "./bay.js";

export const PRINTER = "printer";
export const COLOURS = {
  brown: "#8b5a2b", blue: "#2f6fd6", "green-yellow": "#8fc31f", red: "#d62f2f", black: "#1b1b1b",
  white: "#f2f2f2", yellow: "#e6c229", orange: "#f08c00", grey: "#8a8a8a",
};
export const GAUGES = ["", "22 AWG", "20 AWG", "18 AWG", "16 AWG", "14 AWG", "0.5 mm²", "0.75 mm²", "1.0 mm²", "1.5 mm²"];

// The stock IEC inlet's L, N and PE, on its face towards the bay. Approximate: Siboor's model has
// no terminals on it.
export function inletTerminals(size, iec) {
  if (!iec) return [];
  const s = panelSide(size), x = 42.9, w = 57.2, y = s - 50.7 + 4;
  return [["L", 0.3], ["N", 0.5], ["PE", 0.7]].map(([name, f]) => ({
    id: name, name, kind: "mains", x: round1(x + w * f), y, owner: PRINTER, partName: "Power inlet",
  }));
}

// A placed part's terminals in panel coordinates: its library terminals, then any added by hand.
export function terminalsOf(item, part) {
  const [w, d] = partSize(item, part);
  const own = [...(part.terminals ?? []).map(t => ({ ...t, id: t.id ?? t.name })), ...(item.terminals ?? []).map(t => ({ ...t, custom: true }))];
  return own.map(t => {
    const [x, y] = toPanel(item, w, d, t.x, t.y);
    return { ...t, x, y, owner: item.uid, partName: item.label || part.name };
  });
}

export function allTerminals(state, partOf) {
  return [
    ...state.items.flatMap(it => (partOf(it) ? terminalsOf(it, partOf(it)) : [])),
    ...inletTerminals(state.size, state.iec),
  ];
}

export const findTerminal = (port, terms) => terms.find(t => t.owner === port.uid && t.id === port.t) ?? null;

export function defaultColour(term) {
  const n = term.name.replace(/\d+$/, "").toUpperCase(), first = n.split(" ")[0];   // "N in", "L out 2"
  if (first === "L" || first === "L1" || first === "T") return "brown";
  if (first === "N") return "blue";
  if (first === "PE" || first === "FG" || first === "⏚") return "green-yellow";
  if (n.startsWith("+") || n.endsWith("+") || n === "V+") return "red";
  if (/^[-−]|[-−]$/.test(n) || n === "V-") return "black";
  return term.kind === "mains" ? "brown" : "red";
}

// --- ducts and auto-routing -----------------------------------------------------------------

const HALF = 12.5;   // half a 25 mm duct

// Each duct's centre line { a, b } along its length.
export function ductLines(state, partOf) {
  return state.items.filter(it => partOf(it)?.kind === "duct").map(it => {
    const r = footprint(it, partOf(it)), horiz = r.x1 - r.x0 >= r.y1 - r.y0;
    const a = horiz ? [r.x0, (r.y0 + r.y1) / 2] : [(r.x0 + r.x1) / 2, r.y0];
    const b = horiz ? [r.x1, a[1]] : [a[0], r.y1];
    return { uid: it.uid, name: it.label || "duct", r, a, b };
  });
}

function project(p, { a, b }) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const raw = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2, t = Math.min(1, Math.max(0, raw));
  const q = [a[0] + t * dx, a[1] + t * dy];
  return { raw, t, q, dist: Math.hypot(p[0] - q[0], p[1] - q[1]), len: Math.sqrt(L2) };
}

const OFF_DUCT = 1.5;   // a run outside the ducts counts this much more than one inside
const OVER_PART = 20;   // and one across a part this much more (taken only when there's no other way)
const OWN_PART = 25;    // how far a wire may run over the part its terminal is on, to leave it

// How much of segment p-q lies inside rectangle r (shrunk by m). Liang-Barsky.
function lengthIn(p, q, r, m = 1) {
  let t0 = 0, t1 = 1;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  for (const [P, Q] of [[-dx, p[0] - (r.x0 + m)], [dx, (r.x1 - m) - p[0]], [-dy, p[1] - (r.y0 + m)], [dy, (r.y1 - m) - p[1]]]) {
    if (P === 0) { if (Q < 0) return 0; continue; }
    const t = Q / P;
    if (P < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return 0;
  }
  return (t1 - t0) * Math.hypot(dx, dy);
}

// The shortest way from p0 to p1: into the duct network, along it, and out; or straight across
// when that's shorter even with runs outside the ducts counting extra. `parts`: footprints to go
// around (not the ducts); a wire may cross the part its own terminal is on for OWN_PART mm.
// Returns the bends.
export function autoRoute(p0, p1, ducts, parts = []) {
  const pts = [], adj = [];
  const node = p => (pts.push(p), adj.push([]), pts.length - 1);
  const allow = r => (inside(p0, r, 0) || inside(p1, r, 0) ? OWN_PART : 0);
  const edge = (i, j, w) => {
    if (parts.some(r => lengthIn(pts[i], pts[j], r) > allow(r) + 0.5)) w *= OVER_PART;
    adj[i].push([j, w]); adj[j].push([i, w]);
  };
  const on = ducts.map(() => []);   // [t, node] on each duct
  ducts.forEach((d, k) => { on[k].push([0, node(d.a)], [1, node(d.b)]); });
  // where a duct's end meets another duct's side: join them
  ducts.forEach((d, k) => ducts.forEach((e, m) => {
    if (k === m) return;
    for (const [end, idx] of [[e.a, on[m][0][1]], [e.b, on[m][1][1]]]) {
      const p = project(end, d);
      const reach = HALF / p.len;
      if (p.dist <= HALF + 3 && p.raw >= -reach && p.raw <= 1 + reach) {
        const q = node(p.q);
        on[k].push([p.t, q]);
        edge(idx, q, p.dist);
      }
    }
  }));
  const S = node(p0), E = node(p1);
  edge(S, E, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * OFF_DUCT);
  ducts.forEach((d, k) => {
    for (const P of [S, E]) {
      const p = project(pts[P], d), q = node(p.q);
      on[k].push([p.t, q]);
      edge(P, q, Math.max(0, p.dist - HALF) * OFF_DUCT + Math.min(p.dist, HALF));
    }
  });
  on.forEach((list, k) => {
    list.sort((u, v) => u[0] - v[0]);
    for (let i = 1; i < list.length; i++) {
      const p = pts[list[i - 1][1]], q = pts[list[i][1]];
      edge(list[i - 1][1], list[i][1], Math.hypot(q[0] - p[0], q[1] - p[1]));
    }
  });
  // Dijkstra (a few hundred nodes at most)
  const dist = pts.map(() => Infinity), prev = pts.map(() => -1), done = pts.map(() => false);
  dist[S] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < pts.length; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity || u === E) break;
    done[u] = true;
    for (const [v, w] of adj[u]) if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
  }
  const path = [];
  for (let v = E; v >= 0; v = prev[v]) path.unshift(pts[v]);
  return simplify(path).slice(1, -1).map(p => [round1(p[0]), round1(p[1])]);
}

// Without repeated points and the middle of three in a line.
function simplify(path) {
  const out = [];
  for (const p of path) {
    if (out.length && Math.hypot(p[0] - out.at(-1)[0], p[1] - out.at(-1)[1]) < 0.05) continue;
    if (out.length >= 2) {
      const [a, b] = out.slice(-2);
      if (Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) < 0.5) out.pop();
    }
    out.push(p);
  }
  return out;
}

export function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

// --- every wire, routed and checked ---------------------------------------------------------

const inside = (p, r, m = 0.5) => p[0] > r.x0 + m && p[0] < r.x1 - m && p[1] > r.y0 + m && p[1] < r.y1 - m;

function crossing(p, q, r, s) {
  const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
  const u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
  return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99 ? [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])] : null;
}

// { wires: [{ wire, a, b, pts, kind, length, ducts }], problems: { wireId: [msg] } }
export function routeWires(state, partOf) {
  const terms = allTerminals(state, partOf), ducts = ductLines(state, partOf);
  const parts = state.items.filter(it => partOf(it) && partOf(it).kind !== "duct").map(it => footprint(it, partOf(it)));
  const wires = (state.wires ?? []).map(wire => {
    const a = findTerminal(wire.a, terms), b = findTerminal(wire.b, terms);
    if (!a || !b) return { wire, a, b, pts: null, kind: null, length: 0, ducts: [] };
    const ends = [[a.x, a.y], [b.x, b.y]];
    const bends = wire.auto ? autoRoute(ends[0], ends[1], ducts, parts) : wire.pts ?? [];
    const pts = [ends[0], ...bends, ends[1]];
    const used = new Set();
    for (let i = 1; i < pts.length; i++) {
      const m = [(pts[i][0] + pts[i - 1][0]) / 2, (pts[i][1] + pts[i - 1][1]) / 2];
      for (const d of ducts) if (inside(m, d.r)) used.add(d.uid);
    }
    const kind = a.kind === "mains" || b.kind === "mains" ? "mains" : "dc";
    return { wire, a, b, pts, kind, length: pathLength(pts), ducts: [...used] };
  });
  const problems = {};
  const add = (w, m) => (problems[w.wire.id] ??= []).push(m);
  for (const w of wires) {
    if (!w.pts) { add(w, "one of its terminals is gone (part removed?)"); continue; }
    if (w.a.kind !== w.b.kind) add(w, `joins a mains terminal to a low-voltage one`);
  }
  const ok = wires.filter(w => w.pts);
  const shared = new Map();   // wire -> names of the ducts it shares with the other kind
  for (const d of ducts) {
    const here = ok.filter(w => w.ducts.includes(d.uid));
    if (here.some(w => w.kind === "mains") && here.some(w => w.kind === "dc")) {
      for (const w of here) shared.set(w, [...(shared.get(w) ?? []), d.name.toLowerCase()]);
    }
  }
  const list = names => names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  for (const [w, names] of shared) add(w, `shares the ${list(names)} with ${w.kind === "mains" ? "low-voltage" : "mains"} wires`);
  for (const m of ok.filter(w => w.kind === "mains")) {
    for (const v of ok.filter(w => w.kind === "dc")) {
      search: for (let i = 1; i < m.pts.length; i++) for (let j = 1; j < v.pts.length; j++) {
        const x = crossing(m.pts[i - 1], m.pts[i], v.pts[j - 1], v.pts[j]);
        if (x && !ducts.some(d => inside(x, d.r, -0.5))) {
          add(m, `crosses low-voltage wire ${wireName(v)}`);
          add(v, `crosses mains wire ${wireName(m)}`);
          break search;
        }
      }
    }
  }
  for (const k in problems) problems[k] = [...new Set(problems[k])];
  return { wires, problems };
}

export function wireName(w) {
  if (w.wire.label) return w.wire.label;
  const end = t => (t ? `${t.partName} ${t.name}` : "?");
  return `${end(w.a)} → ${end(w.b)}`;
}
